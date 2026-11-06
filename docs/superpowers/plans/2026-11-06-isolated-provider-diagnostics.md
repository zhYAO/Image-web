# Isolated small provider diagnostics implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, then one independent review.

**Goal:** Prepare a disabled, service-only, at-most-two-call OpenAI Chat diagnostic without user billing or production configuration changes.
**Architecture:** A separate Edge entry authenticates the existing Supabase service identity; a new private campaign/attempt ledger authorizes and consumes exactly one Astra attempt then one Sol attempt. All provider messages, endpoint, service tier, caching profile and output cap are fixed in code and checked against the SQL claim. SQL starts empty: no campaign, price or enable operation is seeded. An uncertain result never releases an attempt for another provider request.
**Tech Stack:** TypeScript/Vitest, Deno/Supabase server SDK, PostgreSQL/pgTAP.
**Spec:** Parent delegation2026-11-06: independently prepare and review a controlled small isolated test path; really bound request input/output, do not affect formal configuration or user credits, no paid calls. Model decision artifact verification/model-provider-decision-2026-11-06.md.

## Global Constraints

- Original development branch; preserve user next-env.d.ts and all23 .env.local entries.
- No deployment, production DDL/Secret/flag/price changes, real credentials or paid calls.
- Fixed models gpt-6-astra and gpt-6.1-sol; one attempt each, no retries, no arbitrary prompt/history/tools/images/endpoint or model overrides.
- Fixed one-message ASCII input, UTF-8 length bounded before claim; max_completion_tokens128; actual input usage above2048 stops the campaign. Chat has no independent max input token parameter: the hard request control is the immutable short payload, not a false claim of a vendor token hard cap.
- Separate diagnostic gate defaultfalse. Future campaign arming is a separately approved database-owner operation with expiry<=15minutes and an approval reference. No arming endpoint.
- Any timeout, malformed/incomplete/conflicting/tier-mismatch/overbudget receipt or persistence loss remains spent/needs_review; no supplier resend.
- No wallet/order/chat-history/tariff access or mutations. No generated text/raw provider error/secret values in output or ledger.
- Preserve production authentication patterns; migration service_role execution permission requires later explicit production approval.

## Review Focus

- Concurrent duplicate claims and acknowledgement loss must never produce another supplier attempt.
- Caller-controlled extra fields and URL query cannot change fixed input, output, model, endpoint or supplier headers.
- A killed process after claim and lost final write must remain spent and block the next model.
- Provider success with contradictory identity, usage or termination must not be reported as verified.
- Campaign expiry, disabled gate, fake service identity and empty setup must prevent all paid network traffic.

### Task1: Durable isolated campaign ledger
Files: CLI-created supabase/migrations/*_isolated_provider_diagnostics.sql; supabase/tests/database/provider_diagnostics.test.sql; native test runner integration.
Interface: public.provider_diagnostic(uuid,text,text,jsonb), service_role only, actions claim/status/record; slots astra/sol. Ready claim returns fixed profile and model; replay never returns start. SQL records vetted receipt or a bounded reason code. No campaign creation RPC.
- [x] Write SQL tests for defaultempty/ACL, expiry, disabled/missing campaign, two fixed slots/order, replay/unknown, invalid evidence and unchanged funds.
- [x] Observe RED; implement isolated tables and dispatcher with row locks and immutable terminal results.
- [x] Verify pgTAP and two-connection contention; no user financial table changes.

### Task2: Bounded opt-in Edge path
Files: _shared/provider-diagnostics.ts; provider-diagnostics/{index.ts,deno.json,deno.lock}; generation-worker/provider-diagnostics.test.ts; native diagnostics-auth.deno.ts; config.toml only new disabled function stanza.
Interface: handleProviderDiagnostic(Request,{authorized,admin,env,fetcher}); strict POST {campaignId,slot,action:run|status}. Gate ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED=true and exact configured ZIMAGE_PROVIDER_DIAGNOSTICS_CAMPAIGN_ID are necessary but insufficient without approved SQL row.
- [x] Write behavior tests first for no-authority/no-gate/no-campaign, injection/byte bounds, fixed payload, duplicate/unknown, full trustworthy SSE and contradictory/bounded streams.
- [x] Observe RED; implement fixed request and bounded parser; persist before returning verified metadata. No user balance calls.
- [x] Verify Vitest and cached native Deno with synthetic credentials and network denied.

### Task3: Review and handoff
- [x] Run complete project regression, Worker tests, SQL suite, lint/typecheck and native checks against final candidate.
- [x] Independent security review; reproduce and fix important findings RED→GREEN, rerun affected and complete checks.
- [x] Document the exact later production approvals/arming steps and budget limitations; update progress and commit only owned local code. Do not push or deploy.

Ruling: Execute inline on user-selected branch; parent explicitly authorized implementation, so do not repeat generic design/plan approval.
Ruling: Keep generated text out of diagnostics evidence; this validates API/tier/usage and safety, not reply quality or production wallet behavior.
Final: fixed nonstring action/slot coercion could bypass the disabled gate — three reproduced failures, strict type guards and a mandatory nonstatus run gate; real SDK negative cases added.
Final: fixed cross-choice completion evidence — five RED cases, every choice must have numeric index0.
Final: fixed requested cache TTL being labeled as supplier evidence — RED→GREEN; new requestedCacheTtl explicitly identifies the request policy, frozen by request SHA, rather than asserting a returned TTL.
Final: minor (deferred): terminal record SQL NULL returns the existing immutable status rather than rejecting a conflicting/missing result; no reset, extra provider attempt or financial mutation. Tighten with IS DISTINCT FROM and add SQL/JSON null cases before extending this diagnostic API.
Ruling: The Chat API exposes no independent input-token maximum. Enforce the immutable60-byte request messages and a128-byte guard; actual usage2048 is a conservative validation threshold. A true provider token or final cash cap cannot be promised; violating evidence halts the campaign.
Final verification2026-11-06: full domain286/frontend195/Web1313, Worker188 including40 new, nativePG17 assertions267 plus5 concurrency groups, Deno6checks/7network-denied realSDK tests, budget5, lint/typecheck and both isolated QA builds pass. Fingerprintf4aeabbdd01dcdfd87eb0eb713d0c1b014af172775fb310926d6e115dc3320c0. All important review fixes covered by RED→GREEN; no re-review was claimed. SQL NULL minor independently reproduced with immutable state and exactly1 attempt; JSON null rejected.
