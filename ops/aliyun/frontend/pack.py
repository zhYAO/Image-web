"""Unprivileged artifact CLI; Python 3.9+ on macOS, Windows and Linux."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

_spec = importlib.util.spec_from_file_location('frontend_manifest', Path(__file__).with_name('manifest.py'))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def read_json(path):
    path = Path(path).absolute()
    m.safe_directory(path.parent)
    return m.parse(m.read_regular(path, m.MAX_JSON))


def source_identity(project):
    """A production package has a clean, exact Git input, never relabeled SHA."""
    project = m.safe_directory(project)
    def git(*args):
        result = subprocess.run(['git', '-C', str(project), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode != 0: raise ValueError('Cannot verify exact Git source identity')
        return result.stdout
    if git('status', '--porcelain=v1', '--untracked-files=all'):
        raise ValueError('Release packaging requires clean tracked and untracked Git inputs')
    source = git('rev-parse', 'HEAD').strip().decode('ascii')
    tree = git('ls-tree', '-r', '--full-tree', 'HEAD')
    package = read_json(project / 'package.json')
    if package.get('packageManager') != 'pnpm@11.19.0': raise ValueError('Unapproved package manager')
    lock = m.digest(m.read_regular(project / 'pnpm-lock.yaml', m.MAX_FILE))
    return {'sourceSHA': source, 'treeFingerprint': m.digest(tree), 'lockfileSha256': lock}


def write_exclusive(path, value):
    with path.open('xb') as out:
        out.write(m.canonical(value))
        out.flush()
        os.fsync(out.fileno())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', required=True)
    parser.add_argument('--public-config', required=True)
    parser.add_argument('--subject-only', action='store_true', help='Return evidence subject without claiming verification')
    parser.add_argument('--output')
    parser.add_argument('--options')
    parser.add_argument('--evidence')
    parser.add_argument('--project')
    args = parser.parse_args(argv)
    if hasattr(os, 'geteuid') and os.geteuid() == 0: raise ValueError('Local packaging must run without root')
    config = read_json(args.public_config)
    if args.subject_only:
        if any([args.output, args.options, args.evidence, args.project]): raise ValueError('Subject-only accepts dist and public config only')
        _, candidate, subject = m.candidate_files(args.dist, config)
        print(json.dumps(dict(subject, namespace=candidate['namespace'], apiRequirements=candidate['apiRequirements'], allowedBackendReleases=candidate['allowedBackendReleases'], sourceIdentity=candidate['sourceIdentity'], buildToolchainFingerprint=candidate['buildToolchainFingerprint'], acceptanceRequired=True), sort_keys=True))
        return 0
    if not all([args.output, args.options, args.evidence, args.project]): raise ValueError('Pack requires output, options, evidence and project')
    options, evidence = read_json(args.options), read_json(args.evidence)
    source = source_identity(args.project)
    if any(options.get(key) != source[key] for key in ['sourceSHA', 'treeFingerprint']) or options.get('build', {}).get('lockfileSha256') != source['lockfileSha256']:
        raise ValueError('Manifest source/tree/lock identity differs from actual clean source')
    output = Path(os.path.abspath(args.output))
    sidecars = [Path(str(output) + suffix) for suffix in ['.manifest.json', '.approval.json', '.result.json']]
    if any(os.path.lexists(path) for path in [output, *sidecars]): raise ValueError('Packaging outputs already exist')
    report = m.pack(args.dist, output, options, config, evidence)
    # Independent decode of the produced transport catches truncation/header
    # problems. Never trust an archive just because its packer returned success.
    with tempfile.TemporaryDirectory(prefix='zimage-frontend-verify-') as temporary:
        value = m.unpack(output, Path(temporary).resolve() / 'dist', report['manifestSha256'])
    approval = dict(evidence, artifactId=report['artifactId'], manifestSha256=report['manifestSha256'])
    report.update(manifestPath=str(sidecars[0]), approvalRequestPath=str(sidecars[1]), resultPath=str(sidecars[2]), approvalRequest=approval)
    write_exclusive(sidecars[0], value)
    write_exclusive(sidecars[1], approval)
    write_exclusive(sidecars[2], report)
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception as error:
        # All validation messages are fixed descriptions, never raw payloads.
        print('Frontend packaging rejected: ' + str(error), file=sys.stderr)
        sys.exit(1)
