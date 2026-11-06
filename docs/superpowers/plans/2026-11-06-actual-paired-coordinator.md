# Actual paired release coordinator

Spec: parent's 2026-11-06 instruction, repository doc/separation/20261106-paired-release-policy.md. This is local implementation and isolated verification; no root installation or production switch.

1. Implement a strict, durable stepwise coordinator. Separate before/after DB contracts; baseline receipt, seal/drain, explicit once-only migration dispatch intent, operator DB reconciliation, candidate receipt, approved frontend selection, final drain and open intent. Test failures at every side effect.
2. Implement fixed-path Linux adapter and CLI using the existing authenticated lifecycle/socket, immutable artifact, frontend approval, and receipt primitives. No arbitrary path/URL/command, DDL credentials, ordinary cross-schema deploy/recover, or automatic financial action.
3. Integrate browser-native verifier. Same-origin fixed GET-only challenge; no Cookie extraction. Produce exact installation/handoff instructions and truthful unavailable gates.
4. Run backend/paired/browser and project regression, independent whole-change review, fix important findings with RED/GREEN, preserve user edits, local ops commit only.

Review focus: durable intent before side effects; crashed command cannot replay; old/new schema mismatch cannot open or recover; receipt freshness and exact PID/start-ticks identity; root-owned code/data closure; foreign marker and pointer/sequence ABA; unknown DB outcome; errors opening admission; frontend approval cannot be uploader self-approval; no credential exposure.

## Ledger

Base: eed491c0757720e957b6a97a950a6143ce030f11. Application identity remains7a811b326aa4b344cee08bc5a33c04e44a780fd4.

Ruling: Use the user's original branch, preserving next-env and .env.local — explicit user instruction supersedes an additional worktree — unrelated changes must not enter the commit.

Ruling: The coordinator does not hold database credentials; migration submission remains an explicit external management operation after persisted dispatch intent, and it accepts independently reviewed metadata attestations by a trusted expected digest — avoids a new credential-bearing root database proxy — incorrect operator attestation would remain a trusted-operator error.

Ruling: After migration dispatch intent, default is sealed forward repair even if a first DB read still shows the old schema — an in-flight transaction may later commit — recovery is deliberately less automatic.

Ruling: No Cookie copying; normal HTTPS login plus reviewed same-origin browser snippet — follows latest parent instruction — Chrome self-XSS warning, if present, is a stop condition and must not be bypassed.

Pre-flight: core consumes exact adapter snapshots, adapter consumes existing immutable validators and receipt v2, browser producer consumes the same receipt v2. Frontend formal approval is a later independent root approval bound to frozen candidate, not an incoming assertion.

Task1 core: 15/15 green after missing-implementation RED plus schema-misrepresentation assertion RED. Tests include ten crash subcases. Actual app not touched.
Task2 fixed filesystem/lifecycle adapter: first 7/7 green after missing adapter RED. Includes actual filesystem marker ordering, foreign markers, stop/drain and partial-open hold.
Full project initial run hit sandbox EPERM writing domain/.vite-temp; requested normal escalation for the same existing offline regression, without changing cache paths or protections.

Final independent review (fresh gpt-6-astra): 3 Important, no Critical/minors. All three accepted for one fix pass. Confirmed unchecked-hash .pyc substitution, frontend prepare-before-intent replay, and unused old frontend artifact binding. Reproductions first RED; code now compiles reviewed source bytes including nested fixed SourceFileLoaders, journals frontend_prepare_intent before filesystem preparation, and checks actual sealed old/new frontend artifact in baseline/recovery/pair snapshots. Supplemental status-read mutation reproduced RED and removed.

Final: Ruling: Live DB attestation correctness, live authenticated Chrome behavior and root installation remain independent production gates — offline tests cannot certify them and source transfer was explicitly denied — no production switch is authorized by this implementation report; treating synthetic proof as live evidence would risk outage or wrong financial API admission.

Blocked action: SCP 252489-byte nonpublic source/test archive381dc3ce8dfeed96e1485762b3dc163bfb61e1a866f37e69e272fc902fcf9864 to aliyun-lian:/tmp/zimage-paired-coordinator-isolation-20261106.tgz. Auto-review denied external disclosure lacking payload/destination authorization. Known not executed. Read latest user history; no materially new relevant approval. No retry, alternate destination, inline transfer or workaround. Linux/glibc stage tests therefore remain unrun pending specific main-thread approval.

Project regression with existing offline fonts and normal repository-write approval: domain270,frontend195,Web1308 all pass. No application source changed after this run; remaining edits are ops/tests/docs.

Additional final fix: root ABI validation invokes node by name, so sanitize PATH/NODE_OPTIONS/NODE_PATH/LD_PRELOAD/LD_LIBRARY_PATH for every CLI command, including begin. Existing bridge guard originally covered stage/start only. Regression first missing guard RED; fixed environment inherited by an actual child process and restored afterward. No real secret environment or malicious child loaded.

Final verification: 36 paired passed,3 Linux stage skipped; backend189/browser18; application270+195+1308 all passed. Independent Important findings fixed RED→GREEN in one pass; no deferred minors. Root installation/live auth remain unverified; no production mutation. Final source-only transfer payload254240 bytes / e0878e33141998100e273c5152e00abec21882a73c7e79946c97452aeffee0d3 supersedes earlier candidate hashes; it has NOT been transferred.

## Approved Linux verification continuation (2026-11-06)

User message Sentinel_43d59c3ee3388191b69307d99a4748b4 explicitly approved the nonpublic254KB source upload and isolated run. Read the visible room evidence before retry. The previously denied SCP was retried exactly once and succeeded for the final254240-byte/e0878e33141998100e273c5152e00abec21882a73c7e79946c97452aeffee0d3 archive; old denials above are historical, not current blockers.

Linux unit a1 exited before test discovery because SSH expanded the unittest wildcard; retained raw failure, fixed argv quoting with shlex.join, did not change tests/guards. Unit a2:39/39 passed, including all3 Linux/glibc synthetic stage tests,5.723s wall/1.426s CPU. Independent same-configuration kernel witness verifiedUID998,NoNewPrivs1,CapEff0,AF_INET denied/AF_UNIX allowed,read-only input/production mounts,256MiB/no swap,cpu.max25000/100000,pids64. No application/production action; all units inactive.

70 source hashes unchanged after execution;16 existing installed helper hashes exactly matched the reviewed closure. Root code/policy paths and audit directory still absent. Nonsecret service/ingress/five Edge function version fingerprints prepared; no credential values read or output. Production old pointers and artifact unchanged;ready/meta200. DB at05:40:38UTC141888659B/41migrations/M6absent. All-org Free usage still needs a fresh check before cutover.

Task2 Linux-only verification: complete. Main-thread next approval is the exact four-file root installation,20-file digest manifest and empty audit parent; no active policy/service switch included. Actual DB metadata contracts,live authentication,F1 approval and chat availability remain separate gates. No new ruling or deferred minor; earlier conservative boundaries stand.

## Approved exact installation continuation (2026-11-06)

Necessity review completed; exact M6/B1 needs coordination, four-file framework not architecturally required, alternatives not validated. User reaffirmed tested-route installation in Sentinel_ea3d4347be9081918efb5314791ba360. Installed only fourcdf5991 tool sources,20-file hash manifest and empty audit parent. No active policy, service/sudo change, restart, migration, pointer/gate mutation. Independent06:41:36UTC readback validates root ownership/modes/20digests, --help0 and absent-policy status1 without writes; oldPID456496/old pair/ready+meta200 unchanged. No installer replay.

Safe prep: actual06:31:06UTC production metadata41/M6absent; exactM6 local PG17 reference yields bounded metadataV2 before872f628d62fd77352a1772fe9789e41ce7fe855bec4cfb0a9d41ad2c05456801 / expected-after1759a1d3eade413b59ad827b238a3dea814fd2a2b8ee69821e7018edce6120f4. Fresh independent review's dynamicREVOKE selector/overload gap addressed by exactLIKE inventory, table+column access, allusertriggers; four synthetic faultcases pass and rollback. Actualafter/financial+queue proof still required after seal. Artifacts/queries retained under doc/separation/20261106-m6-contract; offlineafter never an actualattestation. Policy example expiry stillnull, not installed.

All-org currentFree dashboard observedDB0.157/.5GB,Storage.026/1GB,Functions311/500000,egressboth0/5GB; values rounded/up to1hourlag, refreshbeforecutover. Maclocked, no nativeunlock. Isolatedzimage/PrivateNetworkbackenddelta4,616,982B/29bc4858a55dcdaf836e4672580e0ab41c9979408371cf4af6d4712421080606 prepared only,7sourcefilesunchanged/unitinactive/noincomingoractivation. Application/toolsource unchanged; existingtestevidence remains scoped to those bytes. No new ruling, deferred minor or paid call.

Next main-thread gates: exactactivepolicy approval/freshsnapshot, genuine本人browserauth/F1, explicitpostM6chatavailability decision, realonceonlydispatch/reconciliation. No silentchatdisable/priceguess; no historicaldata action or backup.

## Review-only release preflight continuation (2026-11-06)

Prepared exact local candidate1370B/d1b8b6e709cb8f4c48ee26fdd94be7d0d53dddfb9d46bcccc1714b6718c30ffe, proposed expiry10:57:45UTC not approved/installed. Fresh06:56:53UTC before remains41/M6absent/V2digest872f628d62fd77352a1772fe9789e41ce7fe855bec4cfb0a9d41ad2c05456801. Actual after and sealed financial evidence are not produced. No runtime/tool/application code changed.

Independent fresh review Critical0/Important2/Minor1: missing account/reference cleanup + nonclaim retention maintenance; inconsistent future retry horizon; overstated before-rejection test label. Verified against actual source chain, then one focused fix pass. Twelve activity cases were RED2/12 then GREEN12/12, including hidden queue, leases, five-minute retries/thresholds, exhausted transitions, account/ref cleanup and retention pruning. Full snapshot queries and12-relation row hashes passed synthetic PG17, all test/shim changes rolled back and instance stopped. No backup. Minor label now only flags actual M6 presence.

07:10:02UTC expanded unsealed observation has13 job terms/9 leases all0, historicalunknown3 untouched, active cron unchanged. proofReadyfalse, not a sealed attestation; full actual financial digests retained task-local0600, excluded from source commit. Metadata/worker/config/quota proof still requires real seal and fresh reads. Server07:05:23UTC exact20tool digests/oldPID456496/pointers/meta+ready200, activepolicyabsent. Public browser snippet emitted/syntaxchecked only; no account login.

Main-thread decisions: accept temporary new-chat outage with current default-disabled M6, or keep old version while preparing verified enabled-chat contract. Current final gate only accepts approved-disabled. Official pricing checked as reference, not approved tariff; request omits service_tier and receipt omits tier/write breakdown, so full applicable cost remains unverified. Target Secrets names confirmed key presence, new enabling flags/mappings absent in list, no values read. No price/config/policy mutation, paid call, old-data action or push. All prepared artifacts in doc/separation/20261106-paired-preflight and detailed runbook.

## Approved policy installation and real backend staging (2026-11-06)

Verified user action-time approval Sentinel_f026e6547efc81918d15635bd90ca092 after exact limited-policy disclosure. Installed only the1370-byte/d1b8b6e709cb8f4c48ee26fdd94be7d0d53dddfb9d46bcccc1714b6718c30ffe policy root:root0600 with existing10:57:45UTC expiry. No overwrite/extension/new persistent tool. Installed20-file code closure validated and actual readonly status worked with journalnull.

Copied exact4,616,982-byte/29bc4858a55dcdaf836e4672580e0ab41c9979408371cf4af6d4712421080606 transport into fixed incoming O_EXCL, then stage-backend once. Actual adapter native/closure/layer/resource/target gates passed, new retained7a811 prepared, activatedfalse/productionReadyfalse. Pointers and deployment counter unchanged; no operation/gates/service/M6 change. Independent08:03:27UTC policy+markers+oldPID456496+old pair+meta/ready200 verified. No denial or uncertain write; no automatic retry/cleanup.

CUA checked before/after: Maclocked, no controlled zimage tab. Stop before begin/challenge/seal, normal user login/read-only browser receipt remains required. No helper20min/8nonce session started. Full before/financial/worker query07:57:50UTC:41/M6absent, expected contracts match, activity13jobs/9leases0, historicalunknown3 untouched. Updated all-orgFree435calls/Storage.03GB/DB149.87MB/egressboth0, lag1hour. Sealed attestations still not generated. New models and tariffs stay disabled. Original user edits/env metadata preserved, no paid call, data action or push.
