#!/usr/bin/env python3
"""Trusted checkout only: prepare an exact hosted-shadow pair, never launch it."""
import argparse
import importlib.util
import os
import re
import stat
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent


def module():
    spec = importlib.util.spec_from_file_location('trusted_intake', HERE / 'github-rehearsal-intake.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def private_directory(path):
    info = path.lstat()
    return stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077


def run(source, output, cache, intake, *, commit, run_id, attempt, backend_sha256, frontend_sha256):
    """Identity and outer SHA pins must come from trusted GitHub metadata, not pins.json."""
    if (not re.fullmatch('[a-f0-9]{40}', commit)
            or any(type(n) is not int or n <= 0 for n in (run_id, attempt))
            or any(not re.fullmatch('[a-f0-9]{64}', d) for d in (backend_sha256, frontend_sha256))):
        raise ValueError('Invalid independent artifact identity')
    source, output, cache = map(Path, (source, output, cache))
    if (any(not p.is_absolute() or p.resolve(strict=False) != p for p in (source, output, cache))
            or output.exists() or output.is_symlink() or not source.is_dir() or not cache.is_dir()
            or any(not private_directory(p) for p in (source, cache, output.parent))
            or any(cache.iterdir())
            or source == cache or source in cache.parents or cache in source.parents
            or source in output.parents or output in source.parents
            or cache in output.parents or output in cache.parents):
        raise ValueError('Expected separate canonical private input, cache and new output')
    names = ('pins.json', 'config.json', 'backend.zip', 'frontend.zip')
    if {p.name for p in source.iterdir()} != set(names):
        raise ValueError('Missing exact inputs')
    for name in names:
        info = (source / name).lstat()
        limit = 200_000_000 if name.endswith('.zip') else 1_000_000
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077
                or info.st_nlink != 1 or not 0 < info.st_size <= limit):
            raise ValueError('Missing exact inputs')

    pins = intake.read_json(source / 'pins.json')
    if not intake.hosted_namespace(pins, 'hosted-shadow'):
        raise ValueError('Hosted shadow lane required')
    if (pins['commit'] != commit or type(pins['runId']) is not int or pins['runId'] != run_id
            or type(pins['attempt']) is not int or pins['attempt'] != attempt):
        raise ValueError('Packet differs from independent run identity')
    for component, digest in (('backend', backend_sha256), ('frontend', frontend_sha256)):
        if pins[component]['artifactSha256'] != digest:
            raise ValueError('Packet differs from independent outer archive digest')
        intake.checked(source / f'{component}.zip', digest)
    sha = commit
    report = intake.evaluate(pins, source / 'backend.zip', source / 'frontend.zip',
                             intake.read_json(source / 'config.json'))
    if (report.get('immutablePairVerified') is not True or report.get('productionReady') is not False
            or report.get('status') != 'blocked' or report.get('commit') != sha
            or report.get('runId') != pins['runId'] or report.get('attempt') != pins['attempt']):
        raise ValueError('Hosted shadow intake proof missing')
    output.mkdir(mode=0o700)
    try:
        for component, allowed in (
            ('backend', ['transport.tgz', 'rehearsal-receipt.json']),
            ('frontend', ['frontend-rehearsal.tgz', 'frontend-subject.json', 'rehearsal-receipt.json']),
        ):
            out = output / component
            intake.extract_github_zip(source / f'{component}.zip', out, pins[component]['artifactSha256'], allowed)
            intake.closure_receipt(out, component, pins[component], sha, pins['runId'], pins['attempt'], shadow=True)
        store = output / 'store'
        digest = pins['backend']['manifestSha256']
        intake.load('transport', HERE / 'release-transport.py').unpack_bundle(
            output / 'backend/transport.tgz', store, sha, digest)
        fm = intake.load('manifest', HERE / 'frontend/manifest.py')
        fm.extract_strict(output / 'frontend/frontend-rehearsal.tgz', output / 'web',
                          validator=lambda name: None if name == '.release/candidate.json' else fm.payload_path(name),
                          max_bytes=100_000_000)
        intake.load('assembler', HERE / 'three-layer-release.py').assemble(
            store / 'releases' / f'{sha}.json', store, output / 'app', cache, digest, True)
    except BaseException:
        shutil.rmtree(output)
        raise


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'output', 'cache'):
        cli.add_argument(name)
    cli.add_argument('--commit', required=True)
    cli.add_argument('--run-id', type=int, required=True)
    cli.add_argument('--attempt', type=int, required=True)
    cli.add_argument('--backend-sha256', required=True)
    cli.add_argument('--frontend-sha256', required=True)
    args = cli.parse_args()
    run(args.source, args.output, args.cache, module(), commit=args.commit, run_id=args.run_id,
        attempt=args.attempt, backend_sha256=args.backend_sha256, frontend_sha256=args.frontend_sha256)
