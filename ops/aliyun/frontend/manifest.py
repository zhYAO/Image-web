"""Bounded, portable static artifacts. No uploaded code is ever executed.

Wire schemas mirror packages/domain/src/runtime-contracts.ts. SHA256 proves
integrity, not builder authorization; expected hashes must arrive independently.
"""
import hashlib
import gzip
from html import unescape
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import stat
import tarfile
import tempfile
import unicodedata
from urllib.parse import unquote, urlsplit

MAX_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_FILES = 20000
MAX_JSON = 4 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_TEXT = 16 * 1024 * 1024
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}')
HEX = re.compile(r'[a-f0-9]{64}')
CAP = re.compile(r'[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*')
EXTENSIONS = {'.html', '.js', '.mjs', '.css', '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.json', '.md', '.txt'}
INTERNAL = {'.release/manifest.json', '.release/file-index.json'}
TEXT = {'.html', '.js', '.mjs', '.css', '.svg', '.json', '.md', '.txt'}
RESOURCE = re.compile(r'\.(?:js|mjs|css|webp|png|jpe?g|gif|svg|ico|woff2?|otf|ttf|map)(?:[?#].*)?$', re.I)
SECRETS = re.compile(r'SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL|AUTH_RATE_LIMIT_PEPPER|SENTRY_AUTH_TOKEN|(?:OPENAI|ANTHROPIC|GEMINI|DEEPSEEK|PROVIDER)_API_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{16,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|postgres(?:ql)?://[^\s"\x27]+|sourceMappingURL\s*=|__NEXT_DATA__|next/dist|require\(["\x27]sharp["\x27]\)')


def forbidden_browser_marker(text):
    # The bundled Emacs Lisp grammar contains this real function name. Exempt
    # only its complete identifier, never a language/chunk or other key match.
    symbols = ('ask-user-about-supersession-threat', 'userlock--ask-user-about-supersession-threat')
    for match in SECRETS.finditer(text):
        if match.group() == 'sk-user-about-supersession-threat':
            end = match.end()
            for symbol in symbols:
                start = end - len(symbol)
                if (start >= 0 and text[start:end] == symbol
                        and (start == 0 or not re.fullmatch(r'[A-Za-z0-9_-]', text[start - 1]))
                        and (end == len(text) or not re.fullmatch(r'[A-Za-z0-9_-]', text[end]))):
                    break
            else:
                return True
            continue
        return True
    return False


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')


def parse(body):
    if len(body) > MAX_JSON:
        raise ValueError('JSON exceeds bound')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result
    try:
        return json.loads(body, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('Invalid JSON') from exc


def keys(value, expected):
    if type(value) is not dict or set(value) != set(expected):
        raise ValueError('Invalid schema fields')


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError('Invalid release identifier')
    return value


def checksum(value):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise ValueError('Invalid checksum')


def integer(value, minimum=0, maximum=9007199254740991):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('Invalid bounded integer')


def capabilities(value):
    if type(value) is not list or len(value) > 256 or any(not isinstance(x, str) or len(x) > 100 or not CAP.fullmatch(x) for x in value) or len(set(value)) != len(value):
        raise ValueError('Invalid capabilities')


def public_config(value):
    keys(value, ['schemaVersion', 'formalAuth', 'dataMode', 'captchaSiteKey', 'approvedLegalVersion', 'registrationEnabled'])
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['dataMode'] != 'http' or any(type(value[k]) is not bool for k in ['formalAuth', 'registrationEnabled']):
        raise ValueError('Invalid public configuration')
    for key, bound in [('captchaSiteKey', 2048), ('approvedLegalVersion', 80)]:
        item = value[key]
        if item is not None and (not isinstance(item, str) or not 1 <= len(item) <= bound or item.strip() != item or re.search(r'[\x00-\x1f\x7f]', item)):
            raise ValueError('Invalid public configuration')
    if value['registrationEnabled'] and (not value['formalAuth'] or value['captchaSiteKey'] is None or value['approvedLegalVersion'] is None):
        raise ValueError('Registration configuration fails closed')


def require_static_rollout_config(value):
    """Initial static rollout supports the formal HTTP authentication flow."""
    public_config(value)
    if value['formalAuth'] is not True or value['dataMode'] != 'http':
        raise ValueError('Initial static rollout requires formal HTTP authentication')


def requirements(value):
    keys(value, ['major', 'minMinor', 'capabilities'])
    integer(value['major'], 1)
    integer(value['minMinor'])
    capabilities(value['capabilities'])


def validate_manifest(value):
    keys(value, ['schemaVersion', 'assetNamespace', 'artifactId', 'sourceSHA', 'treeFingerprint', 'build', 'fileIndex', 'apiRequirements', 'verifiedBackendReleases'])
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('Invalid manifest schema')
    identifier(value['assetNamespace'])
    checksum(value['artifactId'])
    checksum(value['treeFingerprint'])
    if not isinstance(value['sourceSHA'], str) or not re.fullmatch(r'[a-f0-9]{40}', value['sourceSHA']):
        raise ValueError('Invalid source SHA')
    keys(value['build'], ['toolchainFingerprint', 'lockfileSha256', 'publicConfigFingerprint'])
    for item in value['build'].values(): checksum(item)
    index = value['fileIndex']
    keys(index, ['path', 'sha256', 'fileCount', 'totalBytes'])
    if index['path'] != '.release/file-index.json': raise ValueError('Invalid index location')
    checksum(index['sha256'])
    integer(index['fileCount'], 1, MAX_FILES)
    integer(index['totalBytes'], 0, MAX_BYTES)
    requirements(value['apiRequirements'])
    releases = value['verifiedBackendReleases']
    if type(releases) is not list or not 1 <= len(releases) <= 256 or any(not isinstance(x, str) or not ID.fullmatch(x) for x in releases) or len(set(releases)) != len(releases):
        raise ValueError('Invalid verified backend releases')
    return value


def validate_api_meta(meta):
    keys(meta, ['schemaVersion', 'backendRelease', 'api', 'capabilities'])
    if type(meta['schemaVersion']) is not int or meta['schemaVersion'] != 1: raise ValueError('Invalid API meta schema')
    identifier(meta['backendRelease'])
    keys(meta['api'], ['major', 'minor'])
    if type(meta['api']['major']) is not int or meta['api']['major'] != 1: raise ValueError('Invalid API major')
    integer(meta['api']['minor'])
    capabilities(meta['capabilities'])
    return meta


def compatibility(manifest, meta):
    validate_manifest(manifest)
    validate_api_meta(meta)
    need = manifest['apiRequirements']
    if need['major'] != meta['api']['major'] or need['minMinor'] > meta['api']['minor'] or not set(need['capabilities']).issubset(meta['capabilities']) or meta['backendRelease'] not in manifest['verifiedBackendReleases']:
        raise ValueError('Frontend/backend compatibility rejected')
    return meta['backendRelease']


def payload_path(name, internal=False):
    if internal and name in INTERNAL: return name
    if not isinstance(name, str) or not 1 <= len(name) <= 1024 or re.search(r'[\x00-\x1f\x7f\\%<>:"|?*#]', name):
        raise ValueError('Invalid payload path')
    parts = name.split('/')
    if any(not x or x.startswith('.') or x.endswith(('.', ' ')) or re.match(r'(?i)^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', x) for x in parts):
        raise ValueError('Invalid portable payload path')
    if any(x.lower() in {'node_modules', 'server', 'fonts', 'supabase', 'migrations'} for x in parts) or name.lower() == 'server.js' or Path(name).suffix.lower() not in EXTENSIONS:
        raise ValueError('Forbidden payload file')
    return name


def safe_directory(path):
    path = Path(os.path.abspath(path))
    for parent in [*reversed(path.parents), path]:
        if not stat.S_ISDIR(parent.lstat().st_mode):
            raise ValueError('Expected real directory without symlink ancestors')
    return path


def signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def read_regular(path, limit=MAX_FILE):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    before_path = Path(path).lstat()
    if not stat.S_ISREG(before_path.st_mode) or before_path.st_nlink != 1:
        raise ValueError('Expected single-link regular file')
    fd = os.open(path, flags)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if signature(before) != signature(before_path) or before.st_size > limit:
            raise ValueError('File changed or exceeds bound')
        data = bytearray()
        for block in iter(lambda: stream.read(min(1024 * 1024, limit + 1 - len(data))), b''):
            data.extend(block)
            if len(data) > limit: raise ValueError('File exceeds bound')
        if len(data) > limit or len(data) != before.st_size or signature(before) != signature(os.fstat(stream.fileno())):
            raise ValueError('File changed while reading')
    return bytes(data)


def hash_regular(path):
    """Bounded-memory hashing for server media and whole-tree verification."""
    before_path = Path(path).lstat()
    if not stat.S_ISREG(before_path.st_mode) or before_path.st_nlink != 1 or before_path.st_size > MAX_FILE:
        raise ValueError('Nonregular, linked or oversized payload')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if signature(before) != signature(before_path): raise ValueError('Payload changed before hashing')
        hasher, total = hashlib.sha256(), 0
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            total += len(block)
            if total > before.st_size: raise ValueError('Payload grew while hashing')
            hasher.update(block)
        if total != before.st_size or signature(before) != signature(os.fstat(stream.fileno())):
            raise ValueError('Payload changed while hashing')
        return total, hasher.hexdigest()


def inventory(root, allow_internal=True, candidate=False):
    root = safe_directory(root)
    files, seen, total = {}, set(), 0
    def walk(directory, prefix=''):
        nonlocal total
        for name in sorted(os.listdir(directory)):
            path = directory / name
            relative = prefix + name
            info = path.lstat()
            normalized = unicodedata.normalize('NFC', relative).lower()
            if normalized in seen: raise ValueError('Conflicting portable payload paths')
            seen.add(normalized)
            if stat.S_ISDIR(info.st_mode):
                if relative == '.release' and (allow_internal or candidate):
                    pass
                else:
                    # Validate directories using a synthetic public file.
                    payload_path(relative + '/directory.txt')
                walk(path, relative + '/')
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                if not (candidate and relative == '.release/candidate.json'):
                    payload_path(relative, allow_internal)
                body = read_regular(path)
                total += len(body)
                if len(files) >= MAX_FILES + 2 or total > MAX_BYTES + MAX_JSON * 2:
                    raise ValueError('Payload exceeds file or byte budget')
                files[relative] = body
            else: raise ValueError('Nonregular or linked payload')
    walk(root)
    return files


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values = []
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value is None: continue
            if key in {'src', 'href', 'poster', 'data', 'xlink:href'}: self.values.append(value)
            elif key == 'srcset': self.values.extend(item.strip().split(' ')[0] for item in value.split(','))
            elif key == 'style': self.values.extend(css_references(value))
    handle_startendtag = handle_starttag


def css_references(text):
    return [match[0] or match[1] for match in re.findall(r'url\(\s*["\x27]?([^"\x27)\s]+)["\x27]?\s*\)|@import\s+["\x27]([^"\x27]+)["\x27]', text)]


def resource_target(value, owner, namespace):
    value = unescape(value)
    if not value or value.startswith(('#', 'data:', 'blob:')) or '${' in value: return None
    if not RESOURCE.search(value): return None
    if re.match(r'(?i)^(?:https?:|//)', value):
        raise ValueError('External static resource outside artifact closure')
    if re.search(r'%(?![a-fA-F0-9]{2})', value): raise ValueError('Invalid resource URL')
    value = unquote(value.split('?', 1)[0].split('#', 1)[0], errors='strict')
    if '\\' in value or re.search(r'[\x00-\x1f\x7f]', value): raise ValueError('Invalid resource URL')
    prefix = '/frontend-assets/' + namespace + '/'
    if value.startswith(prefix): value = value[len(prefix):]
    elif value.startswith('/'): raise ValueError('Unversioned or foreign namespace resource')
    elif not value.startswith('assets/'):
        value = posixpath.join(posixpath.dirname(owner), value)
    # Reject traversal before normalization, even when it would stay in root.
    if '..' in value.split('/'): raise ValueError('Escaping resource URL')
    value = posixpath.normpath(value)
    payload_path(value)
    return value


def closure(files, namespace, scan=None):
    if 'index.html' not in files: raise ValueError('Missing static homepage')
    for name in files if scan is None else scan:
        body = files[name]
        if name in INTERNAL: continue
        payload_path(name)
        suffix = Path(name).suffix.lower()
        if body is None or suffix not in TEXT: continue
        if len(body) > MAX_TEXT: raise ValueError('Text payload exceeds scan budget')
        try: text = body.decode('utf-8')
        except UnicodeError as exc: raise ValueError('Invalid UTF-8 browser payload') from exc
        if forbidden_browser_marker(text): raise ValueError('Forbidden browser secret/server marker')
        references = []
        if suffix in {'.html', '.svg'}:
            parser = References()
            parser.feed(text)
            references.extend(parser.values)
        if suffix in {'.css', '.html', '.svg'}: references.extend(css_references(text))
        if suffix in {'.js', '.mjs', '.html', '.svg'}:
            # Vite imports, preload table, URL constructor and public constants.
            references.extend(re.findall(r'["\x27]((?:\.{0,2}/|assets/)[^"\x27\n]+)["\x27]', text))
            references.extend(re.findall(r'(?:\bimport\s*\(|\bfrom\s*|\bimport\s+|\bnew\s+URL\s*\()\s*["\x27]([^"\x27]+)["\x27]', text))
        for reference in references:
            target = resource_target(reference, name, namespace)
            if target is not None and target not in files:
                raise ValueError('Missing static resource in closure')


def file_index(files):
    return {'schemaVersion': 1, 'files': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items()) if name not in INTERNAL]}


def artifact_identity(index_sha, config_sha):
    return digest(canonical({'schemaVersion': 1, 'fileIndexSha256': index_sha, 'publicConfigFingerprint': config_sha}))


def verify(root, manifest_sha=None):
    root = safe_directory(root)
    files, seen, records, total = {}, set(), [], 0
    # Walk/hash without retaining media bytes. No links/extra files are skipped.
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            normalized = unicodedata.normalize('NFC', relative).lower()
            if normalized in seen: raise ValueError('Conflicting portable payload paths')
            seen.add(normalized)
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                if relative != '.release': payload_path(relative + '/directory.txt')
                continue
            payload_path(relative, internal=True)
            size, checksum_value = hash_regular(path)
            total += size
            if len(files) >= MAX_FILES + 2 or total > MAX_BYTES + MAX_JSON * 2: raise ValueError('Payload exceeds budget')
            files[relative] = None
            if relative not in INTERNAL: records.append({'path': relative, 'bytes': size, 'sha256': checksum_value})
    if not INTERNAL.issubset(files): raise ValueError('Missing release metadata')
    body = read_regular(root / '.release/manifest.json', MAX_JSON)
    if manifest_sha is not None and digest(body) != manifest_sha: raise ValueError('Manifest checksum mismatch')
    value = validate_manifest(parse(body))
    expected_index = canonical({'schemaVersion': 1, 'files': sorted(records, key=lambda item: item['path'])})
    index_body = read_regular(root / '.release/file-index.json', MAX_JSON)
    if index_body != expected_index or digest(index_body) != value['fileIndex']['sha256']:
        raise ValueError('File index digest or exact payload set mismatch')
    index = parse(index_body)
    if value['fileIndex']['fileCount'] != len(index['files']) or value['fileIndex']['totalBytes'] != sum(x['bytes'] for x in index['files']):
        raise ValueError('Payload size accounting mismatch')
    if value['artifactId'] != artifact_identity(digest(index_body), value['build']['publicConfigFingerprint']):
        raise ValueError('Artifact identity mismatch')
    version = parse(read_regular(root / 'version.json', MAX_JSON)) if 'version.json' in files else {}
    if version != {'schemaVersion': 1, 'frontendRelease': value['assetNamespace']}:
        raise ValueError('Public version marker mismatch')
    for name in files:
        if name not in INTERNAL and Path(name).suffix.lower() in TEXT:
            scan_files = dict(files)
            scan_files[name] = read_regular(root / name, MAX_TEXT)
            closure(scan_files, value['assetNamespace'], scan=[name])
    return value


def candidate_files(dist, config):
    """Canonical evidence subject; never creates an acceptance/verified claim."""
    public_config(config)
    files = inventory(dist, allow_internal=False, candidate=True)
    body = files.pop('.release/candidate.json', None)
    if body is None: raise ValueError('Missing candidate metadata')
    candidate = parse(body)
    keys(candidate, ['schemaVersion', 'namespace', 'apiRequirements', 'allowedBackendReleases', 'sourceIdentity', 'buildToolchainFingerprint'])
    if type(candidate['schemaVersion']) is not int or candidate['schemaVersion'] != 1: raise ValueError('Invalid candidate schema')
    namespace = identifier(candidate['namespace'])
    if namespace == 'none': raise ValueError('Release namespace is reserved for empty current')
    requirements(candidate['apiRequirements'])
    source = candidate['sourceIdentity']
    keys(source, ['sourceSHA', 'treeFingerprint', 'lockfileSha256', 'dirty'])
    if not isinstance(source['sourceSHA'], str) or re.fullmatch(r'[a-f0-9]{40}', source['sourceSHA']) is None or type(source['dirty']) is not bool:
        raise ValueError('Invalid candidate source identity')
    checksum(source['treeFingerprint'])
    checksum(source['lockfileSha256'])
    checksum(candidate['buildToolchainFingerprint'])
    releases = candidate['allowedBackendReleases']
    if type(releases) is not list or not 1 <= len(releases) <= 256 or len(set(releases)) != len(releases): raise ValueError('Invalid candidate backend allowlist')
    for release in releases: identifier(release)
    version = canonical({'schemaVersion': 1, 'frontendRelease': namespace})
    if 'version.json' in files and files['version.json'] != version: raise ValueError('Conflicting public version marker')
    files['version.json'] = version
    closure(files, namespace)
    subject = {'schemaVersion': 1, 'candidateSha256': digest(body), 'payloadIndexSha256': digest(canonical(file_index(files))),
               'publicConfigFingerprint': digest(canonical(config))}
    return files, candidate, subject


def acceptance_evidence(evidence, subject, verified):
    if evidence is None: raise ValueError('Explicit acceptance evidence is required')
    keys(evidence, [*subject, 'backendReleases'])
    if any(evidence[k] != v for k, v in subject.items()): raise ValueError('acceptance evidence does not bind this candidate payload/config')
    results = evidence['backendReleases']
    if type(results) is not list or not 1 <= len(results) <= 256: raise ValueError('Invalid acceptance reports')
    releases = []
    for result in results:
        keys(result, ['backendRelease', 'acceptanceSha256'])
        releases.append(identifier(result['backendRelease']))
        checksum(result['acceptanceSha256'])
    if len(set(releases)) != len(releases) or set(releases) != set(verified): raise ValueError('Acceptance reports differ from verified backends')


def pack(dist, output, options, config, evidence=None):
    keys(options, ['assetNamespace', 'sourceSHA', 'treeFingerprint', 'build', 'apiRequirements', 'verifiedBackendReleases'])
    keys(options['build'], ['toolchainFingerprint', 'lockfileSha256'])
    require_static_rollout_config(config)
    namespace = identifier(options['assetNamespace'])
    files, candidate, subject = candidate_files(dist, config)
    expected_source = {'sourceSHA': options['sourceSHA'], 'treeFingerprint': options['treeFingerprint'],
                       'lockfileSha256': options['build']['lockfileSha256'], 'dirty': False}
    if candidate['sourceIdentity'] != expected_source:
        raise ValueError('Candidate source identity is dirty or differs from packaging source')
    if candidate['buildToolchainFingerprint'] != options['build']['toolchainFingerprint']:
        raise ValueError('Candidate toolchain differs from packaging toolchain')
    if namespace != candidate['namespace'] or options['apiRequirements'] != candidate['apiRequirements'] or not set(options['verifiedBackendReleases']).issubset(candidate['allowedBackendReleases']):
        raise ValueError('Formal manifest differs from candidate constraints')
    acceptance_evidence(evidence, subject, options['verifiedBackendReleases'])
    index = file_index(files)
    index_body = canonical(index)
    if len(index_body) > MAX_JSON: raise ValueError('File index exceeds metadata budget')
    build = dict(options['build'], publicConfigFingerprint=digest(canonical(config)))
    value = dict(options, schemaVersion=1, artifactId=artifact_identity(digest(index_body), build['publicConfigFingerprint']), build=build,
                 fileIndex={'path': '.release/file-index.json', 'sha256': digest(index_body), 'fileCount': len(index['files']), 'totalBytes': sum(x['bytes'] for x in index['files'])})
    validate_manifest(value)
    files['.release/manifest.json'], files['.release/file-index.json'] = canonical(value), index_body
    output = Path(os.path.abspath(output))
    safe_directory(output.parent)
    if output.exists() or output.is_symlink(): raise ValueError('Output already exists')
    # Snapshot bytes used for validation are exactly the bytes archived.
    try:
        with output.open('xb') as raw:
            with tarfile.open(fileobj=raw, mode='w:gz', format=tarfile.USTAR_FORMAT) as archive:
                for name, body in sorted(files.items()):
                    item = tarfile.TarInfo(name)
                    item.size, item.mode, item.uid, item.gid, item.mtime = len(body), 0o644, 0, 0, 0
                    archive.addfile(item, io.BytesIO(body))
            raw.flush()
            os.fsync(raw.fileno())
        archive_body = read_regular(output, MAX_ARCHIVE)
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return {'schemaVersion': 1, 'archive': str(output), 'archiveSha256': digest(archive_body), 'archiveBytes': len(archive_body),
            'manifestSha256': digest(files['.release/manifest.json']), 'artifactId': value['artifactId'], 'assetNamespace': namespace, 'fileCount': len(index['files']), 'payloadBytes': value['fileIndex']['totalBytes'], 'productionReady': False}


def extract_strict(archive, destination, validator=None, max_bytes=MAX_BYTES):
    archive = Path(archive)
    archive_info = archive.lstat()
    if not stat.S_ISREG(archive_info.st_mode) or archive_info.st_nlink != 1 or archive_info.st_size > MAX_ARCHIVE:
        raise ValueError('Archive must be bounded single-link regular file')
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    safe_directory(destination)
    seen, total = set(), 0
    try:
        # Strict streaming USTAR: reject extension/link headers BEFORE any
        # tar library could allocate/read an unbounded GNU or PAX extension.
        archive_fd = os.open(archive, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(archive_fd, 'rb') as compressed, gzip.GzipFile(fileobj=compressed, mode='rb') as tar:
            if signature(archive_info) != signature(os.fstat(compressed.fileno())): raise ValueError('Archive changed before extraction')
            while True:
                header = tar.read(512)
                if header == b'\0' * 512:
                    if tar.read(512) != b'\0' * 512: raise ValueError('Invalid archive terminator')
                    trailing = tar.read(10241)
                    if len(trailing) > 10240 or any(trailing): raise ValueError('Trailing archive payload')
                    break
                if len(header) != 512 or header[257:265] != b'ustar\x0000' or header[156:157] not in {b'0', b'\0'} or any(header[157:257]):
                    raise ValueError('Only regular USTAR files accepted')
                def octal(field):
                    stripped = field.strip(b'\0 ')
                    if not stripped or re.fullmatch(b'[0-7]+', stripped) is None: raise ValueError('Invalid archive numeric field')
                    return int(stripped, 8)
                if octal(header[148:156]) != sum(header[:148] + b'        ' + header[156:]): raise ValueError('Archive header checksum mismatch')
                short = header[:100].split(b'\0', 1)[0].decode('utf-8')
                prefix = header[345:500].split(b'\0', 1)[0].decode('utf-8')
                name = (prefix + '/' if prefix else '') + short
                (validator or (lambda value: payload_path(value, internal=True)))(name)
                size = octal(header[124:136])
                normalized = unicodedata.normalize('NFC', name).lower()
                if normalized in seen or size > MAX_FILE:
                    raise ValueError('Archive duplicate, link, extension or special file rejected')
                seen.add(normalized)
                total += size
                if len(seen) > MAX_FILES + 3 or total > max_bytes + (MAX_JSON * 2 if max_bytes == MAX_BYTES else 0):
                    raise ValueError('Archive expansion exceeds budget')
                target = destination.joinpath(*name.split('/'))
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with target.open('xb') as out:
                    remaining = size
                    while remaining:
                        block = tar.read(min(1024 * 1024, remaining))
                        if not block: raise ValueError('Truncated archive payload')
                        out.write(block)
                        remaining -= len(block)
                    out.flush()
                    os.fsync(out.fileno())
                padding = tar.read((-size) % 512)
                if len(padding) != (-size) % 512 or any(padding): raise ValueError('Invalid archive padding')
            if signature(archive_info) != signature(os.fstat(compressed.fileno())): raise ValueError('Archive changed during extraction')
        return destination
    except (tarfile.TarError, EOFError, OSError, UnicodeError) as exc:
        raise ValueError('Invalid or truncated archive') from exc


def unpack(archive, destination, manifest_sha, max_bytes=MAX_BYTES):
    checksum(manifest_sha)
    extract_strict(archive, destination, max_bytes=max_bytes)
    return verify(destination, manifest_sha)


# Stable names for release/back-end adapters.
validateFrontendArtifact = verify
