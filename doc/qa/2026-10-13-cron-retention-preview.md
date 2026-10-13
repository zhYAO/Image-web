# Cron history: read-only preview and approval package

Project `klmiycyesxnpinxpeqep`. This report prepares an approval scope; it does not authorize or execute deletion, migration, grants, schedule changes, or VACUUM.

## Frozen preview

Observed 2026-10-13 08:14:56–08:16:28 UTC using SELECT-only transactions with `statement_timeout=5s`. Successful rows must have `end_time < 2026-09-29T08:15:00Z`; failed rows must have `end_time < 2026-09-13T08:15:00Z`. The cutoffs are frozen, not moving `now()` predicates. SQL queried Cron metadata only; no command, return_message, Vault, credit audit or user records, and no log scan.

| Current mapping | Schedule (unchanged) | Eligible succeeded | Recent retained |
|---|---|---:|---:|
| 1 / zimage-cleanup-worker | every 15 minutes | 3,368 | 1,345 |
| 2 / zimage-generation-worker | every minute | 50,500 | 20,161 |
| 3 / no current mapping | no current job | 0 | 2,457 (unmapped; preserve) |

At the aggregate snapshot, 77,831 total history rows, 53,868 eligible, 23,963 retained. Eligible mapped rows were all succeeded; no failed, unfinished or unknown-status rows were present in this snapshot. New rows continue arriving, so total/retained counts will drift; frozen candidate scope must not expand automatically. Candidate ended-time range: 2026-08-25 06:15:00.159331 through 2026-09-29 08:14:00.253850 UTC. A succeeded Cron SQL invocation does not prove its asynchronous HTTP Worker returned a successful business result.

`pg_database_size`: 102,190,227 B (102.19 decimal MB); `pg_total_relation_size(cron.job_run_details)`: 81,977,344 B (81.98 decimal MB, 78.18 MiB). These are live PostgreSQL measures, not a new platform usage/billing reading. Relation bytes include indexes/allocated space; rows cannot be translated into an exact byte saving. Previous platform usage estimate ~117 MB remains a separate historical measure. Archive table and prune function were both absent: production migration has not been applied.

## First concrete batch, awaiting approval

Batch 001 exact metadata is stored separately in the [Library evidence archive](https://chatgpt.com/api/library/files/libfile_505a1272e2888191be16778b7bb2b2d5/download), not in this repository: 500 unique ordered run IDs, summarized as 1–500; job1=32, job2=468, all succeeded, ending 2026-08-25 06:15:00.159331–14:14:00.085442 UTC. SHA256 of the exact UTF-8 JSON file inside that archive:

`32429c0da10d90abba3f20729ce0fbb257effda2dac8d8d34fbb45056fa429e8`

Only this first batch has an exact manifest. The aggregate 53,868 candidates are not a reviewed all-row deletion list. At 500 maximum per transaction, clearing that aggregate would need 108 independently bounded batches; later manifests must be generated and reviewed before execution. `approved=false` is intentional.

## Archive and rollback checklist

1. Separately review and approve applying the dormant migration `20261013033300_cron_history_approved_retention.sql`. It creates a private SECURITY INVOKER function and metadata archive, grants no application access, and installs no schedule. This task did not apply it.
2. Separately approve batch001's exact job mapping, frozen cutoffs, 500 IDs/count/hash, approval reference, and sensitive-field omission. Recheck the same manifest at execution; if job mapping/metadata changes, stop and refresh approval rather than expanding scope.
3. Before execution, retain this manifest and a checksum outside the affected database in an approved location. Archive only runid/jobid/status/start/end/archived_at/approval_reference. Raw command and return_message are excluded and cannot be reconstructed from this archive; obtain explicit acceptance before permanent deletion. No credit audit tables are touched.
4. Execute only through an authorized administrator after approval, each batch in its own transaction with a 5s statement timeout, 500ms lock timeout, unchanged native privileges and the function's advisory transaction lock. The archive and DELETE must commit atomically with exact counts; any failure rolls back the transaction. This checklist is not an executed command list.
5. A rollback before COMMIT restores the whole transaction. After COMMIT, retained metadata is evidence, not a lossless restore of native history. Restoring original command/return_message would need a separately approved protected full backup and restore plan; never claim metadata-only pruning is fully reversible.
6. Check archive capacity (<100,000 rows), row counts, current schedule and database/relation bytes after any approved batch. Pause on mismatch. Standard maintenance and archive export need their own review; never run VACUUM FULL or promise an immediate file/billing reduction. No automatic retention scheduling is approved.

Official context: [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart) confirms job history is retained even after a job is unscheduled. The changelog Markdown fetch was unavailable in this environment (403/unsupported content type); the current Cron docs were retrieved using the connected documentation tool. No schema behavior was changed on that basis.
