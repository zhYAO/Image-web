#!/usr/bin/env bash
# Verify artifacts; only the separate hosted smoke mode runs them locally.
set -euo pipefail
[[ "$GITHUB_EVENT_NAME" == push && "$GITHUB_REF" == refs/heads/main && "$GITHUB_REF_PROTECTED" == true ]] || { echo 'Protected main push required for pair review.' >&2; exit 1; }
test "$GITHUB_REPOSITORY" = 'zhYAO/Image-web'
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[1-9][0-9]{0,19}$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]{0,7}$ ]] || { echo 'Malformed workflow identity.' >&2; exit 1; }
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

# Tests can exercise metadata policy without a hosted runner or remote fetch.
if [[ ${1:-} == --metadata-only ]]; then exit 0; fi
phase=${1:-}
[[ "$#" -le 1 && ( -z "$phase" || "$phase" == staging || "$phase" == production || "$phase" == hosted-smoke ) ]] || { echo 'Unknown or ambiguous review mode.' >&2; exit 1; }
if [[ "$phase" == hosted-smoke ]]; then
  [[ "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${RUNNER_OS:-}" == Linux &&
     "${ZIMAGE_PAIRED_BUILD_MODE:-}" != true && "${ZIMAGE_PAIRED_PRODUCTION:-}" != true ]] || { echo 'Hosted smoke requires a GitHub-hosted Linux runner with promotion disabled.' >&2; exit 1; }
elif [[ -n "$phase" ]]; then
  [[ "${RUNNER_ENVIRONMENT:-}" == self-hosted && "${ZIMAGE_PAIRED_ROLE:-}" == "$phase" && "${ZIMAGE_PAIRED_ENABLED:-}" == true ]] || { echo 'Protected promotion requires the matching isolated runner role.' >&2; exit 1; }
fi
[[ "$BACKEND_MANIFEST_SHA" =~ ^[a-f0-9]{64}$ && "$FRONTEND_SUBJECT_SHA" =~ ^[a-f0-9]{64}$ ]]
[[ -n ${REHEARSAL_PUBLIC_CONFIG:-} && ${#REHEARSAL_PUBLIC_CONFIG} -le 16384 ]] || { echo 'Missing staging public configuration for pair intake.' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" && -z "$(git status --porcelain)" ]]
umask 077
private=$(mktemp -d "$RUNNER_TEMP/zimage-pair.XXXXXXXX")
trap 'rm -rf -- "$private"' EXIT
printf '%s\n' "$REHEARSAL_PUBLIC_CONFIG" > "$private/config.json"
unset REHEARSAL_PUBLIC_CONFIG
gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$BACKEND_ID/zip" | head -c 100000001 > "$private/backend.zip"
gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$FRONTEND_ID/zip" | head -c 100000001 > "$private/frontend.zip"
tree=$(git ls-tree -r --full-tree HEAD | sha256sum)
lock=$(sha256sum pnpm-lock.yaml)
python3 - "$private/pins.json" "${tree%% *}" "${lock%% *}" <<'PY_PINS'
import json, os,sys
e = os.environ
def pin(component, extra_name, extra_source):
    return dict(artifactSha256=e[f'{component}_ARTIFACT_DIGEST'], archiveSha256=e[f'{component}_ARCHIVE_SHA'],
                receiptSha256=e[f'{component}_RECEIPT_SHA'], **{extra_name:e[extra_source]})
with open(sys.argv[1], 'x') as stream:
    namespace = ('release-' + e['GITHUB_SHA'][:12]) if e.get('ZIMAGE_PAIRED_BUILD_MODE') == 'true' else (
        f"rehearsal-{e['GITHUB_SHA']}-{e['GITHUB_RUN_ID']}-{e['GITHUB_RUN_ATTEMPT']}")
    json.dump(dict(commit=e['GITHUB_SHA'], runId=int(e['GITHUB_RUN_ID']), attempt=int(e['GITHUB_RUN_ATTEMPT']),
                   frontendNamespace=namespace, treeFingerprint=sys.argv[2], lockfileSha256=sys.argv[3],
                   backend=pin('BACKEND','manifestSha256','BACKEND_MANIFEST_SHA'),
                   frontend=pin('FRONTEND','subjectSha256','FRONTEND_SUBJECT_SHA')), stream)
PY_PINS
status=0
python3 -I -B ops/aliyun/github-rehearsal-intake.py --pins "$private/pins.json" --backend "$private/backend.zip" \
  --frontend "$private/frontend.zip" --public-config "$private/config.json" > "$private/report.json" || status=$?
test "$status" = 2
current=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)
test "$current" = "$GITHUB_SHA" || { echo "Main changed during pair intake; not eligible for promotion planning." >&2; exit 1; }
python3 - "$private/report.json" <<'PY_REPORT' >> "$GITHUB_STEP_SUMMARY"
import json,sys
with open(sys.argv[1]) as stream:
    report = json.load(stream)
if report['immutablePairVerified'] is not True or report['productionReady'] is not False or report['status'] != 'blocked':
    raise ValueError('Unexpected rehearsal result')
print('Exact pair byte verification passed. Production remains blocked until staging and approvals.')
PY_REPORT


if [[ "$phase" == hosted-smoke ]]; then
  # Leave verified bytes for the next step, after this token-bearing
  # shell exits. No fixture process runs in this step.
  test ! -e "$RUNNER_TEMP/zimage-hosted-smoke"
  mv -T -- "$private" "$RUNNER_TEMP/zimage-hosted-smoke"
elif [[ -n "$phase" ]]; then
  # No app credentials are transported in GitHub artifacts. The preinstalled
  # target-specific controller owns challenge/auth material and root approvals.
  python3 -I -B ops/aliyun/github-paired-controller.py "$phase" --pins "$private/pins.json" \
    --backend "$private/backend.zip" --frontend "$private/frontend.zip" --config "$private/config.json"
fi
