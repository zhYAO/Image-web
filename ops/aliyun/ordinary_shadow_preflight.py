"""Read-only ordinary shadow under the same deployment lock; not an entrypoint."""
import re

from github_shadow_head import PAIR_PINS, PAIR_SOURCES
from github_shadow_wire import inspect, parse


def rejected(reason):
    return {"status": "rejected", "reason": reason, "productionReady": False}


def run(packet, *, gate, operation, expected_baseline, read_baseline, observe, verify):
    """Inputs except packet are trusted installed host interfaces.

    read_baseline must independently measure current root-owned active pair and
    evidence; expected_baseline belongs to the exact local challenge for operation.
    The observer separately validates that challenge against the signed file.
    The installed supervisor must bound the whole verification process (including
    read callbacks and digest work) and recheck freshness after it returns.
    This read-only result does not reserve the operation or authorize a write.
    """
    try:
        parse(packet)
    except ValueError:
        return rejected("invalid-packet")
    snapshot = dict(expected_baseline)
    if set(snapshot) != set(PAIR_PINS + PAIR_SOURCES) or any(
        type(snapshot[key]) is not str or not re.fullmatch(
            '[a-f0-9]{%d}' % (64 if key in PAIR_PINS else 40), snapshot[key])
        for key in snapshot
    ):
        return rejected("invalid-local-baseline")
    try:
        with gate.lock(blocking=False):
            gate.assert_clear(operation)
            if read_baseline() != snapshot:
                return rejected("live-baseline-mismatch")
            result = inspect(packet, observe=observe, verify=verify)
            if result["status"] != "shadow-verified":
                return result
            # Recheck common inode and live evidence without re-claiming or writing.
            gate.lock_identity()
            if read_baseline() != snapshot:
                return rejected("live-baseline-mismatch")
            return result
    except Exception:
        return rejected("ordinary-gate-unavailable")
