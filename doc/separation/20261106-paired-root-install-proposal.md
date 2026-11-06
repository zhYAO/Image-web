# Exact root-tool installation proposal — not executed

Candidate source commit: cdf5991b3d09976f466da7da9f8adff87052756b. Application remains7a811b326aa4b344cee08bc5a33c04e44a780fd4. Source transfer and isolated tests were explicitly approved; that approval does not install a production coordinator or active policy.

The exact254240-byte/e0878e33141998100e273c5152e00abec21882a73c7e79946c97452aeffee0d3 source package is now in the authorized server temporary location, owner-only0600. Its extracted70-file input under /tmp/zimage-paired-isolation-20261106-cbfu9djq/input is root-owned, directories0550/files0440, unchanged after the39/39 Linux tests. Tests ran aszimage/UID998, PrivateNetwork, AF_UNIX only, no capabilities/new privileges,256MiB/no swap/25%CPU/64tasks/180s, and all test units stopped. A kernel witness confirmed these limits and read-only production/input mounts. No root coordinator was installed and no production pointer/gate changed.

## Proposed exact creation scope

- New directory `/usr/local/libexec/zimage-paired-release`,root:root0750, containing only cli.py/core.py/system.py/stage.py,root:root0640. SHA256 values below.
- New file `/etc/zimage/paired-release-tools.json`,root:root0600, exact20-file dependency map from paired-coordinator-tools.candidate.json, SHA256 **2dddf9040d78f05423ff26dfbcfa91ea68776fc94d8d89642a0631798cd13838**. Its16 existing installed helper hashes have already been checked byte-for-byte; recheck under the shared deploy lock before installation. Do not replace any existing helper.
- New empty audit parent `/opt/zimage/paired-operations`,root:root0700. Do not create or reuse a live operation.

All four target paths, including active `/etc/zimage/paired-release-policy.json`, were absent at05:40UTC. Abort if any target unexpectedly exists; do not overwrite or remove foreign files. Installation must verify source single-link regular files, root-owned protected ancestors, four source hashes and complete20-file closure. The common lock may serialize installation, but no service or pointer action is part of it.

| New file | SHA256 |
|---|---|
| cli.py | 6389267c918dc2cfe35a058968b2b3bc7df78fdf248d1274444d2482f71c4855 |
| core.py | 6ab132b3f4c1b8df9ae2df579c06c56a156eaab692833469be02798d93259dcb |
| system.py | ea85b51970b96e4f17d498f7d49695ba8a97a27702a215059833981491ed7c47 |
| stage.py | f00d6d9e58a66a5ff47f07ea8bc34d4efeff618d88d0e63f37b7810fe5f6dde0 |

## Authority, purpose and impact

This installs privileged executable source. A future specifically approved active policy would allow the already-existing root operator to fence ingress and Node admission, drain the exact process, stop/start the existing zimage service, prepare verified artifacts, select the two approved application pointers and retain audit evidence. A defect could cause an outage or unsafe admission, so the exact installation scope requires explicit approval. No new ordinary-user/anonymous/service_role right or sudoers entry is granted by this installation.

This proposal **does not install an active policy, run begin/seal/open, apply M6, deploy Edge functions, enable a provider/price, invoke a paid model, alter Nginx/systemd/Auth/Secrets, restart a service, retry/refund old records, delete data or create a backup**. Existing16 helpers and their ordinary compatibility guards are untouched. Without a valid separately installed root policy, all operational commands fail closed. A post-install --help and20-file digest/ownership validation are sufficient for this installation step; they are not production acceptance.

## Later gates — separate from installation

Retain nulls in the non-executable example for the actual before/after DB metadata contract and expiry. Derive/review complete DDL/history/ACL/RLS fingerprints before active policy approval; financial/queue/lease/quota attestation is captured freshly after the real seal. Current read-only service/ingress/Worker fingerprints are available in paired-coordinator-production-policy-inputs.json; they must be refreshed before use.

The finalF1 artifact/approval needs genuine new-backend compatibility evidence. Existing chat availability must be explicitly resolved: M6 closes default token tariffs, current code accepts only explicitly approved disabled chat availability. Do not silently disable old chat or publish a guessed price. User must log in normally through the documented cookie-free browser workflow only when the main conversation schedules it; a self-XSS warning is a stop condition. Full A+ and real models remain unverified; no paid calls are authorized by this proposal.
