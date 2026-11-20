# GitHub Actions: isolated release candidates

This workflow is an additive first step. It does not replace `ci.yml`, its
manual quality/database checks, existing branch protection or the production
release/rollback gates. It never connects to ECS, uses production secrets,
executes a production receipt or publishes a site. Do not use its artifacts as
inputs to the existing production workflow.

## Starting a rehearsal

1. Review the code on GitHub, including the exact action commits. Restrict
   `release-rehearsal` to protected `main` and require independent reviewer
   approval before enabling runs. Disable self-review and bypass where the
   GitHub plan permits; if unavailable, do not treat this environment as an
   approval boundary. Do not put any secrets in it.
2. Configure `ZIMAGE_RELEASE_TARGET_JSON` with the independently verified ECS
   runtime/toolchain/cache fingerprint. The named runner is not sufficient:
   the package tool rejects a differing Node version, ABI, platform or glibc.
   Backend rehearsal uses HTTP mode without production Supabase values; it is
   a packaging rehearsal, not authenticated production evidence.
3. Choose **ZImage isolated release candidates**, select protected `main`,
   and choose exactly one component. Backend builds the actual fontless
   schema-3 layered transport, verifies the cold object's closure again, and
   uploads that transport and its rehearsal-only SHA file. Frontend requires
   the exact backend SHA to evaluate and a controlled, public
   `ZIMAGE_REHEARSAL_PUBLIC_CONFIG_JSON` from a staging contract. It builds
   Vite once and records the official `--subject-only` digest. The optional
   frontend payload is for inspection, not a formally approved frontend package.
4. Review the SHA, run ID and attempt in the uploaded rehearsal receipt. The
   workflow does not create a candidate or approval accepted by production.
   Artifacts are readable to users with repository access; only payload and
   explicit digest metadata are listed for upload. There are no traces, test
   videos, Playwright reports or environment files. Retention is two days.

## Before enabling production

Keep deployment manual, with main-only verified build provenance and immutable
artifacts. Reconcile schema 3 with the pinned, independently reviewed lifecycle
verifier and the server-side backend receipt workflow. Rehearse with the actual
isolated staging service first; prove exact rollback and authenticated health.
For frontend, verify the exact subject against the nominated backend in staging,
then use the existing packer and independent root-managed acceptance; an
allowlist, checksum or GitHub receipt is not that acceptance.

Protect one production workflow with independent reviewers, main restrictions,
no self-approval/bypass and least-privilege credentials. Serialize production
backend deployment, frontend deployment and rollbacks in the same concurrency
group with cancellation disabled. Promotion must download the same verified
bytes, revalidate their GitHub run provenance and hash, require explicit pinned
SSH host keys if using SSH, validate all component receipts, record the current
exact release(s), and verify after activation. Fail closed on missing tags,
host keys, provenance, receipts, approvals or health; use the already validated
exact rollback target. This document does not authorize those steps.

References: [secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[protected environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).
