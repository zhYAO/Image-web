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
