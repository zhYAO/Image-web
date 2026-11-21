"""Byte-only diagnostic summary; never expose environment or artifact contents."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


def scan(root):
    result = Counter()
    files = 0
    for current, _, names in os.walk(root, followlinks=False):
        for name in names:
            path = Path(current) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                continue
            files += 1
            if path.relative_to(root).parts[0] == '.release':
                key = 'diagnosticMetadata'
            elif path.suffix.lower() in {'.webp', '.jpg', '.jpeg', '.png', '.svg', '.gif', '.avif', '.ico'}:
                key = 'images'
            else:
                key = {'.js': 'javascript', '.css': 'stylesheets', '.html': 'html',
                       '.map': 'sourceMaps', '.woff': 'fonts', '.woff2': 'fonts'}.get(path.suffix, 'other')
            result[key] += info.st_size
    return dict(files=files, bytes=sum(result.values()), categories=dict(result))


def verified_packed_metrics(sha, private):
    store = private / 'store'
    manifest_path = store / 'releases' / (sha + '.json')
    manifest_body = manifest_path.read_bytes()
    manifest = json.loads(manifest_body)
    assembly = json.loads((private / 'assembly.json').read_bytes())
    if (manifest['schema'] != 3 or manifest['releaseId'] != sha
            or assembly['manifestSha256'] != hashlib.sha256(manifest_body).hexdigest()
            or assembly['raw'] != manifest['raw']):
        raise ValueError('Packed size manifest does not match exact verified assembly')
    layers = {}
    for kind in ('code', 'runtime', 'assets'):
        layer = manifest['layers'][kind]
        archive = layer['archive']
        if not re.fullmatch('layers/' + kind + r'-[a-f0-9]{64}\.tgz', archive):
            raise ValueError('Unexpected verified layer path')
        info = (store / archive).lstat()
        if not stat.S_ISREG(info.st_mode) or layer['archiveBytes'] != info.st_size:
            raise ValueError('Verified archive size differs from stored layer bytes')
        layers[kind] = dict(archiveGzipBytes=info.st_size, regularFileBytes=layer['rawBytes'],
                            symlinkTargetBytes=layer['symlinkTargetBytes'], indexBytes=layer['indexBytes'])
    raw = manifest['raw']
    return dict(layers=layers, regularFileBytes=sum(layer['regularFileBytes'] for layer in layers.values()),
                rawAccountingBytes=raw['totalBytes'], codeWithMetadataBytes=raw['codeBytes'],
                manifestBytes=len(manifest_body))


def main(sha, private, frontend):
    private, frontend = Path(private), Path(frontend)
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Expected exact branch SHA')
    audit = json.loads((private / 'dist-bytes.json').read_text())
    raw = audit['completeRuntimeBytes']
    cats = {name: int(value['bytes']) for name, value in audit['categories'].items()}
    if sum(cats.values()) != raw:
        raise ValueError('Backend category sizes differ from total')
    pkg = audit['runtimeDependencyAudit']['packages']
    runtime = {row['name']: int(row['bytes']) for row in pkg[:15]}
    backend = dict(
        sourceInputRegularBytes=raw, sourceInputCategories=cats, sourceInputRuntimePackagesLargest=runtime,
        sourceInputRuntimeFiles=int(audit['runtimeRegularFiles']),
        separateGeneratedDiagnosticsBytes=int(audit['diagnostics']['bytes']),
        excludedPublicSourceBytes=int(audit['excludedPublicPolicy']['bytes']),
        assembledAppDirectoryRegularBytes=scan(private / 'app')['bytes'],
        schema3Packed=verified_packed_metrics(sha, private),
        transportGzipBytes=(private / 'packed/transport.tgz').stat().st_size,
    )
    front = scan(frontend)
    front['diagnosticGzipBytes'] = (private / 'frontend-diagnostic.tgz').stat().st_size
    print('ZIMAGE_RELEASE_SIZES ' + json.dumps(dict(commit=sha, units='bytes', scope='linux-review-runner',
                                                  backend=backend, frontend=front), sort_keys=True))


if __name__ == '__main__':
    main(*sys.argv[1:])
