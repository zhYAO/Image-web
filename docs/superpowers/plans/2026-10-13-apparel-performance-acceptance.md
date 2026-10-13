# Apparel optimization controls and performance acceptance

Goal: independently disable source reuse and visible mounting, preserve the baseline by default, and measure the previously unresolved tail latency with fixed synthetic inputs.
Architecture: runtime server opt-in and build-time public boolean; per-claim admission cache with direct guarded fallback for known nonadmissible sources; isolated actual service/renderer harness with fake RPC/Storage only; native browser fixture for both display modes.
Tech stack: existing process.env configuration, React/AntD, TypeScript, Sharp, Node, deterministic paired resampling.
Spec: doc/requirements.md new 2026-10-13 performance acceptance correction; parent explicitly authorized implementation/review/tests/PR10, no production/model use.

## Constraints and predeclared measurement decisions

- Keep current PR10 branch/worktree and PR9 independent. No merge/deploy/production requests or paid model calls, no secret reads or user photos. Archive/worker/ownership/ZIP protections unchanged.
- Server ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED=true opts in; unset/false/invalid uses baseline authorized loader. Read once per claim; changing server environment needs service restart, not a new build. NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED=true opts in to visible mounting; unset/false/invalid uses ordinary Image. Next inlines it, so change requires build+deployment. Both independent defaults off pending acceptance.
- Retention cap8MiB/claim and32MiB/process applies only to retained encoded bytes, not total RSS. Known overbudget sources bypass promise/maps on later reads; authorization/lease checks and errors remain enforced.
- Fixed seed and per-source input SHA/dimensions; actual service+Sharp render, fake RPC and local byte-copy Storage with fixed25ms per download, no network. Cases: normal1 display, overbudget20 displays, genuinely decoded large-pixel1 display (not padded bytes). All outputs/ZIP paths/hashes checked. Uploads simulated, original output hashes identical required.
- Cold process:5 separate process launches/mode/case, no warmup; report distributions/min/median/max, not meaningful cold P95. Startup and first-set render distinguished. OS cache not claimed cold.
- Steady-state:3 excluded paired warmups/case,120 interleaved paired trials (120/mode,6 nominal tail observations), balanced deterministic randomized AB/BA order. Same process, no simultaneous lint/build/tests. Force GC between trials and report that limitation. P50/P90/P95/max, paired differences and95% paired-bootstrap CI (5000 resamples) for P95 ratio/delta. One case at a time. Do not equate non-significance with non-inferiority; zero regression target, no post-hoc10% allowance. Uncertainty crossing above zero means not proven and reuse stays default off.
- RSS: sample process RSS per trial every20ms/endpoints (shared-process values not causal attribution); separate fresh-process memory runs for each mode; exact process maxRSS and retention peaks/disposal separately. Concurrency boundary: simulated claims2/5 with aggregate budget shared, no promise of a32MiB RSS limit; stop/escalate local workload if environment memory cannot safely support it, report boundary rather than risking OOM.
- Pre-run methodology review: fixture generation stays outside measured children; process lifetime maxRSS includes imports/preload and those baselines are separately reported. Preserve chronological thirds and AB/BA subgroup estimates. The actual12MP stress fixture retains seeded RGB noise (not padded) so decode/encode cost is disclosed; overbudget display IDs repeat one identical display payload. Concurrency5 must actually attempt >32MiB encoded retention; otherwise budget contention remains unverified. The25ms injected-read result does not establish zero overhead for fast Storage. At least768MiB free cgroup/MemAvailable headroom is required before measured runs; wave admission additionally uses1.3×single-process maxRSS×concurrency. No concurrent local tests/build during timed runs.
- Browser: actual component/AntD flag-off/on fixtures, desktop+document scroll and original navigation; initial requests and first-visible image latency recorded as synthetic evidence. No production-auth/full-page or real-device claim.
- PR9+10 compatibility only in isolated temporary checkout; no main push. If worktree helpers disallow extra worktree, use a task-specific temporary clone checkout with no remote push.

## Tasks

1. TDD flag parsing/defaults/independence, service cache-off14 reads vs on7 preserving hash, UI off eager/no observer vs on gating. Implement configuration/templates/production public variable forwarding and document restart/build semantics.
2. TDD known oversized-source fast fallback plus authorization/dispose failures. Implement bounded metadata-only exclusion; no failed download cache, global temporary-budget failures remain eligible.
3. Commit reproducible isolated benchmark runner/analysis, run a pilot to verify fixtures and safe resource range, then predeclared warm/cold/paired/memory/concurrency series. Record hashes, raw timings/seed/order, uncertainty and explicit acceptance limits. Defaults remain off unless evidence supports enabling (do not silently change defaults).
4. Independent fresh review (including benchmark methodology), appropriate full local checks/build and PR10 CI; isolated PR9 compatibility; update requirements/progress/report and Library. No production actions.

## Review focus

Static public env inlining vs runtime private flag, unsafe client imports, default disabled path bypassing reuse overhead while keeping guards/errors, large-source fallback and shared byte accounting, lease/disposal, benchmark pseudo-replication and cold/steady distinction, tail CI interpretation and non-inferiority, decoded pixel/resource size and sampled RSS attribution, concurrent boundary, fixed input/output hash verification, combination test isolation and no production/migration side effects.
