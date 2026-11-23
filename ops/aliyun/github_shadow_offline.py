"""Offline-only, non-authorizing adapter for independently provisioned gh/root."""
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import tempfile

from github_hosted_stage_shadow import PREDICATE, _require, from_gh, verified_subject


GH_PREFIX = Path('/usr/local/libexec/zimage-paired-release')
ROOT_PREFIX = Path('/etc/zimage')
DATABASE_REPOSITORY = 'zhYAO/Image-web'
DATABASE_REPOSITORY_ID = 1329578390
DATABASE_WORKFLOW = DATABASE_REPOSITORY + '/.github/workflows/observe-ordinary-database.yml'
DATABASE_PREDICATE = 'https://zimage.store/attestations/ordinary-database/v1'
PUBLIC_WORKFLOW = DATABASE_REPOSITORY + '/.github/workflows/observe-ordinary-public.yml'
PUBLIC_PREDICATE = 'https://zimage.store/attestations/ordinary-public-observation/v1'


def _trusted_ancestors(path, prefix):
    path = Path(path)
    _require(path.is_absolute() and '..' not in path.parts and prefix in path.parents)
    for parent in reversed(path.parents):
        info = parent.lstat()
        _require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)


def _read_trusted(path, maximum, expected_digest, prefix):
    # No candidate path or expected digest is allowed at the policy boundary.
    _trusted_ancestors(path, prefix)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        info = os.fstat(f.fileno())
        _require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o022
                 and info.st_uid == 0 and 0 < info.st_size <= maximum)
        raw = f.read(maximum + 1)
    _require(0 < len(raw) <= maximum and hashlib.sha256(raw).hexdigest() == expected_digest)
    return raw


def _argv(binary, subject, expected, predicate):
    return [
        binary, 'attestation', 'verify', str(subject), '--repo', expected['repository'],
        '--signer-workflow', expected['signerWorkflow'], '--signer-digest', expected['signerSHA'],
        '--source-ref', expected['sourceRef'], '--source-digest', expected['sourceSHA'],
        '--deny-self-hosted-runners', '--predicate-type', predicate, '--format', 'json',
    ]


def verify(*, payload, bundle, expected, gh_path, gh_sha256,
           trusted_root_path, trusted_root_sha256):
    """Paths and digests are trusted host policy, never packet-supplied."""
    return _verify(payload, bundle, expected, gh_path, gh_sha256, trusted_root_path, trusted_root_sha256,
                   predicate=PREDICATE, parse=from_gh)


def verify_database(**evidence):
    """Accept only the separate protected-main database witness workflow."""
    return _verify_observer(workflow=DATABASE_WORKFLOW, predicate=DATABASE_PREDICATE, **evidence)


def verify_public(**evidence):
    """Accept only the separate protected-main public witness workflow."""
    return _verify_observer(workflow=PUBLIC_WORKFLOW, predicate=PUBLIC_PREDICATE, **evidence)


def _verify_observer(*, workflow, predicate, payload, bundle, signer_sha, source_sha, run, attempt, gh_path, gh_sha256,
                     trusted_root_path, trusted_root_sha256):
    expected = dict(repository=DATABASE_REPOSITORY, repositoryId=DATABASE_REPOSITORY_ID,
                    signerWorkflow=workflow, signerSHA=signer_sha, sourceRef='refs/heads/main',
                    sourceSHA=source_sha, runId=run, attempt=attempt)

    def parse(result, *, payload, subject_path, expected):
        return verified_subject(result.stdout, payload=payload, expected=expected, predicate=predicate)

    return _verify(payload, bundle, expected, gh_path, gh_sha256, trusted_root_path, trusted_root_sha256,
                   predicate=predicate, parse=parse)


def _verify(payload, bundle, expected, gh_path, gh_sha256, trusted_root_path, trusted_root_sha256, *, predicate, parse):
    _require(type(payload) is bytes and 0 < len(payload) <= 4096
             and type(bundle) is bytes and 0 < len(bundle) <= 1024 * 1024)
    _require(expected.get('sourceRef') == 'refs/heads/main')
    _read_trusted(gh_path, 128 * 1024 * 1024, gh_sha256, GH_PREFIX)
    trusted_root = _read_trusted(trusted_root_path, 1024 * 1024, trusted_root_sha256, ROOT_PREFIX)
    with tempfile.TemporaryDirectory(prefix='zimage-offline-shadow-', dir='/tmp') as temp:
        home = Path(temp)
        subject, supplied, roots = (home / name for name in ('statement.json', 'bundle.jsonl', 'roots.jsonl'))
        for p, content in ((subject, payload), (supplied, bundle), (roots, trusted_root)):
            with p.open('xb') as f:
                f.write(content)
            p.chmod(0o400)
        online_shape = _argv(str(gh_path), subject, expected, predicate)
        offline_argv = online_shape + ['--bundle', str(supplied), '--custom-trusted-root', str(roots)]
        # Do not inherit PATH, GH_TOKEN, GITHUB_TOKEN, proxy overrides, or gh user config.
        dead_proxy = 'http://127.0.0.1:9'
        env = dict(HOME=temp, GH_CONFIG_DIR=temp, XDG_CONFIG_HOME=temp, TMPDIR=temp,
                   GH_PROMPT_DISABLED='1', GH_TELEMETRY='0', GH_NO_UPDATE_NOTIFIER='1',
                   GH_NO_EXTENSION_UPDATE_NOTIFIER='1', LANG='C',
                   HTTP_PROXY=dead_proxy, HTTPS_PROXY=dead_proxy, ALL_PROXY=dead_proxy, NO_PROXY='')
        result = subprocess.run(offline_argv, env=env, cwd=temp, stdin=subprocess.DEVNULL,
                                capture_output=True, timeout=15, check=False)
        _require(result.args == offline_argv and result.returncode == 0)
        # Normalization is internal, only after verifying the actual offline argv
        # and exit status. Retain a single existing verified JSON schema checker.
        normalized = subprocess.CompletedProcess(online_shape, result.returncode, result.stdout)
        verified = parse(normalized, payload=payload, subject_path=subject, expected=expected)
        repository_id = expected.get('repositoryId')
        _require(type(repository_id) is int and repository_id > 0
                 and verified['verified_certificate'].get('sourceRepositoryIdentifier') == str(repository_id))
        return verified
