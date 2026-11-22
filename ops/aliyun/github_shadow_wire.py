"""Pure shadow receiver framing. No production handler, trust bootstrap or I/O."""
import struct

from github_hosted_stage_shadow import shadow

HEADER = struct.Struct('>8s4I')
MAGIC = b'ZISHDW01'
LIMITS = (4096, 1024 * 1024, 16384, 1024 * 1024)
MAX_PACKET_BYTES = HEADER.size + sum(LIMITS)


def parse(packet):
    """Exactly four opaque byte strings: stage, stage bundle, observation, observation bundle."""
    if type(packet) is not bytes or not HEADER.size <= len(packet) <= MAX_PACKET_BYTES:
        raise ValueError("Invalid shadow packet")
    magic, *sizes = HEADER.unpack_from(packet)
    if (magic != MAGIC or not all(0 < n <= cap for n, cap in zip(sizes, LIMITS))
            or len(packet) != HEADER.size + sum(sizes)):
        raise ValueError("Invalid shadow packet")
    offset, items = HEADER.size, []
    for size in sizes:
        items.append(packet[offset:offset + size])
        offset += size
    return tuple(items)


def inspect(packet, *, observe=None, verify=None):
    """Callbacks must be injected by trusted host code; packet cannot select them.

    observe must verify its own independent signer, freshness and snapshot, and
    obtain baseline, clock, replay view and pair digests under trusted host
    policy. verify verifies only the exact stage and its candidate bundle using
    those expected pins. Both interfaces are intentionally unwired.
    """
    try:
        stage, stage_bundle, observation, observation_bundle = parse(packet)
    except ValueError:
        return {"status": "rejected", "reason": "invalid-packet", "productionReady": False}
    if not callable(observe) or not callable(verify):
        return {"status": "blocked", "reason": "host-verifiers-unavailable", "productionReady": False}
    try:
        observed = observe(observation, observation_bundle)
        if type(observed) is not dict or set(observed) != {'expected', 'jobs', 'run_started_at', 'now', 'seen'}:
            raise ValueError("Independent policy observation absent")
        verified = verify(stage, stage_bundle, observed['expected'])
        if type(verified) is not dict or set(verified) != {
            'verified_subject_sha256', 'verified_certificate', 'verified_predicate_type',
        }:
            raise ValueError("Verified stage evidence absent")
        shadow(stage, **verified, **observed)
    except Exception:
        # Production-shaped packets and callbacks must never leak data via a response.
        return {"status": "rejected", "reason": "untrusted-evidence", "productionReady": False}
    return {"status": "shadow-verified", "productionReady": False}
