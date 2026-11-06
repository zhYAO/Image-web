# Doubao Supabase Relay Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Work on the original branch; do not commit.

**Goal:** Keep supplier credentials only in Supabase while retaining funded chat, field optimization, and A+ stage ownership and recovery.

**Architecture:** Secret-authenticated Edge functions admit only a durable funded chat or claimed package/text stage. SQL freezes attempt identity before a single official Ark request; receipts persist before return and are replayed without buying again. Web retains private image authorization/Sharp processing and factual output validation.

**Tech Stack:** Next.js 16, Supabase Edge, PostgreSQL, existing Vitest and disposable PostgreSQL tests.

**Spec:** User-authorized provider-secret centralization; doc/requirements.md and doc/commerce-package-operations.md.

## Global Constraints
- No actual secrets, production configuration, deployment, paid calls, .env.local cleanup, commits, or branch changes.
- New gateways disabled by default. No arbitrary URL/model overrides.
- Preserve legacy results and pending orders; never call a supplier for an old ambiguous claim.
- Unfunded legacy preview has no durable supplier attempt proof; fail closed before mutation when the actual Edge transport is selected.
- Existing user next-env.d.ts unchanged.

## Review Focus
- Duplicate and concurrent submissions must admit one supplier attempt.
- Owner, session, reference roles, stage claim, model budget and frozen input must match.
- Lost terminal receipt must remain recoverable; unknown responses never trigger a second purchase.
- Private images and prompt bodies must not be stored in the new attempt ledger or logged.
- Missing flags, configuration and unpriced standalone analysis must fail closed.

### Task 1: Funded Doubao chat
- [x] Add RED resolver/Edge tests for no Web Ark secret, SQL ownership and duplicate claims.
- [x] Generalize the reviewed chat relay with a dedicated Doubao mode and SQL RPC; keep OpenAI behavior.
- [x] Run focused chat tests and SQL assertions.

### Task 2: Claimed optimize and package stages
- [x] Add RED transport tests for bounded payload, only owned frozen stages, one attempt and saved receipt replay.
- [x] Add service-only attempt RPC and dedicated Edge function; freeze payload fingerprint, source model/budget from order, validate reference ownership again.
- [x] Use Web-only Supabase transport; retain compiled prompts and normalized private images without provider credentials.
- [x] Add read-only receipt recovery to package/optimize pending paths; never start on recovery.
- [x] Run focused Web/Worker/SQL tests.

### Task 3: Review and verification
- [x] Independent security review and fixes.
- [x] Full offline regression, lint, types, budgets, local SQL concurrency, isolated builds; preserve next-env.
- [x] Document configuration names and remaining native Edge/browser limitations.
