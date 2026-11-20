"""Fixed local bridge to an independently installed paired release controller.

This file does not install helpers, approve releases, or supply authentication.
Only a protected, target-specific runner may invoke the exact reviewed bridge.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
BRIDGE = Path('/usr/local/libexec/zimage-paired-release/github-bridge')
REPO = 'zhYAO/Image-web'
SHA = re.compile('[a-f0-9]{64}')
STAGE_FIELDS = {'schemaVersion', 'kind', 'commit', 'runId', 'attempt', 'pairSha256',
                'stageReceiptSha256', 'backendReceiptSha256', 'frontendAcceptanceSha256', 'checkedAt'}
AUTH_FIELDS = {'schemaVersion', 'kind', 'commit', 'runId', 'attempt', 'pairSha256',
               'stageReceiptSha256', 'independentApprovalSha256'}
PROD_FIELDS = {'schemaVersion', 'kind', 'commit', 'runId', 'attempt', 'pairSha256',
                'stageReceiptSha256', 'independentApprovalSha256', 'operationId', 'backend', 'frontend',
                'healthVerified', 'rollbackRecorded'}


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def validate_env(env, phase, pins):
    require(phase in ('staging', 'production'), 'Unknown protected phase')
    require(env.get('GITHUB_EVENT_NAME') == 'push' and env.get('GITHUB_REF') == 'refs/heads/main'
            and env.get('GITHUB_REF_PROTECTED') == 'true' and env.get('GITHUB_REPOSITORY') == REPO
            and env.get('RUNNER_ENVIRONMENT') == 'self-hosted' and env.get('RUNNER_OS') == 'Linux'
            and env.get('ZIMAGE_PAIRED_ROLE') == phase and env.get('ZIMAGE_PAIRED_ENABLED') == 'true',
            'Expected enabled protected main runner, not a diagnostic or hosted run')
    require(pins['commit'] == env.get('GITHUB_SHA') and str(pins['runId']) == env.get('GITHUB_RUN_ID')
            and str(pins['attempt']) == env.get('GITHUB_RUN_ATTEMPT'), 'Release packet is not bound to this exact run')
    require(pins.get('frontendNamespace') == 'release-' + pins['commit'][:12], 'Diagnostic frontend cannot enter the release controller')
    require(bool(SHA.fullmatch(env.get('ZIMAGE_PAIRED_BRIDGE_SHA256', ''))), 'Missing approved bridge checksum')
    if phase == 'production':
        for key in ('STAGE_RECEIPT_SHA256', 'STAGE_PAIR_SHA256', 'STAGE_CHECKED_AT'):
            require(bool(env.get(key)), 'Missing independent production approval or staging result')
        for key in ('STAGE_RECEIPT_SHA256', 'STAGE_PAIR_SHA256'):
            require(bool(SHA.fullmatch(env[key])), 'Malformed protected evidence checksum')


def validate_stage(value, pins, pair_sha, now):
    require(type(value) is dict and set(value) == STAGE_FIELDS and value['schemaVersion'] == 1
            and value['kind'] == 'zimage-staging-authenticated-pair-v1'
            and all(value[k] == pins[k] for k in ('commit', 'runId', 'attempt'))
            and value['pairSha256'] == pair_sha and type(value['checkedAt']) is int
            and now - 7200 <= value['checkedAt'] <= now, 'Untrusted, stale, or foreign staging result')
    for key in ('stageReceiptSha256', 'backendReceiptSha256', 'frontendAcceptanceSha256'):
        require(isinstance(value[key], str) and bool(SHA.fullmatch(value[key])), 'Missing staging evidence identities')


def invoke(phase, files, argument, expected_sha):
    # Authenticated installation, not arbitrary workspace/variable commands.
    for item in (BRIDGE, *BRIDGE.parents):
        info = item.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022 and
                (stat.S_ISREG(info.st_mode) and info.st_nlink == 1 if item == BRIDGE else stat.S_ISDIR(info.st_mode)),
                'Untrusted installed controller or ancestor')
    require(sha(BRIDGE.read_bytes()) == expected_sha, 'Installed bridge differs from reviewed digest')
    # Never inherit GH_TOKEN, signing credentials, SSH config or a user PATH.
    # Bridge credential and approved record custody belong to the reviewed service.
    with tempfile.TemporaryFile() as output:
        result = subprocess.run([str(BRIDGE), phase, *map(str, files), argument], stdin=subprocess.DEVNULL,
                                stdout=output, stderr=subprocess.DEVNULL, timeout=600, check=False,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
        require(result.returncode == 0 and 0 < output.tell() <= 65536, 'Reviewed controller rejected or did not report a result')
        output.seek(0)
        return json.loads(output.read(65537))


def dispatch(phase, pins, env, call, *, now):
    validate_env(env, phase, pins)
    pair_sha = sha(canonical(pins))
    if phase == 'staging':
        result = call(phase, pair_sha)
        validate_stage(result, pins, pair_sha, now)
        return result
    require(env['STAGE_PAIR_SHA256'] == pair_sha, 'Stage and production artifacts differ')
    stage_time = env['STAGE_CHECKED_AT']
    require(re.fullmatch('[1-9][0-9]{0,11}', stage_time) is not None and now - 7200 <= int(stage_time) <= now,
            'Protected production step needs fresh staging evidence')
    # The bridge independently loads its trusted staging receipt and root
    # approval by exact digests; a job output cannot itself grant permission.
    requested = dict(pairSha256=pair_sha, stageReceiptSha256=env['STAGE_RECEIPT_SHA256'])
    auth = call('authorization', canonical(requested).decode().strip())
    require(type(auth) is dict and set(auth) == AUTH_FIELDS and auth['schemaVersion'] == 1
            and auth['kind'] == 'zimage-independent-pair-approval-v1'
            and all(auth[k] == pins[k] for k in ('commit', 'runId', 'attempt'))
            and all(auth[k] == v for k, v in requested.items())
            and isinstance(auth['independentApprovalSha256'], str)
            and bool(SHA.fullmatch(auth['independentApprovalSha256'])),
            'Missing independently root-approved exact release')
    gate = canonical(dict(requested, independentApprovalSha256=auth['independentApprovalSha256'])).decode().strip()
    result = call(phase, gate)
    require(type(result) is dict and set(result) == PROD_FIELDS and result['schemaVersion'] == 1
            and result['kind'] == 'zimage-ordinary-paired-release-v1'
            and all(result[k] == pins[k] for k in ('commit', 'runId', 'attempt'))
            and result['pairSha256'] == pair_sha
            and result['stageReceiptSha256'] == env['STAGE_RECEIPT_SHA256']
            and result['independentApprovalSha256'] == auth['independentApprovalSha256']
            and result['backend'] == pins['commit'] and result['frontend'] == 'release-' + pins['commit'][:12]
            and result['operationId'] == f"gha-{pins['runId']}-{pins['attempt']}"
            and result['healthVerified'] is True and result['rollbackRecorded'] is True,
            'Controller did not verify exact published pair and recoverable prior state')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('staging', 'production'))
    for name in ('pins', 'backend', 'frontend', 'config'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        spec = importlib.util.spec_from_file_location('pair_intake', HERE / 'github-rehearsal-intake.py')
        intake = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(intake)
        pins = intake.read_json(args.pins)
        validate_env(os.environ, args.phase, pins)
        config = intake.read_json(args.config)
        require(config.get('formalAuth') is True and config.get('dataMode') == 'http',
                'Authenticated staging public contract is required')
        checked_pair = intake.evaluate(pins, args.backend, args.frontend, config)
        require(checked_pair['immutablePairVerified'] is True and checked_pair['productionReady'] is False,
                'Unexpected intake qualification state')
        files = (args.pins, args.backend, args.frontend, args.config)
        def checked_call(phase, argument):
            return invoke(phase, files, argument, os.environ['ZIMAGE_PAIRED_BRIDGE_SHA256'])
        result = dispatch(args.phase, pins, os.environ, checked_call, now=int(time.time()))
        if args.phase == 'staging':
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                print(f"stage_receipt_sha={result['stageReceiptSha256']}\nstage_pair_sha={result['pairSha256']}\nstage_checked_at={result['checkedAt']}", file=output)
        print('Protected paired controller response verified for exact run:', pins['commit'])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print('Paired controller rejected or unprovisioned. Check reviewed bridge, protected role and independent approval:', type(exc).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
