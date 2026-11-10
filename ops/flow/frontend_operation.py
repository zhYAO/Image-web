#!/usr/bin/env python3
"""Submit a single approved frontend operation from the protected Flow runner."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.error
import urllib.request


HOST = 'www.zimage.store'
HOST_FINGERPRINT = 'SHA256:JeRc+Z2z5z7KM2QBBrwnymDM234qFUISlwsoPK3ClFk'
GITHUB = 'https://api.github.com/repos/zhYAO/Image-web/'
QUALITY_RUN_URL = 'https://zimage-cn-shanghai.devops.aliyuncs.com/flow/pipelines/1414986/builds/'
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_JSON = 2 * 1024 * 1024


class OperationError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def public_json(url, status=200, *, no_store=False):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Accept': 'application/json'})
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        if response.status != status or response.headers.get_content_type() != 'application/json':
            raise OperationError('Unexpected public HTTP status or content type')
        if no_store and 'no-store' not in response.headers.get('Cache-Control', '').lower():
            raise OperationError('Public probe is missing no-store')
        body = response.read(MAX_JSON + 1)
    if len(body) > MAX_JSON:
        raise OperationError('Public JSON exceeds the response budget')
    return json.loads(body)


def require_main(source, bot_id, fetch_json=public_json):
    if not re.fullmatch(r'[1-9][0-9]*', bot_id or ''):
        raise OperationError('Configure the protected GitHub App bot ID')
    if fetch_json(GITHUB + 'git/ref/heads/main').get('object', {}).get('sha') != source:
        raise OperationError('Candidate is not the current GitHub main SHA')
    for page in range(1, 5):
        entries = fetch_json(GITHUB + f'commits/{source}/statuses?per_page=100&page={page}')
        latest = next((item for item in entries if item.get('context') == 'yunxiao/quality'), None)
        if latest is not None:
            run = re.fullmatch(r'Flow run ([1-9][0-9]*)', latest.get('description') or '')
            if (latest.get('state') == 'success' and str((latest.get('creator') or {}).get('id')) == bot_id
                    and run and latest.get('target_url') == QUALITY_RUN_URL + run[1]):
                return run[1]
            break
        if len(entries) < 100:
            break
    raise OperationError('GitHub main lacks the required successful Flow status from the configured App')


def known_host_line(value):
    fields = value.split()
    if len(fields) != 3 or fields[:2] != [HOST, 'ssh-ed25519']:
        raise OperationError('Use the exact production ED25519 known_hosts entry')
    blob = base64.b64decode(fields[2], validate=True)
    fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
    if fingerprint != HOST_FINGERPRINT:
        raise OperationError('Production SSH host fingerprint differs from the reviewed value')
    return ' '.join(fields) + '\n'


def checked_result(operation, result):
    if (type(result) is not dict or result.get('schemaVersion') != 1
            or result.get('operationId') != operation or not isinstance(result.get('state'), str)):
        raise OperationError('ECS did not return a valid operation status')
    return result


def apply_once(operation, call, before_apply=lambda: None):
    code, initial = call('query')
    if code:
        raise OperationError('Could not read the original ECS operation status')
    initial = checked_result(operation, initial)
    if initial['state'] != 'absent':
        return initial

    before_apply()
    _, result = call('apply')
    if result is not None:
        try:
            return checked_result(operation, result)
        except OperationError:
            pass
    code, observed = call('query')
    if code or checked_result(operation, observed)['state'] == 'absent':
        raise OperationError('Apply outcome could not be confirmed from ECS status')
    return observed


def append_archive(wire, archive, expected):
    digest = hashlib.sha256()
    with os.fdopen(os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_ARCHIVE:
            raise OperationError('Expected a bounded regular frontend archive')
        remaining = info.st_size
        while remaining:
            block = source.read(min(remaining, 1024 * 1024))
            if not block:
                raise OperationError('Frontend archive ended early')
            remaining -= len(block)
            digest.update(block)
            wire.write(block)
        if source.read(1) or digest.hexdigest() != expected:
            raise OperationError('Frontend archive differs from the reviewed SHA-256')


def request_header(args, mode):
    header = {'schemaVersion': 1, 'operationId': args.operation, 'mode': mode, 'approvalSha256': args.approval_sha256}
    if mode == 'apply':
        header.update(action=args.action, namespace=args.target, sourceSHA=args.source,
                      expectedBackend=args.backend, archiveSha256=args.archive_sha256)
    return header


def ssh_call(args, key, known_hosts, mode):
    header = request_header(args, mode)
    command = ['ssh', '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
               '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
               '-o', f'UserKnownHostsFile={known_hosts}', '-o', 'UpdateHostKeys=no',
               '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'ConnectTimeout=10',
               '-i', str(key), 'zimage-flow-frontend@' + HOST, 'frontend-operation-v1']
    with tempfile.TemporaryFile() as wire:
        wire.write((json.dumps(header, separators=(',', ':')) + '\n').encode())
        if mode == 'apply' and args.archive:
            append_archive(wire, args.archive, args.archive_sha256)
        wire.seek(0)
        try:
            result = subprocess.run(command, stdin=wire, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    timeout=240, check=False)
        except subprocess.TimeoutExpired:
            return 255, None
    if result.returncode and result.stderr.startswith(b'Frontend Flow request rejected:') and len(result.stderr) <= 256:
        print(result.stderr.decode(errors='replace').strip(), flush=True)
    try:
        body = json.loads(result.stdout) if len(result.stdout) <= MAX_JSON else None
    except ValueError:
        body = None
    return result.returncode, body


def verify_public(args, record):
    request = record.get('request', {})
    if (record.get('success') is not True or record['state'] != 'committed'
            or record.get('newFrontend') != args.target or record.get('backendRelease') != args.backend
            or record.get('sourceSHA') != args.source or request.get('kind') != 'flow-' + args.action
            or request.get('approvalSha256') != args.approval_sha256):
        raise OperationError('ECS operation has no matching committed result')
    origin = 'https://' + HOST
    if public_json(origin + '/version.json', no_store=True) != {'schemaVersion': 1, 'frontendRelease': args.target}:
        raise OperationError('Public frontend version differs from ECS journal')
    if public_json(origin + '/api/meta')['backendRelease'] != args.backend:
        raise OperationError('Public backend version differs from ECS journal')
    for path in ('/api/auth/session', '/api/account'):
        if public_json(origin + path, 401, no_store=True).get('code') != 'unauthorized':
            raise OperationError('Public anonymous authentication contract failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-main', metavar='SHA')
    parser.add_argument('--operation')
    parser.add_argument('--approval-sha256')
    parser.add_argument('--query', action='store_true')
    parser.add_argument('--action', choices=('deploy', 'rollback'))
    parser.add_argument('--target')
    parser.add_argument('--backend')
    parser.add_argument('--source')
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--archive-sha256')
    args = parser.parse_args()
    if args.check_main is not None:
        if (not re.fullmatch(r'[a-f0-9]{40}', args.check_main)
                or any(value for key, value in vars(args).items() if key != 'check_main')):
            parser.error('--check-main accepts only a complete source SHA')
        run = require_main(args.check_main, os.environ.get('ZIMAGE_GITHUB_APP_BOT_ID'))
        print('GitHub main quality verified from Flow run ' + run, flush=True)
        return
    if not re.fullmatch(r'flow-front-[A-Za-z0-9._-]{1,117}', args.operation or '') or not re.fullmatch(r'[a-f0-9]{64}', args.approval_sha256 or ''):
        parser.error('Expected a Flow operation ID and root approval SHA-256')
    if not args.query:
        if (args.action is None or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', args.target or '')
                or not re.fullmatch(r'[a-f0-9]{40}', args.backend or '') or not re.fullmatch(r'[a-f0-9]{40}', args.source or '')):
            parser.error('Expected the action, target namespace, backend SHA and artifact source SHA')
        if args.action == 'deploy' and (args.archive is None or not re.fullmatch(r'[a-f0-9]{64}', args.archive_sha256 or '')):
            parser.error('Deploy requires the frozen archive and its SHA-256')
        if args.action == 'rollback' and (args.archive is not None or args.archive_sha256 is not None):
            parser.error('Rollback accepts only a retained target')
    private_key = os.environ.pop('ZIMAGE_FLOW_FRONTEND_SSH_KEY', '')
    if not private_key:
        raise OperationError('Configure the protected Flow frontend SSH identity')
    pinned = known_host_line(os.environ.get('ZIMAGE_FLOW_FRONTEND_KNOWN_HOSTS', ''))
    with tempfile.TemporaryDirectory(prefix='zimage-flow-ssh-') as temporary:
        key = Path(temporary) / 'client'
        known_hosts = Path(temporary) / 'known_hosts'
        with os.fdopen(os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='ascii') as stream:
            stream.write(private_key.strip() + '\n')
        known_hosts.write_text(pinned, encoding='ascii')

        def call(mode):
            return ssh_call(args, key, known_hosts, mode)

        if args.query:
            code, result = call('query')
            if code:
                raise OperationError('Could not read the original ECS operation status')
            print(json.dumps(checked_result(args.operation, result), sort_keys=True))
            return

        def gate():
            if args.action == 'deploy':
                require_main(args.source, os.environ.get('ZIMAGE_GITHUB_APP_BOT_ID'))

        result = apply_once(args.operation, call, before_apply=gate)
        print(json.dumps(result, sort_keys=True), flush=True)
        verify_public(args, result)
        print('Committed frontend version and anonymous contract verified from Flow', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('Frontend Flow failed: ' + (str(error) if isinstance(error, OperationError) else type(error).__name__))
