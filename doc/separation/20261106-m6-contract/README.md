# Bounded M6 metadata contract preparation — not a production transition

Production project image-web/klmiycyesxnpinxpeqep was read at2026-11-06 06:31:06.56192UTC in one read-only SQL snapshot:41 migration records; no M6 tables. No DDL, price activation, credential access or private row export occurred.

`before.json` is the actual selected production metadata vector. `expected-after.OFFLINE.json` is a reference derived from exact M6 in a synthetic native PG17.11 Unix-socket instance, with the actual production prefix history/pricing/flags retained. It is **not observed production after-state or authority to execute**. All fixture instances were stopped. The four preserved production function bodies/attributes and the preexisting generation_work user triggers matched the local transition reference.

Canonical SHA256 is UTF-8 JSON sorted by object keys with compact separators, followed by one LF. The coordinator uses the same rule:

- before:872f628d62fd77352a1772fe9789e41ce7fe855bec4cfb0a9d41ad2c05456801
- expected after:1759a1d3eade413b59ad827b238a3dea814fd2a2b8ee69821e7018edce6120f4

## Exact scope and repeatable checks

The three SELECT-only query files inventory fourteen exact function signatures with source digests/language/ownership/definer/search_path/ACL/effective EXECUTE; four new tables with columns/defaults/constraints/indexes/RLS/policies/table and column access; the selected preserved aliases; all user triggers on those tables plus generation_work; current pricing/flags as nonsecret data or in-database opaque hashes. This is a bounded M6 transition contract, not proof of arbitrary global database integrity.

Independent review identified that M6's dynamic private-function REVOKE uses SQL LIKE, whose underscores are wildcards, and includes overloads. `supplement.sql` copies that predicate exactly and inventories every match plus all affected-name overloads. Actual before scope1/reference after9, affected-name inventory4→14; no unexpected signatures. Local transaction/ROLLBACK fault tests detected an extra overload, a wildcard-matching unexpected name, an anon column grant and an extra trigger. Empty column ACLs are handled without aclexplode errors. See scope-tests.json. Retain actual after evidence and fail closed on any extra match/grant/trigger.

Only after a real authorized single dispatch: query again. Before normalizing history, require total42, an unchanged exact first41, exactly one final chat_usage_settlement and its actual14-digit version greater than the old maximum. Retain that raw assigned version separately; replace only that new version with ASSIGNED_AT_DISPATCH for comparison. Never copy the offline reference to an actual-after attestation, normalize unrelated differences, or retry an uncertain dispatch.

Financial wallet/op/ledger digests, runnable queue/leases and current Worker/configuration/Free proof must be freshly observed after the actual seal and drain; these JSON files are not those attestations. A new before snapshot must still match before policy approval/dispatch. The active policy remains absent. Expiry remains null in the NONEXECUTABLE example.

## Separate installation and quota observations

root-install-readback.json records actual installed20-file closure, exact root modes, empty audit parent, no policy, read-only missing-policy rejection and old production PID/pointers/health at06:41:36UTC. It also validates the inert4,616,982-byte backend delta transport (SHA29bc4858a55dcdaf836e4672580e0ab41c9979408371cf4af6d4712421080606), prepared under UID998/PrivateNetwork in the existing isolated output only. This archive is not staged or activated, and layer inventory reuse is only a hint requiring full later verification.

free-quota-observation.json records the existing authenticated dashboard's all-project current cycle06Nov–06Dec: database0.157/0.5GB summary (image-web149.77MB), Storage0.026/1GB, Edge311/500000, each egress0/5GB. These are displayed rounded values, dashboard refresh can lag an hour, and the exact UI observation timestamp was unavailable. RecordedAt is the evidence recording time, not a fabricated measurement time. Recheck before cutover; no future hard-cap guarantee is implied. No plan/billing changes were made.
