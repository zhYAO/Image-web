#!/usr/bin/env python3
"""Offline exact run policy. Second argument must be trusted output of successful gh attestation verify."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

SHA = '92663c46ffa483319ad8d7cd9318ac41f258aa12'
RUN = 45083109340
BACKEND_ZIP = '5e9e05c52126ccc62d2416385b0375c07b365edb167d7645df9abbb211c4565e'
FRONTEND_ZIP = '6b7ab161a14e34ae2db1c37a74bb43689e48bb8e8529309b16286c592c369cbf'
REF = 'refs/heads/codex/zimage-exact-shadow-diagnostic-20261122'
REPO = 'zhYAO/Image-web'
URI = 'https://github.com/' + REPO
WORKFLOW = REPO + '/.github/workflows/exact-shadow-diagnostic.yml@' + REF
PT = URI + '/attestations/nonpromotable-ecs-byte-shadow/v1'
FILES = ('backend.zip', 'frontend.zip', 'pins.json', 'config.json')

def check(ok, category):
    if not ok:
        raise ValueError(category)

def read(path, cap, keep=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as src:
        before = os.fstat(src.fileno())
        check(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= cap, 'file bounds')
        h = hashlib.sha256()
        chunks = []
        count = 0
        while chunk := src.read(1024 * 1024):
            count += len(chunk)
            check(count <= before.st_size, 'file changed')
            h.update(chunk)
            if keep:
                chunks.append(chunk)
        after = os.fstat(src.fileno())
        check(count == before.st_size and before.st_mtime_ns == after.st_mtime_ns and before.st_ctime_ns == after.st_ctime_ns, 'file changed')
    return dict(bytes=count, sha256=h.hexdigest()), b''.join(chunks)

def decode(data):
    def unique(items):
        result = dict(items)
        check(len(result) == len(items), 'duplicate JSON member')
        return result
    return json.loads(data, object_pairs_hook=unique)

def verify(root, verified):
    check(root.is_absolute() and root.resolve(strict=True) == root and root.is_dir(), 'noncanonical extracted directory')
    check({p.name for p in root.iterdir()} == set(FILES) | {'statement.json'}, 'wrong file inventory')
    records = {n: read(root/n, 40_000_000 if n.endswith('.zip') else 16384)[0] for n in FILES}
    statement_info, statement_bytes = read(root/'statement.json', 16384, keep=True)
    check(sum(f['bytes'] for f in records.values()) + statement_info['bytes'] <= 40_000_000, 'aggregate size')
    statement = decode(statement_bytes)
    fixed = dict(schemaVersion=1, repository=REPO, workflow=WORKFLOW, commit=SHA, runId=RUN, attempt=1, productionReady=False)
    check(statement == dict(fixed, kind='nonpromotable-ecs-byte-proof', browserShadowPassed=True, files=records)
          and statement['browserShadowPassed'] is True and statement['productionReady'] is False
          and type(statement['schemaVersion']) is int and type(statement['attempt']) is int, 'statement identity or file mismatch')
    check(statement_bytes == (json.dumps(statement, sort_keys=True, separators=(',', ':')) + '\n').encode(), 'noncanonical statement')
    subjects = {n: records[n]['sha256'] for n in FILES[:2]}
    subjects['statement.json'] = statement_info['sha256']
    wanted = dict(fixed, kind='nonpromotable-ecs-byte-shadow', subjects=subjects)
    rows = decode(read(verified, 4_000_000, keep=True)[1])
    check(type(rows) is list and len(rows) == 1, 'expected one verified attestation')
    result = rows[0]['verificationResult']
    signed = result['statement']
    cert = result['signature']['certificate']
    check(bool(result['verifiedTimestamps']), 'missing verified timestamp')
    claims = {
        'issuer': 'https://token.actions.githubusercontent.com',
        'sourceRepositoryURI': URI,
        'sourceRepositoryIdentifier': '1329578390',
        'sourceRepositoryRef': REF,
        'sourceRepositoryDigest': SHA,
        'runInvocationURI': f'{URI}/actions/runs/{RUN}/attempts/1',
        'subjectAlternativeName': 'https://github.com/' + WORKFLOW,
    }
    check(all(cert.get(k) == v for k,v in claims.items()), 'verified certificate identity mismatch')
    check(signed['_type'] == 'https://in-toto.io/Statement/v1' and signed['predicateType'] == PT, 'signed type mismatch')
    predicate = signed['predicate']
    check(predicate == wanted and predicate['productionReady'] is False and type(predicate['attempt']) is int
          and type(predicate['schemaVersion']) is int, 'signed predicate mismatch')
    check(len(signed['subject']) == len(subjects) and all(
        type(item) is dict and set(item) == {'name','digest'}
        and item['digest'] == {'sha256': subjects.get(item['name'])}
        and item['name'] in subjects for item in signed['subject'])
        and {item['name'] for item in signed['subject']} == set(subjects), 'signed subject mismatch')
    return dict(commit=SHA, runId=RUN, attempt=1, repositoryId='1329578390',
                files=records, statementSha256=statement_info['sha256'], diagnosticBytesVerified=True, productionReady=False)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: verify.py ABS_EXTRACTED_DIR TRUSTED_GH_VERIFICATION_JSON')
    try:
        result = verify(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        sys.exit('Diagnostic byte proof not verified')
    print(json.dumps(result, sort_keys=True))
