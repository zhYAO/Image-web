#!/usr/bin/env bash
# Metadata-only: no download/execute, acceptance, production receipt, or deploy.
set -euo pipefail
[[ "$GITHUB_EVENT_NAME" == push && "$GITHUB_REF" == refs/heads/main && "$GITHUB_REF_PROTECTED" == true ]]
test "$GITHUB_REPOSITORY" = 'zhYAO/Image-web'
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[1-9][0-9]{0,19}$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]{0,7}$ ]]
test "$BACKEND_ID" != "$FRONTEND_ID"
for id in "$BACKEND_ID" "$FRONTEND_ID"; do [[ "$id" =~ ^[1-9][0-9]{0,19}$ ]]; done
for sha in "$BACKEND_ARTIFACT_DIGEST" "$BACKEND_ARCHIVE_SHA" "$BACKEND_RECEIPT_SHA" "$FRONTEND_ARTIFACT_DIGEST" "$FRONTEND_ARCHIVE_SHA" "$FRONTEND_RECEIPT_SHA"; do
  [[ "$sha" =~ ^[a-f0-9]{64}$ ]]
done
current=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)
test "$current" = "$GITHUB_SHA" || { echo 'Stale main run; not eligible for promotion planning.' >&2; exit 1; }
for component in backend frontend; do
  if [[ "$component" == backend ]]; then
    id=$BACKEND_ID; digest=$BACKEND_ARTIFACT_DIGEST
  else
    id=$FRONTEND_ID; digest=$FRONTEND_ARTIFACT_DIGEST
  fi
  name="rehearsal-$component-$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id" |
    python3 -c 'import json,sys; v=json.load(sys.stdin); i,name,digest,run,sha=sys.argv[1:]; binding=v.get("workflow_run") or {}; ok=(v.get("id")==int(i) and v.get("name")==name and v.get("digest")=="sha256:"+digest and v.get("expired") is False and binding.get("id")==int(run) and binding.get("head_branch")=="main" and binding.get("head_sha")==sha); sys.exit(0 if ok else "Mismatched, expired, or foreign rehearsal artifact.")' \
      "$id" "$name" "$digest" "$GITHUB_RUN_ID" "$GITHUB_SHA"
done

{
  printf 'Rehearsal only (no production approval): %s, run %s attempt %s\n\n' "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
  printf 'Backend artifact %s (GitHub SHA-256 %s), archive %s, receipt %s\n\n' "$BACKEND_ID" "$BACKEND_ARTIFACT_DIGEST" "$BACKEND_ARCHIVE_SHA" "$BACKEND_RECEIPT_SHA"
  printf 'Frontend artifact %s (GitHub SHA-256 %s), archive %s, receipt %s\n' "$FRONTEND_ID" "$FRONTEND_ARTIFACT_DIGEST" "$FRONTEND_ARCHIVE_SHA" "$FRONTEND_RECEIPT_SHA"
} >> "$GITHUB_STEP_SUMMARY"
