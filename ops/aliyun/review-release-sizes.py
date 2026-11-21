"""Byte-only diagnostic summary; never expose environment or artifact contents."""
from collections import Counter
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
        rawReleaseInputsBytes=raw, categories=cats, runtimePackagesLargest=runtime,
        runtimeFiles=int(audit['runtimeRegularFiles']),
        separateGeneratedDiagnosticsBytes=int(audit['diagnostics']['bytes']),
        excludedPublicSourceBytes=int(audit['excludedPublicPolicy']['bytes']),
        assembledTotal=scan(private / 'app')['bytes'],
        transportGzipBytes=(private / 'packed/transport.tgz').stat().st_size,
    )
    front = scan(frontend)
    front['diagnosticGzipBytes'] = (private / 'frontend-diagnostic.tgz').stat().st_size
    print('ZIMAGE_RELEASE_SIZES ' + json.dumps(dict(commit=sha, units='bytes', scope='linux-review-runner',
                                                  backend=backend, frontend=front), sort_keys=True))


if __name__ == '__main__':
    main(*sys.argv[1:])
