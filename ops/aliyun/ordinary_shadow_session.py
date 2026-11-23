"""Trusted process-local state only. The supervisor bounds blocked I/O."""
import re
import secrets
import time
from threading import Lock
from types import MappingProxyType

PINS = {
    'rollbackBackendSHA': 40, 'rollbackFrontendSHA': 40,
    'rollbackBackendManifestSha256': 64, 'rollbackFrontendArtifactSha256': 64,
    'rollbackFrontendConfigFingerprint': 64,
}


class Session:
    def __init__(self, *, gate, operation, node, highest_seen, measure, ttl=60):
        if (type(ttl) is not int or not 1 <= ttl <= 120
                or type(highest_seen) is not int or not 0 <= highest_seen < 2**63-1
                or type(node) is not str or not re.fullmatch('[a-z0-9][a-z0-9.-]{0,63}', node)):
            raise ValueError('Invalid trusted session policy')
        self._deadline = time.monotonic() + ttl
        issued = int(time.time())
        self._gate, self._op, self._measure = gate, operation, measure
        self._once, self._used = Lock(), False
        with gate.lock(blocking=False):
            gate.assert_clear(operation)
            pair = dict(measure())
            gate.lock_identity()
        if set(pair) != PINS.keys() or any(
                type(v) is not str or not re.fullmatch(f'[a-f0-9]{{{PINS[k]}}}', v) for k, v in pair.items()):
            raise ValueError('Invalid measured pair')
        self._pair = MappingProxyType(pair)
        self._local = MappingProxyType(dict(
            pair, node=node, nonce=secrets.token_hex(32), generation=highest_seen+1,
            highestSeenGeneration=highest_seen, challengeIssuedAt=issued,
            challengeExpiresAt=issued+ttl,
        ))
        self._fresh()

    def _fresh(self):
        if (time.monotonic() >= self._deadline
                or not self._local['challengeIssuedAt'] <= int(time.time()) < self._local['challengeExpiresAt']):
            raise ValueError('Challenge expired')

    def challenge(self):
        self._fresh()
        return {k: v for k, v in self._local.items() if k != 'highestSeenGeneration'}

    def validate(self, packet, *, verify):
        """verify is trusted host code with signature verify(packet, immutable_local)."""
        with self._once:
            if self._used:
                raise ValueError('Session already used')
            self._used = True
        self._fresh()
        # Signature/observer verification may wait; never hold deployment lock here.
        result = verify(packet, self._local)
        self._fresh()
        with self._gate.lock(blocking=False):
            self._gate.assert_clear(self._op)
            if self._measure() != self._pair:
                raise ValueError('Active pair changed')
            self._gate.lock_identity()
            self._fresh()
        return result
