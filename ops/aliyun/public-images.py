"""Prepare a local, image-only immutable migration. No network or server operations."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import tarfile

ROOT = Path(__file__).resolve().parents[2]
POLICY = Path(__file__).with_name('public-images.json')


def checked_images(root, policy):
    if set(policy) != {'schema', 'kind', 'files'} or type(policy['schema']) is not int or policy['schema'] != 1 or policy['kind'] != 'public-images':
        raise ValueError('Invalid image policy')
    paths = set()
    images = []
    for item in policy['files']:
        if set(item) != {'path', 'bytes', 'sha256', 'contentType'}:
            raise ValueError('Invalid image entry')
        name = item['path']
        if not isinstance(name, str) or not re.fullmatch(r'commerce/(?:[a-z0-9][a-z0-9._-]*/)*[a-z0-9][a-z0-9._-]*\.(jpg|webp)', name):
            raise ValueError('Image path is outside the reviewed public namespace')
        if name in paths or not re.fullmatch('[a-f0-9]{64}', item['sha256']):
            raise ValueError('Duplicate image or invalid digest')
        paths.add(name)
        path = root
        for part in name.split('/'):
            path = path / part
            if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
                raise ValueError('Image input contains a symlink')
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Image input is not a single regular file')
        data = path.read_bytes()
        if type(item['bytes']) is not int or not 0 < item['bytes'] <= 16 * 1024 * 1024 or len(data) != item['bytes']:
            raise ValueError('Image byte length mismatch')
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Image digest mismatch')
        jpeg = name.endswith('.jpg')
        expected = 'image/jpeg' if jpeg else 'image/webp'
        valid = data.startswith(b'\xff\xd8\xff') if jpeg else (len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP')
        if item['contentType'] != expected or not valid:
            raise ValueError('Image content type mismatch')
        images.append((name, data))
    if not images:
        raise ValueError('Empty migration is not supported')
    excluded = set(json.loads((ROOT / 'ops/aliyun/release-public-policy.json').read_bytes())['excludedSourceFiles'])
    # New public examples must be reviewed/versioned, never silently added to a bundled release.
    for candidate in (root / 'commerce').rglob('*'):
        if candidate.is_symlink() or getattr(candidate, 'is_junction', lambda: False)():
            raise ValueError('Catalogue contains a link')
        if candidate.is_file() and candidate.suffix.lower() in {'.jpg', '.jpeg', '.webp', '.png', '.avif', '.gif', '.svg'}:
            name = candidate.relative_to(root).as_posix()
            if name not in paths and name not in excluded:
                raise ValueError('Unreviewed public catalogue image: update the pinned image policy')
    return images


def prepare(output):
    output = output.resolve()
    if output == ROOT or output.is_relative_to(ROOT) or ROOT.is_relative_to(output):
        raise ValueError('Migration output must be outside the checkout')
    raw = POLICY.read_bytes().replace(b'\r\n', b'\n')
    policy = json.loads(raw)
    images = checked_images(ROOT / 'apps/web/public', policy)
    version = hashlib.sha256(raw).hexdigest()
    # A new output directory and exclusive files prevent overwriting old releases.
    output.mkdir(mode=0o755)
    archive = output / 'public-images.tgz'
    with archive.open('xb') as stream:
        with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as compressed:
            with tarfile.open(mode='w', fileobj=compressed) as tar:
                for name, data in images:
                    entry = tarfile.TarInfo('static-assets/' + version + '/' + name)
                    entry.size = len(data)
                    entry.mode = 0o644
                    entry.mtime = 0
                    tar.addfile(entry, io.BytesIO(data))
    (output / 'public-images.json').write_bytes(raw)
    report = dict(schema=1, kind='public-images-migration', manifestSha256=version,
                  images=len(images), imageBytes=sum(len(data) for _, data in images),
                  archiveBytes=archive.stat().st_size,
                  archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                  serverVerified=False, deployed=False)
    (output / 'migration-report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.output)))
    except (OSError, ValueError):
        raise SystemExit('Image migration preparation failed; no server changes were attempted')
