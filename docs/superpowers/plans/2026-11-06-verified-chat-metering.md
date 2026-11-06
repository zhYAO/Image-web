# Verified chat metering and activation readiness

> **For agentic workers:** Use superpowers:executing-plans inline, then independent review.

**Goal:** Prepare safely chargeable new chat and identify the exact remaining prerequisites for image analysis and package activation without changing live availability.
**Architecture:** Keep existing funded Edge claims and immutable snapshots. Add an optional version2 OpenAI metering profile to new tariffs/receipts; preserve legacy snapshot settlement. Add a new local migration rather than altering applied M6. Keep prices/models disabled.
**Tech Stack:** TypeScript/Zod, Vitest, PostgreSQL, Deno/Supabase Edge.
**Spec:** User-confirmed token billing, image fixed successful-count billing, markup100%, package minimum0.5, pre-image cancellation refund, unknown outcome held; requirements.md and latest parent delegation.

## Global Constraints

- Original branch only; preserve next-env.d.ts and all23 .env.local entries.
- No paid calls, production DDL, price publication, Secret edits or enabling flags.
- Only exact official model IDs; account access not inferred from public docs.
- Existing receipts/orders remain readable and idempotent; no historical retries/refunds.
- Derive directory costs from current documented rates, never label them final supplier cash bills.

## Review Focus

- A cache write is a replacement input category, not an extra input surcharge.
- Actual tier or inconsistent stream identity cannot silently select a cheap tariff.
- Missing optional usage fields must not become fabricated zero evidence.
- Old snapshots must retain original settlement; incomplete new tariffs cannot admit new OpenAI calls.
- Public catalog must show write rate/cap while runtime and database snapshots agree.

### Task1: Funded OpenAI metering profile
Files: packages/domain/src/chat-token-pricing.ts and tests; shared openai-chat-relay.ts and tests; a CLI-generated local migration; chat_usage SQL tests; credits catalog/UI schema/tests.
Interfaces: meteringVersion2, serviceTier default, cacheTtl30m, cacheWritePerMillionNano in frozen tariff; cacheWriteTokens and actual serviceTier in trusted receipt. Legacy fields remain supported only for already frozen settlement.
- [x] Write failing domain tests for cap using maximum input/write cost, one-rounding mixed categories, missing write/tier, tier mismatch and impossible cache sum.
- [x] Implement domain parser/math with legacy snapshot compatibility; verify targeted tests.
- [x] Write failing Edge tests for explicit default/30m request, trusted tier/write receipt, conflicting stream identities, missing fields; implement and verify without real network.
- [x] Generate new migration with CLI. Add local SQL parity/admission/ACL/idempotency tests; implement replaced existing functions without wider grants or enabled rows.
- [x] Update catalog and existing credit display for write rate; verify focused tests.

### Task2: Analysis/package evidence and exact configuration
Files: official reference/activation document; ark-completion and receipt parsing tests if evidence exposes a fault.
- [x] Trace configured model, endpoint, tier, usage and pricing through analysis/planning/Seedream.
- [x] Repair any reproduced trustworthy-usage defect using RED→GREEN; leave unknown evidence held.
- [x] Confirm production project and Secret names only, and missing nonsecret mappings/flags; never reveal values.
- [x] Prepare exact proposed models/prices/caps and lowest-cost real acceptance budget for parent/user decision. No activation.

### Task3: Verification and handoff
- [x] Run domain/Web/Worker/isolated SQL, native Deno checks, lint/type/budget and builds as applicable to final code.
- [x] Fresh independent code review, then RED→GREEN important fixes and required regression.
- [x] Update project-progress.md with actual production-open status and current candidate evidence/remaining approval gates.
- [x] Commit only authorized source/docs locally, never user next-env/env, push or deploy.

Ruling: Execute on the existing user-selected development branch, no worktree/branch switch; parent explicitly requested continued implementation so no repeated plan confirmation.


Completed locally on2026-11-06; activation remains explicitly blocked by the fee/model/real-call approvals documented in model-activation-readiness. Source fingerprint42df855c…; full286/195/1313, Worker148, PG17/18 SQL240, nativeDeno and both QA builds pass.
Ruling: Use a distinct Ark V3 standard profile instead of fabricating OpenAI write counts/TTL — different provider metering — wrong mapping/profile holds rather than charges.
Final: fixed contradictory terminal stream evidence — three RED→GREEN cases, complete suite green; explicit user AbortError with verified usage covered independently.
Deferred minors: numeric-string SQL/domain parity; JSON key-order duplicate-usage conservatism; Ark total256k bound versus domain512k under extreme settings; direct metadata legacy/parser retention coverage.
