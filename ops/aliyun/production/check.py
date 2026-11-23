"""Read-only checks shared by the host TLS probe and independent public runner."""
import json
import re
import subprocess

ORIGIN = 'https://www.zimage.store'
SHA = re.compile('[a-f0-9]{40}')
NAMESPACE = re.compile('[A-Za-z0-9][A-Za-z0-9._-]{0,127}')


def fetch(path, local):
    cmd = ['/usr/bin/curl', '-q', '--silent', '--show-error', '--noproxy', '*',
           '--proto', '=https', '--max-time', '8', '--max-filesize', '8000000',
           '--header', 'Cache-Control: no-cache', '--write-out', '\n%{content_type}\n%{http_code}']
    if local:
        cmd += ['--resolve', 'www.zimage.store:443:127.0.0.1']
    output = subprocess.check_output(cmd + [ORIGIN + path])
    body, content_type, status = output.rsplit(b'\n', 2)
    if status != b'200':
        raise ValueError('Unexpected HTTP status on ' + path)
    if path.endswith('.js') and content_type.lower().split(b';')[0] not in (b'application/javascript', b'text/javascript'):
        raise ValueError('Unexpected script MIME type')
    return body


def probe(sha, namespace, local=False):
    if not SHA.fullmatch(sha) or not NAMESPACE.fullmatch(namespace):
        raise ValueError('Invalid expected pair')
    ready = json.loads(fetch('/api/health/ready', local))
    version = json.loads(fetch('/version.json', local))
    meta = json.loads(fetch('/api/meta', local))
    conf = json.loads(fetch('/api/public-config', local))
    if (ready.get('status') != 'ok' or ready.get('version') != sha or meta.get('backendRelease') != sha
            or version != {'schemaVersion': 1, 'frontendRelease': namespace}
            or conf.get('formalAuth') is not True or conf.get('dataMode') != 'http'
            or meta.get('api', {}).get('major') != 1 or
            not {'runtime.public-config.v1', 'runtime.meta.v1'}.issubset(meta['capabilities'])):
        raise ValueError('HTTPS pair or runtime contract mismatch')
    html = fetch('/', local).decode()
    script = re.search(r'<script\b[^>]*\bsrc="(/frontend-assets/' + re.escape(namespace)
                       + r'/[a-zA-Z0-9_./-]+\.js)"', html)
    if not script or '..' in script[1].split('/') or not fetch(script[1], local).strip():
        raise ValueError('Versioned frontend entry missing')
