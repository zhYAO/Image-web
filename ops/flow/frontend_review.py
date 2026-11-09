#!/usr/bin/env python3
"""Prepare an unprivileged frontend review package from frozen Flow inputs."""
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile
import tempfile


PROJECT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('frontend_pack', PROJECT / 'ops/aliyun/frontend/pack.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
m = pack.m


@contextmanager
def regular(path):
    path = Path(path).absolute()
    m.safe_directory(path.parent)
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('Review inputs must be regular files')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Review inputs must be single-link regular files')
        yield stream


def copy_bounded(stream, target, limit):
    digest = hashlib.sha256()
    total = 0
    with target.open('xb') as out:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            total += len(block)
            if total > limit:
                raise ValueError('Frontend candidate exceeds extraction budget')
            digest.update(block)
            out.write(block)
    return digest.hexdigest(), total


def extract_candidate(bundle, checksum, work):
    m.checksum(checksum)
    snapshot = work / 'candidate-package.tgz'
    with regular(bundle) as stream:
        if copy_bounded(stream, snapshot, m.MAX_ARCHIVE)[0] != checksum:
            raise ValueError('Candidate Packages checksum differs from review input')
    expected = {'frontend-candidate.tgz': m.MAX_ARCHIVE, 'candidate.json': m.MAX_JSON, 'SHA256SUMS': 1024}
    checksums = {}
    with tarfile.open(snapshot, 'r|gz') as package:
        for member in package:
            name = member.name.removeprefix('./')
            if member.isdir() and name in ('', '.'):
                continue
            if name not in expected or name in checksums or not member.isfile() or not 0 < member.size <= expected[name]:
                raise ValueError('Unexpected candidate Packages member')
            checksums[name], _ = copy_bounded(package.extractfile(member), work / name, expected[name])
    if set(checksums) != set(expected):
        raise ValueError('Missing candidate Packages member')
    checksum_lines = ''.join(f'{checksums[name]}  {name}\n' for name in ('frontend-candidate.tgz', 'candidate.json')).encode()
    if (work / 'SHA256SUMS').read_bytes() != checksum_lines:
        raise ValueError('Candidate inner checksums do not match')

    dist = work / 'dist'
    dist.mkdir()
    total = 0
    seen = set()
    with tarfile.open(work / 'frontend-candidate.tgz', 'r|gz') as candidate:
        for member in candidate:
            name = member.name.removeprefix('./')
            if member.isdir() and name in ('', '.'):
                continue
            folded = name.casefold()
            if folded in seen or len(seen) >= 40000:
                raise ValueError('Candidate has duplicate or too many entries')
            seen.add(folded)
            if member.isdir():
                if name != '.release':
                    m.payload_path(name + '/_.js')
                continue
            if not member.isfile() or not 0 <= member.size <= m.MAX_FILE or total + member.size > m.MAX_BYTES:
                raise ValueError('Candidate archive member exceeds allowed type or budget')
            if name != '.release/candidate.json':
                m.payload_path(name)
            path = dist / name
            path.parent.mkdir(parents=True, exist_ok=True)
            _, count = copy_bounded(candidate.extractfile(member), path, member.size)
            if count != member.size:
                raise ValueError('Candidate archive member is incomplete')
            total += count
    descriptor = dist / '.release/candidate.json'
    if not descriptor.is_file() or descriptor.read_bytes() != (work / 'candidate.json').read_bytes():
        raise ValueError('Candidate descriptor differs from the archived payload')
    return dist


def review_reports(evidence, subject, directory, source, archive_sha):
    entries = evidence.get('backendReleases')
    if not isinstance(entries, list) or not entries or not all(isinstance(item, dict) for item in entries):
        raise ValueError('Review requires reports for the verified backends')
    releases = [item.get('backendRelease') for item in entries]
    if not all(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{40}', value) for value in releases):
        raise ValueError('Review requires full backend release SHAs')
    m.acceptance_evidence(evidence, subject, releases)
    reports = {}
    for item in entries:
        checksum = item['acceptanceSha256']
        with regular(Path(directory) / (checksum + '.json')) as stream:
            body = stream.read(m.MAX_JSON + 1)
        if len(body) > m.MAX_JSON or m.digest(body) != checksum:
            raise ValueError('Acceptance report differs from its reviewed digest')
        report = m.parse(body)
        expected = dict(subject, sourceSHA=source, backendRelease=item['backendRelease'], outerArchiveSha256=archive_sha)
        if type(report) is not dict or any(report.get(key) != value for key, value in expected.items()):
            raise ValueError('Acceptance report belongs to another candidate or backend')
        reports[checksum] = body
    return reports


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate', 'candidate-sha256', 'public-config', 'evidence', 'reports', 'output-dir'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--project', default=str(PROJECT))
    args = parser.parse_args(argv)
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        raise ValueError('Review packaging must run without root')
    output = Path(args.output_dir).absolute()
    m.safe_directory(output.parent)
    with tempfile.TemporaryDirectory(prefix='zimage-frontend-review-') as temporary:
        work = Path(temporary).resolve()
        dist = extract_candidate(args.candidate, args.candidate_sha256, work)
        config = pack.read_json(args.public_config)
        evidence = pack.read_json(args.evidence)
        _, candidate, subject = m.candidate_files(dist, config)
        source = candidate['sourceIdentity']
        reports = review_reports(evidence, subject, args.reports, source['sourceSHA'], args.candidate_sha256)
        options = {'assetNamespace': candidate['namespace'], 'sourceSHA': source['sourceSHA'],
                   'treeFingerprint': source['treeFingerprint'], 'apiRequirements': candidate['apiRequirements'],
                   'verifiedBackendReleases': [item['backendRelease'] for item in evidence['backendReleases']],
                   'build': {'toolchainFingerprint': candidate['buildToolchainFingerprint'], 'lockfileSha256': source['lockfileSha256']}}
        for name, value in (('public-config', config), ('evidence', evidence), ('options', options)):
            pack.write_exclusive(work / (name + '.json'), value)

        output.mkdir(mode=0o700)
        try:
            directory = output / 'acceptance'
            directory.mkdir()
            for checksum, body in reports.items():
                (directory / (checksum + '.json')).write_bytes(body)
            return pack.main(['--project', args.project, '--dist', str(dist), '--public-config', str(work / 'public-config.json'),
                              '--evidence', str(work / 'evidence.json'), '--options', str(work / 'options.json'),
                              '--output', str(output / 'frontend-review.tgz')])
        except BaseException:
            shutil.rmtree(output)
            raise


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        detail = str(error) if type(error) is ValueError else type(error).__name__
        raise SystemExit('Frontend review rejected: ' + detail)
