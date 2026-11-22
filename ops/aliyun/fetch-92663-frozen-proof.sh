#!/usr/bin/env bash
# Trusted read-only input step. Never execute anything from the downloaded ZIP.
set -euo pipefail
umask 077
ref=refs/heads/codex/zimage-protected-stage-netproof-20261122
[[ "$GITHUB_REPOSITORY" == zhYAO/Image-web && "$GITHUB_EVENT_NAME" == push && "$GITHUB_REF" == "$ref" &&
   "$GITHUB_WORKFLOW_REF" == "zhYAO/Image-web/.github/workflows/protected-stage-netproof.yml@$ref" &&
   "$RUNNER_ENVIRONMENT" == github-hosted && "$RUNNER_OS" == Linux && -n ${GH_TOKEN:-} ]]
id=14777214656
sha=92663c46ffa483319ad8d7cd9318ac41f258aa12
digest=26edbf5f79980c68873e8b03bca667a8f878e0ceab68672034d5bea6f3a0f8a2
name="ecs-byte-proof-$sha-45083109340-1"
dest="$RUNNER_TEMP/zimage-frozen-92663"
mkdir -m 700 -- "$dest" "$dest/files"
route="repos/zhYAO/Image-web/actions/artifacts/$id"
gh api "$route" > "$dest/metadata.json"
python3 -I -B - "$dest/metadata.json" "$sha" "$digest" "$name" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); w=m.get('workflow_run', {})
if (m.get('id'),m.get('name'),m.get('digest'),m.get('size_in_bytes'),m.get('expired'),
    w.get('id'),w.get('head_sha'),w.get('head_branch'),w.get('repository_id')) != (
       14777214656,sys.argv[4],'sha256:'+sys.argv[3],5964117,False,
       45083109340,sys.argv[2],'codex/zimage-exact-shadow-diagnostic-20261122',1329578390):
    raise ValueError('Exact frozen artifact unavailable or changed')
PY
gh api "$route/zip" | head -c 5964118 > "$dest/original.zip"
[[ "$(wc -c < "$dest/original.zip")" -eq 5964117 ]]
printf '%s  %s\n' "$digest" "$dest/original.zip" | sha256sum --check --status
python3 -I -B - "$dest" <<'PY'
from pathlib import Path
import stat,sys,zipfile,shutil
d=Path(sys.argv[1])
caps={'backend.zip':40_000_000,'frontend.zip':40_000_000,'config.json':16384,'pins.json':16384,'statement.json':16384}
with zipfile.ZipFile(d/'original.zip') as z:
    members=z.infolist()
    if len(members)!=len(caps) or {i.filename for i in members}!=set(caps) or sum(i.file_size for i in members)>40_000_000:
        raise ValueError('Unexpected exact flat inputs')
    for i in members:
        if i.is_dir() or i.flag_bits & 1 or stat.S_IFMT(i.external_attr>>16) not in {0,stat.S_IFREG} or not 0<i.file_size<=caps[i.filename]:
            raise ValueError('Unexpected exact ZIP member')
        dest=d/'files'/i.filename
        with z.open(i) as src,dest.open('xb') as out:
            shutil.copyfileobj(src,out,length=1024*1024)
        if dest.stat().st_size!=i.file_size:
            raise ValueError('Member length mismatch')
        dest.chmod(0o400)
PY
gh attestation verify "$dest/files/statement.json" --repo zhYAO/Image-web \
  --signer-workflow zhYAO/Image-web/.github/workflows/exact-shadow-diagnostic.yml \
  --signer-digest "$sha" --source-ref refs/heads/codex/zimage-exact-shadow-diagnostic-20261122 \
  --source-digest "$sha" --deny-self-hosted-runners \
  --predicate-type https://github.com/zhYAO/Image-web/attestations/nonpromotable-ecs-byte-shadow/v1 \
  --format json > "$dest/verified.json"
chmod 0400 "$dest/verified.json"
python3 -I -B ops/aliyun/verify-92663-isolated-input.py "$dest/files" "$dest/verified.json"
rm -- "$dest/original.zip" "$dest/metadata.json"
