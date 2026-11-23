#!/usr/bin/env python3
"""Independent authenticated source for the receiver's fixed GitHub evidence reads."""
import argparse
from functools import partial
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time

import ordinary_github as github
import ordinary_readonly_transport as transport


QUERY = 'zimage-github-evidence-query-v1'
RESULT = 'zimage-github-evidence-response-v1'
NONCE = re.compile('[a-f0-9]{32}')
QUERY_LIMIT = 2048
RESPONSE_LIMIT = github.CAP + 8192
LOOKUP_TIMEOUT = 15


def client(policy, **trust):
    open_connection = transport.client_connection(policy, **trust)

    def get(path):
        github.require(github.safe_path(path))
        nonce = secrets.token_hex(16)
        cutoff = time.monotonic() + LOOKUP_TIMEOUT
        with open_connection(deadline=cutoff) as connection:
            transport.write_frame(connection, dict(kind=QUERY, path=path, nonce=nonce), QUERY_LIMIT, cutoff)
            result = transport.read_frame(connection, RESPONSE_LIMIT, cutoff)
        transport.exact(result, {'kind', 'path', 'nonce', 'record'})
        github.require(result['kind'] == RESULT and result['path'] == path and result['nonce'] == nonce
                       and type(result['record']) in (dict, list))
        return result['record']

    return get


def answer(query, get):
    transport.exact(query, {'kind', 'path', 'nonce'})
    github.require(query['kind'] == QUERY and github.safe_path(query['path'])
                   and type(query['nonce']) is str and NONCE.fullmatch(query['nonce']))
    record = get(query['path'])
    github.require(type(record) in (dict, list))
    return dict(kind=RESULT, path=query['path'], nonce=query['nonce'], record=record)


def serve_one(raw, *, context, peer, get, deadline):
    with transport.accept(raw, context=context, peer=peer, deadline=deadline) as connection:
        query = transport.read_frame(connection, QUERY_LIMIT, deadline)
        reply = answer(query, get)
        transport.write_frame(connection, reply, RESPONSE_LIMIT, deadline)


def read_private(path, limit):
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
                info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1
                or info.st_mode & 0o077 or not 0 < info.st_size <= limit):
            raise ValueError('Private observer file required')
        body = source.read(limit + 1)
        if (len(body) != info.st_size or identity(os.fstat(source.fileno())) != identity(info)
                or identity(path.lstat()) != identity(info)):
            raise ValueError('Observer file changed while reading')
    return body


def probe(get, *, head, run_id):
    """Confirm the protected-main and required-check read paths without authorizing a release."""
    github.require(type(head) is str and re.fullmatch(github.SHA, head))
    github.numeric(run_id)
    main = get(github.BASE + '/branches/main')
    github.require(main['name'] == 'main' and main['protected'] is True and re.fullmatch(github.SHA, main['commit']['sha']))
    check = github.single(get(f'{github.BASE}/commits/{head}{github.CHECK_QUERY}'), 'check_runs')
    github.require(check['head_sha'] == head and check['name'] == github.CHECK_NAME and check['app']['id'] == github.CHECK_APP_ID
                   and check['status'] == 'completed' and check['conclusion'] == 'success')
    check_id = github.numeric(check['id'])
    run = get(f'{github.BASE}/actions/runs/{run_id}')
    github.require(run['id'] == run_id and run['path'] == github.CHECK_WORKFLOW and run['head_sha'] == head
                   and run['event'] == 'pull_request' and run['conclusion'] == 'success' and run['status'] == 'completed'
                   and run['repository']['id'] == github.REPO_ID and run['check_suite_id'] == check['check_suite']['id'])
    attempt = github.numeric(run['run_attempt'])
    jobs = get(f'{github.BASE}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    github.require(type(jobs['jobs']) is list and jobs['total_count'] == len(jobs['jobs']) <= 100)
    matching = [job for job in jobs['jobs'] if job['name'] == github.CHECK_NAME]
    github.require(len(matching) == 1)
    job = matching[0]
    github.require(job['run_id'] == run_id and job['run_attempt'] == attempt and job['head_sha'] == head
                   and job['status'] == 'completed' and job['conclusion'] == 'success'
                   and job['check_run_url'] == f'https://api.github.com{github.BASE}/check-runs/{check_id}')
    return dict(schemaVersion=1, protectedMain=main['commit']['sha'], checkedHead=head, checkRunId=check_id,
                actionsRunId=run_id, releaseAuthority=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('policy', type=Path, help='Local observer listener policy')
    parser.add_argument('--probe', nargs=2, metavar=('HEAD', 'RUN_ID'), help='Read-only check from the receiver context')
    args = parser.parse_args()
    directory = args.policy.parent
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise ValueError('Trusted local observer policy directory required')
    policy = json.loads(read_private(args.policy, 4096))
    if args.probe is not None:
        head, run_id = args.probe
        key = directory / 'client.key'
        read_private(key, 65536)
        get = client(policy, ca=directory / 'ca.pem', cert=directory / 'client.pem', key=key)
        print(json.dumps(probe(get, head=head, run_id=int(run_id)), sort_keys=True))
        return
    token = read_private(directory / 'github.token', 1024).decode('ascii').removesuffix('\n')
    get = github.read_only(token)
    del token
    key = directory / 'server.key'
    read_private(key, 65536)
    transport.listen_one(policy, ca=directory / 'ca.pem', cert=directory / 'server.pem', key=key,
                         handler=partial(serve_one, get=get), lifetime=LOOKUP_TIMEOUT)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError):
        raise SystemExit('Independent GitHub evidence service unavailable') from None
