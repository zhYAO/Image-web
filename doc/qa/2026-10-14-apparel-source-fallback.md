# Apparel source fallback investigation and implementation plan

**Current closeout:** the failed candidate's runtime source opt-in is withdrawn
in all environments. The measurements below belong to commit
`e6d041bc906e03e1e91df416126b4e8a640df11c`; their failure is unchanged. Reader code
and independent tests remain available for research. See the retirement section
for the separately bounded functional verification; it is not latency acceptance.

**Goal:** Remove unnecessary source-reader work for large initial inputs without
activating either production optimization or weakening the frozen latency gate.

**Base/spec:** main `d8dc3d04e33334049f9e1e845200ab97881520ec`; the delegated
2026-10-14 task and `2026-10-13-apparel-reuse-acceptance.md`. Offline synthetic
fixtures only; no production Storage, log queries, models, migrations or deletes.
Source files, tests and this task-specific document only. Export routes/UI,
dev-memory tooling, package files, CI and the shared delivery ledger are excluded.

## Investigation before implementation

The renderer reads main 1 twice, main 2 three times, the remaining photos twice,
and the logo once. Encoded reuse does not avoid Sharp decoding/normalization.
The 12MP fixture fits only the first photo plus the single-use logo in the 8 MiB
claim cache: one avoided read, approximately 7.3 MiB held for the entire claim.
The padded fixture avoids no reads but retains the single-use logo. Initial
cache misses execute three authorization checks through nested pending promises;
the baseline executes two. Already excluded reads have the same single async
frame as the baseline; the costly extra bookkeeping is on initial misses.

Independent processes trace the actual renderer read order with real immutable
fixture bytes, copied Storage payloads and copied renderer input bytes. They count
operations and retained encoded bytes; they do not measure rendering latency or
establish that these costs caused the historical +6.76%/+5.98% screening failures.
Those historical failures and their original fingerprints remain in Library v9.

| Source-boundary trace | Baseline reads/checks | Original reuse reads/checks | Candidate reads/checks | Original/candidate retained peak |
| --- | --- | --- | --- | --- |
| Normal | 14 / 28 | 7 / 28 | 7 / 28 | 3,223,716 / 3,223,716 B |
| Real 12MP | 14 / 28 | 13 / 34 | 14 / 29 | 7,334,465 / 0 B |
| Padded 10 MiB | 52 / 104 | 52 / 130 | 52 / 105 | 201 / 0 B |

All diagnostic claims released to zero. These are operation counts, not timing
or RSS acceptance. RED: two new retention tests failed as expected; GREEN:
53 source/service/renderer/config tests and typecheck passed. Five overlapping
claims still cover 32 MiB using two eligible 4 MiB sources per claim.

## Planned minimal change

- Modify only `server/apparel/apparel-source-reader.ts`: if no source has been
  admitted and a successful input exceeds 4 MiB (half the default claim budget),
  permanently use guarded uncached reads for the rest of that claim. This trades
  potential Storage savings in mixed/duplicate large-input plans for zero encoded
  cache retention and less bookkeeping. It is a conservative size policy, not a
  claim that every large image lacks reuse value.
- Reuse the existing async uncached branch and its baseline before/after checks.
  Preserve Promise rejection, lease/authorization checks, failed-read retry,
  disposal and initial in-flight deduplication. Once fallback starts, later reads
  have baseline behavior; prevent earlier pending reads from admitting bytes.
- Keep already admitted small sources and transient module-capacity recovery.
  Keep 8 MiB per claim / 32 MiB per module encoded accounting; neither is an RSS cap.
- Leave both production getter files unchanged. Development/test opt-ins remain
  independent; enabling in production still requires a reviewed code change.

## Test and verification sequence

1. Baseline source/config/harness tests (18 passing). Write RED cases for large
   input fallback, failed-read eligibility, concurrent completion and guarded
   disposal. Verify failure before the source-reader change.
2. Implement the single fallback/dispatch change, then run source, service,
   renderer and production-lock tests. Verify output hashes and error classes.
3. Repeat the source-boundary traces. Expected padded and 12MP claims have no
   retained cache and baseline read counts; normal keeps its seven avoided reads.
4. Prepare a new immutable benchmark evidence directory/fingerprint. Existing
   runner: independent processes, zero synthetic network delay, real 12MP and
   padded inputs, cold/warm separation, randomized balanced BR/RB, resource vetoes.
   Commands explicitly use `NODE_ENV=test` for the local mock. Normal mode must
   show baseline/reuse 14/7 reads, proving that the optimization was actually
   exercised rather than silently blocked by the production lock.

## Frozen bounded decision rules (before candidate timing)

First screen: exactly 2 cold pairs and 8 warm pairs per case, batches no larger
than 8. Stop if any available cold/window/order median exceeds +5%, an output or
release check fails, or resource/competition vetoes occur. Do not extend a failed
screen to hope its median turns positive. Keep every observation and failure.

Only if all screens pass, complete at most 40 warm and 10 cold pairs per case,
across at least two actual windows separated by 5 minutes, using the same fixed
candidate fingerprint. Do not run beyond those counts to rescue a failure. The
existing gate remains: P95 point change and paired/block 95% CI upper bounds
<= +5%; each window/order/cold median <= +5%; both orders, enough samples/windows,
identical outputs/inputs, correct release and no resource/failure blockers.

If this bounded candidate does not meet the gate, report the evidence and a path
to simplify/retire encoded reuse rather than adding normalized-image caching or
another long run. Passing an offline gate still cannot establish real-network
benefit, native RSS safety or production readiness. This round never unlocks it.

After performance work finishes: lint/typecheck/full tests, mock production build,
independent review, draft PR, exact-SHA CI. Raw logs/profiles/results go to Library.

## Outcome

**Whole-candidate result: not accepted; performance extensions stopped.** Normal
meets the offline gate, but oversized input fails the frozen confidence upper
bound at 32 warm pairs. Do not combine that result with normal or continue until
the estimate changes. The 12MP case remains screening only.

| Input | Warm / cold pairs | Reads off -> on | Warm window medians | P95 change | Paired / circular-block 95% upper | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Normal 750x1000 | 40 / 10 | 14 -> 7 | -0.71%, +0.14% | -0.56% | +4.06% / +3.31% | Offline gate met |
| Padded 10 MiB, 20 displays | 32 / 2 | 52 -> 52 | -1.24%, +1.70% | +2.84% | **+6.43% / +5.44%** | Stop: both uppers exceed +5% |
| Real 3000x4000, 12MP | 8 / 2 | 14 -> 14 | +0.32% | Not estimated at this sample count | Not estimated | Incomplete; no further timing after stop |

Normal and oversized observations have two actual non-overlapping windows
separated by at least 5 minutes; each has both BR/RB groups. All available
window/order/cold medians are <= +5%. Normal's cold median is +1.58%; oversized
has only 2 cold pairs (-1.77%) and 12MP only 2 (-2.62%). Normal's result does not
establish zero regression. Oversized confidence failure does not prove a stable
product regression or identify its cause; uncertainty exceeds the frozen gate.
The runner still lists its missing counts as pending alongside its explicit
confidence failure. Our bounded stopping rule treats that failure as a stop.

Every serial claim matched JPEG names, dimensions and hashes (11 outputs, or 30
for 20 displays), preserved source bytes, and released retained encoded bytes to
zero. Normal's sampled encoded peak was 3,223,716 B; oversized/12MP peaks were
zero. These are not native RSS or sustained-concurrency acceptance. No measured
batch was retried and no observations were removed.

The candidate benchmark SHA256 is
`2d555ccca93565d0fc576c1bcb06ec1cd2d3d887993f84073d68e001712e1812`;
manifest, runner and policy/statistics/resource hashes remain the frozen values
in the previous acceptance document. Node 24.19.0 / Sharp 0.35.3; full runtime,
chronology, order and resource records belong in the new Library artifact
`ZImage-2026-10-14-apparel-source-fallback-evidence.zip`. Historical v9 is preserved
independently, including the original failed oversized window and 12MP order group.

### Historical follow-up and activation boundary at e6d041b

No optimization was approved for production activation at the measured commit
e6d041b. Both published production getters were byte-identical to main and forced
off, regardless of opt-in values or future Supabase plan changes. At that commit,
development/test could exercise the candidate; normal mock Storage reads
halved, while the fixed
large-input policy sacrifices the old 12MP fixture's one saved read and possible
mixed/duplicate benefits. Storage pricing or capacity changes cannot relax the
performance decision rules.

The evidence supports zero retained encoded bytes for the tested large-first
plans, not a demonstrated latency fix. A next change should consider simplifying
or retiring encoded reuse for low-value plans, with a newly frozen fair baseline,
instead of adding normalized-image caching or rerunning this fingerprint to
rescue acceptance. The current minimal patch is a disabled candidate for review;
its confidence failure stays visible.

Still unmeasured: real Storage/network benefit; sustained concurrent native RSS;
12MP full 40-warm/10-cold gate; >12MP/max-decoded-pixel boundaries; 20 high-pixel
displays together; compressible high-pixel inputs below the 4 MiB encoded cutoff;
and mixed/duplicate large-plan cost. Unit tests cover concurrent reservation and
release, not native-memory safety. Visible loading and its desktop browser gate
are unchanged and belong to separate activation work.

Local validation: lint/typecheck pass; Domain 106, Web 733 and acceptance-budget
5 tests pass. The 47 SourceReader/service/renderer tests additionally pass as a
targeted group, including output equality and error classification. Web's full
suite includes production-lock checks. Final read-only independent review found
no blockers. Isolated mock Webpack build passes; generated `next-env` changes
were restored and owned `.next-build-qa` artifacts removed. Normal Turbopack,
coverage, Worker and database checks are delegated to exact-head draft-PR CI and
must be verified before delivery. The PR records those results without changing
this measured fingerprint. No merge, deployment or production flag change is
part of this task.

### Preparation provenance and retained failures

Before any timing, directory A (`apparel-fallback-performance-20261014`) prepared
an earlier dispatch refactor; that refactor was removed, and A has no batches or
trials. Directory B (`apparel-fallback-performance-minimal-20261014`) was rejected
at 2026-10-14 02:24:26.245 UTC because preparation incorrectly overlapped the
GREEN tests: `competing workload PID 1517; do not measure`. B has no fixtures,
batches or trials; its failure JSON and log are preserved. This is an unmeasured
preparation failure, not a measured latency result.

After those tests exited, directory C
(`apparel-fallback-performance-candidate-20261014`) successfully prepared the
final minimal source. Only C contributes timing observations, with one fixed
fingerprint and no measured batch retries. Its current timed evidence has zero
resource/competition blockers; this does not erase B's preparation rejection or
the historical v9 failed windows. The final Library archive must retain all three
directories' provenance; raw files stay outside Git. No production or paid model
work occurred.

## Runtime source-reuse retirement after review

The source getter now returns false in development/test as well as production;
the production guard remains unchanged. The existing submit service therefore
always selects its guarded `directLoad`; it never constructs a Reader for a
claim. No new Storage/RPC APIs or call sites, normalization cache, selector state, migration
or security/export changes were added. Visible loading keeps its original
development/test opt-in and production lock. The legacy source env variable is
retained but ignored, and its example comment now explains that behavior.

This withdraws an unaccepted optimization; it does not make the previous P95
failure pass. Current production already used `directLoad`, so its source
reads, authorization/lease checks and outputs do not change. Development/test
lose the normal fixture's 14 -> 7 read benefit and return to 14; there is no new
throttling, bandwidth or latency gain. Encoding retention from a runtime Reader
is zero because none is constructed; native RSS remains a separate concern.

The retained Reader implementation and its independent tests are historical
research material. Narrowing eligibility before construction would require
more information: the current authorized sources RPC exposes id/path, not
encoded size or dimensions, and normal/12MP have the same plan shape. No
photo-count heuristic or unverified metadata shortcut is introduced.

Historical off/on performance comparisons belong to the measured e6d041b
commit. The existing service benchmark's legacy env flag is also ignored at
the retirement commit; running it here cannot establish a reuse comparison.
Restoring a runtime entry requires a separate reviewed change and a fresh
frozen acceptance protocol.

### Frozen retirement verification budget (before verification)

- Zero new latency pairs or extensions of the old measurement directories.
- At most six new independent local mock functional renders: normal, padded
  oversized and true 12MP each once with the legacy opt-in off and once requesting
  it on. No warmup or render retries. No elapsed time/P95 acceptance is collected.
- Expect reads 14/14, 52/52 and 14/14; local authorization/lease callback counts
  28, 104 and 28; byte-identical inputs and output names/dimensions/hashes;
  retained encoded peak/after bytes zero; Reader factory calls zero.
- Instrument only the in-memory diagnostic bundle to count callbacks/factory
  calls; production service/Reader files remain unchanged in this closeout.
  Raw diagnostic scripts, records and logs stay outside Git and go to Library.
- Existing deterministic guard/error/lease/disposal tests and required local
  lint/typecheck/test/budget/build checks each run one quality round. Existing
  unit-suite renders remain unit checks, separate from the six-process diagnostic
  budget. New exact-head CI is required. Any failed functional check stops the
  six-render round; no replacement samples.

The six functional renders cannot establish latency, real-network savings or
sustained concurrent RSS safety. Historical v9, PR18's measured e6d041b evidence
and its confidence failure remain preserved. No production flag change, merge
or deployment is part of this closeout.

### Retirement verification outcome

Exactly six new independent processes completed, with zero warmups, retries or
new latency pairs. The legacy false/true pairs produced:

| Case | Storage reads | Local guard callbacks | Outputs | Reader factory / encoded retained peak and after |
| --- | --- | --- | --- | --- |
| Normal | 14 / 14 | 28 / 28 | 11 / 11 | 0 calls; 0 / 0 bytes |
| Padded oversized | 52 / 52 | 104 / 104 | 30 / 30 | 0 calls; 0 / 0 bytes |
| True 12MP | 14 / 14 | 28 / 28 | 11 / 11 | 0 calls; 0 / 0 bytes |

All original input hashes remained unchanged. Every output name, dimensions and
hash matched the immutable e6d041b baseline; no network fetch was attempted.
Both exact in-memory counter hooks loaded once; source files were not patched.
The resource checks did not reject or abort a child, and the owned lock was
released. Callback counts are local authorization/lease checks, not RPC counts.
This is functional verification of the direct path, not a new performance pass.

One local quality round passed: lint/typecheck, Domain 106, Web 733 and
acceptance-budget 5 tests, plus the isolated mock Webpack build. The earlier
config-only TDD RED check had the expected three failing opt-in assertions;
it rendered no pages. No additional targeted GREEN round ran. Generated
`next-env` changes were restored and owned QA build artifacts removed. Read-only
independent review found no code blockers; its two historical-document wording
corrections were applied. Standard Turbopack, coverage, Worker and local database
checks remain the exact-head draft-PR CI verification, recorded on PR18 before
delivery. There is no browser or real-environment acceptance claim.

New raw scripts, fingerprints, functional results, resource records, logs and
the exact-head CI snapshot belong to the separate Library archive
`ZImage-2026-10-14-apparel-source-retirement-evidence.zip`. The finalized fallback
archive remains unchanged and is included byte-for-byte; neither archive enters
Git or changes the original failed performance conclusion.
