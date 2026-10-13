# Apparel input reuse and visible loading acceptance

## Production release lock (2026-10-13 follow-up)

Both feature getters return false when `NODE_ENV=production`, before reading
either opt-in. Next production builds replace that environment condition, so
the browser flag cannot override the compiled lock; standalone production
runtime is also locked. `development` and `test` retain independent opt-ins.
This preserves the original download/image path in production even if machine
or build feature flags are accidentally true. Future production activation
requires an explicit reviewed code change as well as the acceptance below;
changing environment settings or restarting alone cannot activate it.

No systemd, credential, permission or security configuration change is needed.
The earlier standalone benchmark fingerprints/results below predate this
production-lock follow-up and remain historical screening, not acceptance of
the new release tree. No additional performance experiment was run.

## Scope and fixed decision rules (written before measurements)

Base: main `880391e64a8796efec8c523a64aa0625578a2325` (PR9 and PR12).
Compare PR10 `585e9e153554293ac13884ffbe65a150dbb59a09` and PR11
`0af8dfaf8638e2d89c51be2dbea73f4329f706b6`; copy only useful apparel
code and tests. Preserve PR9 reference upload bytes and PR12 partial-visibility
preview behavior. Exclude Cron, memory diagnosis, composition changes and the
shared delivery ledger. Both flags remain unset/off. No production traffic,
provider calls, migrations, permission changes or paid services.

Correctness is mandatory at every stage: all JPEG names, dimensions and SHA256
digests match across modes/processes; inputs remain byte-identical; retained
encoded bytes return to zero after success/failure/disposal; each claim stays
within 8 MiB and each module instance within 32 MiB. These are cache accounting
limits, **not RSS limits**. Concurrent admission must fall back and recover.
Input-download SDK/HTTP 404 is expired (410); transport/body/503 is retryable (503); malformed
image/layout stays a validation error. Lease/owner checks apply to cached hits.

Offline latency screening uses fixed synthetic JPEGs and the actual service and
Sharp renderer with authorized mock RPC/Storage. Test normal 750x1000 photos,
true 3000x4000 (12 MP) photos, and 10 MiB padded JPEGs that exceed the claim
budget (20 displays). Padded small images are an encoded-budget case only.
Use zero artificial Storage delay for the no-regression test. A separate 25 ms
mock test may illustrate read savings; it cannot establish real latency/cost.
Baseline means the new guarded service with reuse off; this comparison does not
measure the main-to-disabled-service overhead of the error classification fix.

Each variant has its own fresh Node child; cold = first claim, warm = second
claim after one same-mode unmeasured warmup. Baseline/reuse never share a child
or native cache. Use seeded balanced randomly shuffled BR/RB pair order,
serialize pairs and cases, and retain raw phase/order/timing/environment data.
Preload fixture bytes before timing. A global owned lock serializes runners;
check for competing dev/build/test workloads before, during (250 ms watchdog),
and after children. Record cgroup/host headroom and child maxRSS separately;
stop owned children at 128 MiB remaining headroom, 180 s per child or unexpected
failure. Admit one child only with at least 768 MiB remaining memory.

Stages: one cold pair per case, then four warm pairs per case; inspect before
expanding in batches of at most eight pairs. A small sample supports screening
only. Full offline latency gate requires >=40 warm pairs per case across >=2
independent windows, P95 reuse/baseline <=1.05 and paired plus circular-block
bootstrap 95% upper bounds <=+5%, with no correctness failures. Also require
each BR/RB group and each window median <=+5%, and cold median <=+5% from >=10
cold pairs per case. Uncertainty is pending, not passing. Do not relax gates
after observing results. Before full acceptance, define window independence
more strictly: record window/resource data and actual warm batch start/end,
require >=5 minutes between nonoverlapping warm groups (cold-window labels
alone do not count), sort batches chronologically for
block bootstrap, and let any recorded abort, correctness rejection or incomplete
batch veto acceptance. Never silently discard failed data; use a new evidence
directory after an investigated code change, retaining the old failed evidence.
RSS has no cache-derived pass threshold; report peak
and boundaries explicitly. Production activation needs a separate authorized,
bounded staging evaluation of real Storage/network and sustained concurrency.
Child kernel maxRSS includes startup, fixture preload and any warmup; 20 ms
claim samples can miss short peaks. A 5-minute gap establishes separate warm
periods only, not independence from unobserved host activity.

Reproduce outside the Git tree using Node 24.19.0 and the frozen lockfile:

```sh
node apps/web/scripts/run-apparel-performance.mjs /absolute/evidence prepare
node apps/web/scripts/run-apparel-performance.mjs /absolute/evidence cold normal 1 20261014 0 cold-a
node apps/web/scripts/run-apparel-performance.mjs /absolute/evidence warm normal 4 20261014 0 warm-a
node apps/web/scripts/run-apparel-performance.mjs /absolute/evidence concurrency large-pixels 5
node apps/web/scripts/run-apparel-performance.mjs /absolute/evidence report
```

Repeat the cold/warm commands for `oversize` and `large-pixels`, inspecting each
batch before expanding (maximum eight pairs). Use new seed/window arguments to
avoid overwriting trials. After code/runtime/input changes, prepare a new evidence
directory and retain the old data. Abrupt SIGKILL can leave the owned lock; prove
the recorded process is gone before removing that lock. SIGINT/SIGTERM have an
owned-child termination path, but live interruption/headroom tests remain pending.

## Implementation and validation plan

1. Establish focused main baseline; port only apparel source reader/config,
   service changes, image/config/styles and their tests from PR11.
2. Add pending-download, concurrent admission/release, failure cleanup and
   browser API fallback tests. Preserve the original disabled UI path and use
   threshold zero for partial visibility. Test URL replacement and full gallery.
3. Replace the contaminated long-run harness with independent child pairs,
   immutable fixture/code fingerprints, bounded batches and enforced gates.
4. Run staged offline checks; fix only reproducible regressions; retain all raw
   output in Library, with only this concise summary and reusable harness in Git.
5. Run repository checks and independent read-only branch review. Push a fresh
   branch, create a draft PR, inspect exact-head CI. Never merge/deploy.

## Results (2026-10-13)

Full statistical acceptance is **pending; accepted=false** for every case.
Earlier 10 oversized trials (+6.147% P95) and the 120 pairs competing with a
12.6 GiB next dev process are rejected evidence, not acceptance. The pre-review
screening also stays separate from the final fingerprint below.

Final zero-delay screening, independent children and same-mode warmups:

| Input | Cold pairs | Warm pairs | Reads off → on | Observation |
|---|---:|---:|---:|---|
| 750x1000 normal | 1 | 4 | 14 → 7 | Warm median -2.05%; insufficient sample/window/cold coverage |
| 10 MiB padded, 20 displays | 1 | 8 | 52 → 52 | First warm batch median +6.76%, followup -0.97%; first window fails the fixed median screen |
| 3000x4000 true 12 MP | 5 | 4 | 14 → 13 | Initial cold pair +7.58%, cold median after followup +1.67%; warm median +4.96%, BR group +5.98% |

These small samples do not establish P95 or a stable product regression. No
numerical gate was relaxed and no case was removed. In particular, retaining
oversized input offers no read savings, and 12 MP savings are small. Both must
remain off until the complete fixed gate and staging boundaries are satisfied.
No speculative renderer/GC/composition change was made.

Every serial claim produced 11 JPEG outputs (30 for the 20-display case), with
identical names/dimensions/SHA256 across modes and processes. Inputs remained
byte-identical; module retained bytes returned to zero after every serial claim.
Five concurrent 12 MP claims produced identical outputs, reads 70 → 66
(reuse: 13/13/13/13/14), observed retained encoded peak 29,338,061 B (<32 MiB),
and zero retained bytes after the wave. The fifth claim used budget fallback.
Kernel maxRSS for that one wave was 637.14 MiB off / 695.22 MiB on. This is
evidence that cache accounting does not imply an RSS reduction or RSS cap; it
does not establish sustained-concurrency safety.

Final fingerprints: manifest `de97da72c46865cd88a807d6667fc35d5f441f502c2ec4e86d5eea8d7a841547`,
benchmark `376301d4781df5a9c0749e5781a1792e15334563a09e4846b813321ae279577c`,
runner `76f5dcb2a9b1325c045fe59057346f94532392d239de4a71a8dd01226462b728`,
policy/statistics/resource helpers `c2b7057d53339b33076adc466915205b1d71975d572c727f05b4c067a1f71c60`.
Node 24.19.0 / Sharp 0.35.3; raw runtime, order and resource records are in the
private Library evidence `libfile_4cf82e75e9f08191a864b303b95fed2c`.

Local validation: lint/typecheck pass; Domain 76, Web 713, Worker 80, acceptance
budget 5, operations 20, dev script 3 and Node harness helper 14 tests pass.
Independent read-only review found no remaining blocking defects. Default
Turbopack build was blocked by the local dependency symlink crossing its project
root; isolated mock Webpack build passed. Generated `next-env` changes were
restored and owned build artifacts removed. Database/coverage and the normal
Turbopack build are additionally checked by the exact-head draft-PR CI.

## Free-plan implications and activation gates

Claim-local source reuse can reduce Storage downloads without changing uploads,
output encodings, ZIP bytes, provider use, database rows or permissions. Expected
read savings depend on admitted **encoded** sizes, not pixel dimensions: the
normal fixture fits, padded sources all fall back, and 12 MP JPEGs admit only
one large photo plus Logo. Reuse does not eliminate Sharp decode/composition;
it is not a native memory fix. The default-off path creates no reader/maps.

Visible loading delays original result image requests until partial intersection
or explicit user action while keeping all unexpired URLs in the preview group.
Hydration emits stable authenticated proxy URLs without signing RPCs. Deferring
an image postpones that endpoint's asset RPC and private Storage download until
needed; actual browser request savings remain unmeasured. Export/original bytes
stay unchanged. Missing IntersectionObserver loads automatically;
URL/owner/task/run identity prevents old visibility from carrying forward.

Both are candidates for later bounded staging activation, not approved for
production now. Reuse still needs the complete fixed latency gate, real-network
verification, and sustained concurrent RSS headroom evidence. Visible loading
needs desktop native scrolling/clipping and request-count checks with a new
build; jsdom checks prove state/gallery behavior only. Inputs above 12 MP,
20 high-pixel displays together, and maximum allowed decoded-pixel boundaries
were not exercised. No production flag was
changed in this task.

The coordinating session reports Free / ACTIVE_HEALTHY at 12:45 UTC and database
102,714,515 B, Cron history+indexes 82,296,832 B at 12:47 UTC. These were provided
read-only observations, not new queries by this task. The 09:03 billing snapshot
is stale for real-time quota claims. These apparel controls do not free Cron
database space. No spend/savings estimate is inferred from local read counts.

Prior Cron evidence identity located: `libfile_505a1272e2888191be16778b7bb2b2d5`
v3, `ZImage-2026-10-13-verification-and-cron-preview.zip`, OpenAI file ID
`file_00000000aa48822fb2e93c3a99168fa5`, 167,003 B. Download failed, so the
original 500 IDs and manifest bytes remain unverified here. The committed PR11
report at `0af8dfaf8638e2d89c51be2dbea73f4329f706b6` records batch001 hash
`32429c0da10d90abba3f20729ce0fbb257effda2dac8d8d34fbb45056fa429e8`, frozen
succeeded cutoff `2026-09-29T08:15:00Z`, failed cutoff `2026-09-13T08:15:00Z`,
500 unique ordered IDs summarized as 1–500, job1=32/job2=468, all succeeded,
end-time range `2026-08-25T06:15:00.159331Z`–`2026-08-25T14:14:00.085442Z`.
These are historical reported values, not a fresh verification of the exact
JSON/hash or current rows. They are insufficient to authorize any operation.
No replacement manifest or production query was generated. Archival does
not preserve `command`/`return_message`; deletion loses those fields irreversibly.
