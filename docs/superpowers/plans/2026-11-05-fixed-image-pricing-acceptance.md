# Fixed image pricing and isolated acceptance implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Original branch only; no commit or production operation.

**Goal:** Charge newly quoted A+ sets by frozen model/spec image prices and successful delivered counts; retain raw supplier usage for cost estimates and old-order recovery.

**Architecture:** Add explicit fixed_images snapshot mode. An immutable sale version publishes per-model/resolution/spec cost estimates plus the configured markup; each resulting image price is fixed at quote acceptance. Whole-order minimum remains 50 minor when at least one image succeeds. Supplier usage valuation is an independent estimate, never an invoice assertion. Existing fixed/actual_capped snapshots retain their original calculators and cannot become new public quotes.

**Tech Stack:** Existing TypeScript domain, Next UI/API, service-only PostgreSQL, Deno 2.9.8 and pinned Supabase SDK.

**Spec:** Latest user-confirmed fixed image pricing; analysis/planning included; pre-image cancellation full refund; known failures refunded; unknown results pending; no approved production unit prices yet.

## Constraints
- Retain 23 local env entries; no key values, production changes, deployment, paid model calls, branch switches or commits.
- Only synthetic price fixtures. Empty/unapproved sale config never admits quotes.
- Old snapshots/unknown requests retain financial identity and recovery.
- Native SDK testing uses fake environment and denied network; browser harness is local, secret-free and network-blocked, no listening port retry.

## Review focus
- Success count/price tampering, duplicate accept/cancel/settle, whole-order minimum, unknown results.
- Legacy snapshot preservation and upfront unit-price display by model/spec.
- Cost estimation must not be labelled actual supplier payment or exposed as private pricing to retail clients.
- Missing metering is auditable; delivery uncertainty prevents automatic billing.
- Actual cloud project/migration/Secret metadata stays read-only.

### Task 1: Fixed image snapshot
- [ ] RED domain tests: fixed units independent of returned supplier cost; partial success; zero success; whole minimum; unknown hold; unpriced spec rejection; old snapshot replay.
- [ ] Add fixed_images and explicit published model/resolution/spec price estimates with approval evidence. Compute unit price with markup using BigInt; no built-in production rates.
- [ ] Preserve legacy pricing; add independent configured_usage_estimate helper.

### Task 2: Server, SQL and UI
- [ ] Only new fixed_images config admits quotes; immutable snapshots retain exact unit prices.
- [ ] Update unapplied local package migration and SQL fixtures; enforce one reservation and successful-count settlement, preserve old calculators.
- [ ] Show model/spec, per-image fixed price, total/minimum and refund/unknown rules; keep backend costs private.
- [ ] Save known completed text even when usage is missing; record usage unknown instead of inventing it.
- [ ] Add tests for cross-layer minimum, atomic refunds, historical behavior and cost-vs-invoice wording.

### Task 3: Acceptance
- [ ] Fix native Deno SDK typing (RED observed on 3 new entries); native check all 5 entries and execute real SDK auth with fake credentials/no network.
- [ ] Manual Edge browser harness for A+ workflow, selectors, disabled states and recovery at desktop/mobile without HTTP listener.
- [ ] Re-run SQL concurrency, independent review, full regression, lint/types/budgets/builds; preserve next-env.
- [ ] Record metadata, verified price estimates, and exact remaining approvals/cost risks.

本地实现与独立审查已完成，最终全量回归/构建进行中；真实浏览器与完整 Supabase Edge 环境仍未验收。具体结果以 doc/project-progress.md 与 verification 证据为准。

最终本地自动验收已通过，见最新项目进度和最终代码指纹。真实环境验收仍为blocked，不标记上线完成。
