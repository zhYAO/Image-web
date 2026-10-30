"""Offline real-filesystem release safety tests; no SSH, root or services."""
import hashlib
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import threading
import tracemalloc
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    target = HERE / (name + '.py')
    if not target.exists():
        raise AssertionError('Missing executable frontend implementation: ' + target.name)
    spec = importlib.util.spec_from_file_location('frontend_' + name, target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.m = load('manifest')
        self.r = load('release')
        self.meta = {'schemaVersion': 1, 'backendRelease': 'backend-A', 'api': {'major': 1, 'minor': 2}, 'capabilities': ['workspace.v1']}
        self.public = {'schemaVersion': 1, 'formalAuth': True, 'dataMode': 'http', 'captchaSiteKey': None, 'approvedLegalVersion': None, 'registrationEnabled': False}
        self.options = {'assetNamespace': 'web-A', 'sourceSHA': 'a' * 40, 'treeFingerprint': 'b' * 64,
                        'build': {'toolchainFingerprint': 'c' * 64, 'lockfileSha256': 'd' * 64},
                        'apiRequirements': {'major': 1, 'minMinor': 1, 'capabilities': ['workspace.v1']},
                        'verifiedBackendReleases': ['backend-A']}
        self.server = self.root / 'server'
        self.server.mkdir(mode=0o700)
        self.calls = []
        def probe(namespace, backend):
            self.calls.append((namespace, backend))
            return True
        self.adapter = self.r.Publisher(self.server, owner_uid=os.getuid(), probe=probe, meta=lambda: self.meta, approval=lambda value, checksum: True, reserve_bytes=0)

    def tearDown(self):
        if hasattr(self, 'tmp'):
            for root, dirs, files in os.walk(self.tmp.name):
                os.chmod(root, 0o700)
                for name in files:
                    if not os.path.islink(os.path.join(root, name)):
                        os.chmod(os.path.join(root, name), 0o600)
            self.tmp.cleanup()

    def dist(self, namespace='web-A', script='export const result=1;', ref='lazy.js'):
        path = self.root / ('input-' + namespace)
        path.mkdir()
        (path / 'assets').mkdir()
        (path / 'index.html').write_text('<!doctype html><h1>Public homepage</h1><script type="module" src="/frontend-assets/' + namespace + '/assets/main.js"></script>')
        (path / 'assets/main.js').write_text('import("./' + ref + '");' + script)
        (path / 'assets/lazy.js').write_text('export const lazy=1;')
        (path / '.release').mkdir()
        (path / '.release/candidate.json').write_bytes(self.m.canonical({'schemaVersion': 1, 'namespace': namespace,
            'apiRequirements': self.options['apiRequirements'], 'allowedBackendReleases': ['backend-A'],
            'sourceIdentity': {'sourceSHA': self.options['sourceSHA'], 'treeFingerprint': self.options['treeFingerprint'],
                               'lockfileSha256': self.options['build']['lockfileSha256'], 'dirty': False},
            'buildToolchainFingerprint': self.options['build']['toolchainFingerprint']}))
        return path

    def evidence(self, dist):
        files = self.m.inventory(dist, allow_internal=True, candidate=True)
        candidate = files.pop('.release/candidate.json')
        namespace = self.m.parse(candidate)['namespace']
        files['version.json'] = self.m.canonical({'schemaVersion': 1, 'frontendRelease': namespace})
        return {'schemaVersion': 1, 'candidateSha256': sha(candidate), 'payloadIndexSha256': sha(self.m.canonical(self.m.file_index(files))), 'publicConfigFingerprint': sha(self.m.canonical(self.public)),
                'backendReleases': [{'backendRelease': 'backend-A', 'acceptanceSha256': 'e' * 64}]}

    def pack(self, namespace='web-A', **kwargs):
        options = dict(self.options, assetNamespace=namespace)
        dist = self.dist(namespace, **kwargs)
        return self.m.pack(dist, self.root / (namespace + '.tgz'), options, self.public, self.evidence(dist))

    def test_candidate_without_bound_acceptance_cannot_become_formal_manifest(self):
        dist = self.dist()
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            self.m.pack(dist, self.root / 'bad.tgz', self.options, self.public)
        evidence = self.evidence(dist)
        (dist / 'assets/lazy.js').write_text('export const changed=1;')
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            self.m.pack(dist, self.root / 'bad.tgz', self.options, self.public, evidence)

    def test_candidate_backend_allowlist_and_api_requirements_are_binding(self):
        dist = self.dist()
        evidence = self.evidence(dist)
        for options in [dict(self.options, verifiedBackendReleases=['backend-X']),
                        dict(self.options, apiRequirements={'major': 1, 'minMinor': 0, 'capabilities': []})]:
            with self.assertRaises(ValueError):
                self.m.pack(dist, self.root / 'bad.tgz', options, self.public, evidence)

    def test_old_dist_cannot_be_relabelled_as_a_new_source_commit(self):
        dist = self.dist()
        options = dict(self.options, sourceSHA='f' * 40)
        with self.assertRaisesRegex(ValueError, 'source'):
            self.m.pack(dist, self.root / 'bad.tgz', options, self.public, self.evidence(dist))

    def test_dirty_candidate_cannot_be_packaged_even_with_bound_acceptance(self):
        dist = self.dist()
        path = dist / '.release/candidate.json'
        candidate = self.m.parse(path.read_bytes())
        candidate['sourceIdentity']['dirty'] = True
        path.write_bytes(self.m.canonical(candidate))
        with self.assertRaisesRegex(ValueError, 'source|dirty'):
            self.m.pack(dist, self.root / 'bad.tgz', self.options, self.public, self.evidence(dist))

    def test_old_dist_cannot_be_relabelled_as_a_new_build_toolchain(self):
        dist = self.dist()
        options = dict(self.options, build=dict(self.options['build'], toolchainFingerprint='f' * 64))
        with self.assertRaisesRegex(ValueError, 'toolchain'):
            self.m.pack(dist, self.root / 'bad.tgz', options, self.public, self.evidence(dist))

    def test_none_is_reserved_for_empty_current_and_cannot_name_a_release(self):
        with self.assertRaises(ValueError): self.pack('none')

    def test_inline_script_and_uppercase_script_missing_resources_are_rejected(self):
        for kind in ['inline', 'uppercase', 'object', 'svg']:
            dist = self.dist('scan-' + kind)
            if kind == 'inline': (dist / 'index.html').write_text('<h1>Public</h1><script type="module">import("./assets/missing.js")</script>')
            if kind == 'uppercase': (dist / 'assets/UPPER.JS').write_text('import("./missing.js");')
            if kind == 'object': (dist / 'index.html').write_text('<object data="/frontend-assets/scan-object/assets/missing.svg"></object>')
            if kind == 'svg': (dist / 'assets/icon.svg').write_text('<svg><image xlink:href="missing.png" /></svg>')
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'resource'):
                self.m.pack(dist, self.root / ('scan-' + kind + '.tgz'), dict(self.options, assetNamespace='scan-' + kind), self.public, self.evidence(dist))

    def test_server_verifier_does_not_load_large_public_media_tree_into_memory(self):
        dist = self.dist()
        with (dist / 'assets/large.png').open('wb') as out:
            for _ in range(20): out.write(b'x' * 1024 * 1024)
        report = self.m.pack(dist, self.root / 'large.tgz', self.options, self.public, self.evidence(dist))
        tracemalloc.start()
        try:
            self.m.unpack(Path(report['archive']), self.root / 'large-dist', report['manifestSha256'])
            _, peak = tracemalloc.get_traced_memory()
        finally: tracemalloc.stop()
        self.assertLess(peak, 12 * 1024 * 1024)

    def upload(self, report, operation='op-A'):
        incoming = self.server / 'incoming'
        incoming.mkdir(exist_ok=True)
        target = incoming / ('frontend-' + operation + '.tgz')
        shutil.copyfile(report['archive'], target)
        return target

    def deploy(self, report, operation='op-A', current=None):
        self.upload(report, operation)
        return self.adapter.deploy(operation, report['assetNamespace'], report['archiveSha256'], report['manifestSha256'], current)

    def test_cold_release_exact_rollback_and_retained_lazy_resources(self):
        a, b = self.pack(), self.pack('web-B', script='export const result=2;')
        self.assertEqual(self.deploy(a)['state'], 'committed')
        self.assertEqual(self.deploy(b, 'op-B', 'web-A')['state'], 'committed')
        self.assertEqual(self.adapter.current(), 'web-B')
        old = self.server / 'frontend/assets/web-A/assets/lazy.js'
        self.assertEqual(old.read_text(), 'export const lazy=1;')
        result = self.adapter.rollback('undo-B', 'web-B', 'web-A')
        self.assertEqual(result['state'], 'committed')
        self.assertEqual(self.adapter.current(), 'web-A')
        self.assertEqual(self.adapter.status()['previous'], 'web-B')
        self.assertEqual(result['backendRelease'], 'backend-A')

    def test_delta_upload_reuses_only_root_sealed_blobs_and_copies_payload(self):
        transport = load('transport')
        a, b = self.pack(), self.pack('web-B', script='export const result=2;')
        self.deploy(a)
        request = transport.request(Path(b['archive']), b['manifestSha256'])
        hints = self.adapter.inventory(request)
        delta = transport.bundle(Path(b['archive']), self.root / 'web-B.delta.tgz', b['manifestSha256'], hints)
        self.assertGreater(delta['reusedBlobBytes'], 0)
        self.assertGreater(delta['uploadBlobBytes'], 0)
        self.assertEqual(self.deploy(delta, 'op-B', 'web-A')['state'], 'committed')
        payload = self.server / 'frontend/releases/web-B/assets/lazy.js'
        cached = self.server / 'frontend/objects' / sha(payload.read_bytes())
        self.assertEqual(payload.stat().st_nlink, 1)
        self.assertNotEqual(payload.stat().st_ino, cached.stat().st_ino)
        self.assertEqual((self.server / 'frontend/assets/web-A/assets/lazy.js').read_bytes(), payload.read_bytes())

    def test_forged_inventory_does_not_authorize_missing_server_objects(self):
        transport = load('transport')
        report = self.pack()
        request = transport.request(Path(report['archive']), report['manifestSha256'])
        fake = dict(request, found=request['objects'])
        delta = transport.bundle(Path(report['archive']), self.root / 'fake-delta.tgz', report['manifestSha256'], fake)
        self.assertEqual(delta['uploadBlobBytes'], 0)
        with self.assertRaisesRegex(ValueError, 'object'):
            self.deploy(delta)
        self.assertIsNone(self.adapter.current())

    def test_corrupt_or_linked_cache_object_is_never_reused(self):
        transport = load('transport')
        report = self.pack()
        self.deploy(report)
        request = transport.request(Path(report['archive']), report['manifestSha256'])
        cached = self.server / 'frontend/objects' / request['objects'][0]['sha256']
        os.chmod(cached, 0o600)
        cached.write_bytes(b'corrupt')
        os.chmod(cached, 0o444)
        hints = self.adapter.inventory(request)
        self.assertNotIn(request['objects'][0], hints['found'])
        valid = next(item for item in request['objects'] if item in hints['found'])
        valid_path = self.server / 'frontend/objects' / valid['sha256']
        alias = self.root / 'cache-hardlink'
        os.link(valid_path, alias)
        self.assertNotIn(valid, self.adapter.inventory(request)['found'])
        alias.unlink()

    def test_uploaded_valid_blob_can_publish_without_overwriting_corrupt_cache(self):
        transport = load('transport')
        a, b = self.pack(), self.pack('web-B')
        self.deploy(a)
        item = sha(b'export const lazy=1;')
        cache = self.server / 'frontend/objects' / item
        os.chmod(cache, 0o600)
        cache.write_bytes(b'bad')
        os.chmod(cache, 0o444)
        request = transport.request(Path(b['archive']), b['manifestSha256'])
        delta = transport.bundle(Path(b['archive']), self.root / 'repairless-delta.tgz', b['manifestSha256'], self.adapter.inventory(request))
        self.assertEqual(self.deploy(delta, 'op-B', 'web-A')['state'], 'committed')
        self.assertEqual(cache.read_bytes(), b'bad')
        self.assertEqual((self.server / 'frontend/releases/web-B/assets/lazy.js').read_bytes(), b'export const lazy=1;')

    def test_delta_missing_extra_or_wrong_blob_is_rejected_before_switch(self):
        transport = load('transport')
        report = self.pack()
        hints = self.adapter.inventory(transport.request(Path(report['archive']), report['manifestSha256']))
        delta = transport.bundle(Path(report['archive']), self.root / 'delta.tgz', report['manifestSha256'], hints)
        with tarfile.open(delta['archive'], 'r:gz') as tar:
            original = {item.name: tar.extractfile(item).read() for item in tar}
        blob = next(name for name in original if name.startswith('blobs/'))
        for kind in ['missing', 'extra', 'wrong']:
            contents = dict(original)
            if kind == 'missing': del contents[blob]
            if kind == 'extra': contents['blobs/' + 'f' * 64] = b'not requested'
            if kind == 'wrong': contents[blob] = b'tampered'
            archive = self.root / ('bad-delta-' + kind + '.tgz')
            with tarfile.open(archive, 'w:gz', format=tarfile.USTAR_FORMAT) as tar:
                for name, body in contents.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(body)
                    tar.addfile(info, io.BytesIO(body))
            forged = dict(delta, archive=str(archive), archiveSha256=sha(archive.read_bytes()))
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.deploy(forged, 'bad-' + kind)
            self.assertIsNone(self.adapter.current())

    def test_frontend_deploy_and_rollback_never_start_subprocess_or_restart_service(self):
        report = self.pack()
        with patch('subprocess.run', side_effect=AssertionError('No service/process operations')):
            self.assertEqual(self.deploy(report)['state'], 'committed')
            self.assertEqual(self.adapter.rollback('same-version', 'web-A', 'web-A')['state'], 'committed')

    def test_payload_and_metadata_integrity(self):
        report = self.pack()
        stage = self.root / 'unpacked'
        self.m.unpack(Path(report['archive']), stage, report['manifestSha256'])
        manifest = self.m.verify(stage)
        self.assertNotEqual(manifest['artifactId'], manifest['build']['publicConfigFingerprint'])
        (stage / 'assets/lazy.js').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'digest|size|checksum'):
            self.m.verify(stage)

    def test_pack_rejects_missing_lazy_chunk(self):
        with self.assertRaisesRegex(ValueError, 'resource'):
            self.m.pack(self.dist(ref='missing.js'), self.root / 'bad.tgz', self.options, self.public)

    def test_pack_rejects_unversioned_and_foreign_namespace_resources(self):
        for url in ['/assets/a.js', '/frontend-assets/other/a.js', '../escape.js', '%2e%2e/a.js']:
            with self.subTest(url=url):
                path = self.dist('url-' + str(len(list(self.root.glob('input-*')))))
                (path / 'index.html').write_text('<script src="' + url + '"></script>')
                with self.assertRaises(ValueError):
                    self.m.pack(path, self.root / 'bad.tgz', self.options, self.public)

    def test_pack_forbids_secret_and_server_payloads(self):
        for name, data in [('config.env', 'x'), ('assets/a.js', 'SUPABASE_SERVICE_ROLE_KEY=x'),
                           ('assets/b.json', '{"DATABASE_URL":"postgres://x"}'), ('a.map', '{}'),
                           ('a.node', 'x'), ('fonts/a.otf', 'x'), ('server.js', 'x'),
                           ('assets/c.js', 'const t="sb_secret_' + 'x' * 32 + '"')]:
            with self.subTest(name=name):
                path = self.dist('secret-' + str(len(list(self.root.glob('input-*')))))
                target = path / name
                target.parent.mkdir(exist_ok=True)
                target.write_text(data)
                with self.assertRaises(ValueError):
                    self.m.pack(path, self.root / 'bad.tgz', self.options, self.public)

    def test_subject_accepts_the_emacs_lisp_symbol_without_treating_its_suffix_as_a_key(self):
        for symbol in ['ask-user-about-supersession-threat', 'userlock--ask-user-about-supersession-threat']:
            with self.subTest(symbol=symbol):
                dist = self.dist('symbol-' + str(len(list(self.root.glob('input-*')))), script='export const symbol=' + json.dumps(symbol) + ';')
                try:
                    files, _, subject = self.m.candidate_files(dist, self.public)
                except ValueError as error:
                    self.fail('Benign language identifier was rejected as a credential: ' + str(error))
                self.assertIn('assets/main.js', files)
                self.assertEqual(subject['schemaVersion'], 1)

    def test_subject_does_not_exempt_unknown_prefixes_or_suffixes_of_language_identifiers(self):
        for symbol in ['prefix-ask-user-about-supersession-threat', 'prefix-userlock--ask-user-about-supersession-threat', 'ask-user-about-supersession-threat-extra']:
            with self.subTest(symbol=symbol):
                dist = self.dist('unknown-symbol-' + str(len(list(self.root.glob('input-*')))), script='export const value=' + json.dumps(symbol) + ';')
                with self.assertRaisesRegex(ValueError, 'secret/server'):
                    self.m.candidate_files(dist, self.public)

    def test_subject_still_rejects_api_key_tokens_at_value_boundaries(self):
        for prefix in ['sk-', 'sk-proj-', 'sk-svcacct-']:
            for context in ['{}', 'Bearer {}', 'token={}', 'key:{}', '({})', 'https://example.test/?token={}', 'a{}', 'prefix_{}', '9{}']:
                with self.subTest(prefix=prefix, context=context):
                    value = context.format(prefix + 'x' * 32)
                    dist = self.dist('key-' + str(len(list(self.root.glob('input-*')))), script='export const value=' + json.dumps(value) + ';')
                    with self.assertRaisesRegex(ValueError, 'secret/server'):
                        self.m.candidate_files(dist, self.public)

    def test_language_symbol_does_not_exempt_another_key_in_the_same_payload(self):
        dist = self.dist(script='export const symbol="ask-user-about-supersession-threat";export const key="sk-proj-' + 'x' * 32 + '";')
        with self.assertRaisesRegex(ValueError, 'secret/server'):
            self.m.candidate_files(dist, self.public)

    def test_language_symbol_does_not_exempt_an_unversioned_catalogue_resource(self):
        dist = self.dist(script='export const symbol="ask-user-about-supersession-threat";export const image="/commerce/example.webp";')
        (dist / 'commerce').mkdir()
        (dist / 'commerce/example.webp').write_bytes(b'image')
        with self.assertRaisesRegex(ValueError, 'Unversioned or foreign namespace'):
            self.m.candidate_files(dist, self.public)

    def test_pack_rejects_links_case_collisions_and_hidden_files(self):
        for kind in ['symlink', 'hardlink', 'case', 'hidden']:
            with self.subTest(kind=kind):
                path = self.dist('links-' + kind)
                if kind == 'symlink': os.symlink(path / 'index.html', path / 'alias.html')
                if kind == 'hardlink': os.link(path / 'index.html', path / 'alias.html')
                if kind == 'case':
                    (path / 'INDEX.html').write_text('x')
                    if os.path.samefile(path / 'index.html', path / 'INDEX.html'):
                        # A case-insensitive host cannot hold this pack input.
                        # The archive test exercises both names on every OS.
                        continue
                if kind == 'hidden': (path / '.env').write_text('x')
                with self.assertRaises(ValueError):
                    self.m.pack(path, self.root / 'bad.tgz', self.options, self.public)

    def test_public_configuration_allowlist_and_registration_fail_closed(self):
        for config in [dict(self.public, secret='x'), dict(self.public, schemaVersion=2), dict(self.public, registrationEnabled=True)]:
            with self.assertRaises(ValueError):
                self.m.pack(self.dist('cfg-' + str(len(list(self.root.glob('input-*'))))), self.root / 'bad.tgz', self.options, config)

    def test_formal_pack_rejects_legacy_auth_mode_even_with_bound_evidence(self):
        self.public = dict(self.public, formalAuth=False)
        dist = self.dist()
        # The generic public DTO and subject-only QA remain able to represent
        # legacy mode; a formal static rollout is the narrower policy gate.
        self.m.public_config(self.public)
        self.m.candidate_files(dist, self.public)
        with self.assertRaisesRegex(ValueError, 'formal|static|authentication'):
            self.m.pack(dist, self.root / 'legacy.tgz', self.options, self.public, self.evidence(dist))
        self.assertFalse((self.root / 'legacy.tgz').exists())

    def runtime_http(self, config, *, status=200, mime='application/json'):
        calls = []
        def fetch(url, limit=None, **kwargs):
            calls.append(url)
            headers = Message()
            headers['Content-Type'] = 'application/json'
            if url == 'http://127.0.0.1:3100/api/meta':
                return self.m.canonical(self.meta), headers
            self.assertEqual(url, 'http://127.0.0.1:3100/api/public-config')
            if status != 200:
                raise self.r.urllib.error.HTTPError(url, status, 'Fixture unavailable', headers, None)
            headers.replace_header('Content-Type', mime)
            return config if isinstance(config, bytes) else self.m.canonical(config), headers
        return fetch, calls

    def test_live_static_mode_failure_keeps_exact_current_and_candidate_private(self):
        self.deploy(self.pack())
        self.adapter.meta = self.r.production_meta
        cases = [
            ('legacy', dict(self.public, formalAuth=False), 200, 'application/json'),
            ('unavailable', self.public, 503, 'application/json'),
            ('malformed', b'{"schemaVersion":', 200, 'application/json'),
            ('extra', dict(self.public, undeclared=True), 200, 'application/json'),
            ('schema', dict(self.public, schemaVersion=2), 200, 'application/json'),
            ('mock', dict(self.public, dataMode='mock'), 200, 'application/json'),
            ('mime', self.public, 200, 'text/html'),
        ]
        for name, config, status, mime in cases:
            namespace = 'guard-' + name
            report = self.pack(namespace)
            fetch, calls = self.runtime_http(config, status=status, mime=mime)
            with self.subTest(case=name), patch.object(self.r, 'http_read', side_effect=fetch):
                with self.assertRaises((ValueError, self.r.urllib.error.HTTPError)):
                    self.deploy(report, 'op-' + name, 'web-A')
                self.assertEqual(self.adapter.current(), 'web-A')
                self.assertFalse(os.path.lexists(self.server / 'frontend/assets' / namespace))
                self.assertTrue((self.server / 'frontend/assets/web-A/assets/lazy.js').is_file())
                self.assertIn('http://127.0.0.1:3100/api/public-config', calls)

    def test_live_formal_http_mode_allows_dynamic_legal_and_captcha_changes(self):
        report = self.pack()
        config = dict(self.public, approvedLegalVersion='approved-runtime-v2', captchaSiteKey='public-runtime-site-key', registrationEnabled=True)
        fetch, calls = self.runtime_http(config)
        self.adapter.meta = self.r.production_meta
        with patch.object(self.r, 'http_read', side_effect=fetch):
            self.assertEqual(self.r.production_meta(), self.meta)
            self.assertIn('http://127.0.0.1:3100/api/public-config', calls)
            self.assertEqual(self.deploy(report)['state'], 'committed')

    def test_verify_rejects_extra_file_and_wrong_index_checksum(self):
        report = self.pack()
        for kind in ['extra', 'index']:
            dest = self.root / kind
            self.m.unpack(Path(report['archive']), dest, report['manifestSha256'])
            if kind == 'extra': (dest / 'extra.txt').write_text('x')
            else: (dest / '.release/file-index.json').write_text('{}')
            with self.assertRaises(ValueError): self.m.verify(dest)

    def test_archive_rejects_traversal_links_duplicates_and_expansion(self):
        for kind in ['traversal', 'symlink', 'hardlink', 'duplicate', 'case', 'large']:
            with self.subTest(kind=kind):
                archive = self.root / ('bad-' + kind + '.tgz')
                with tarfile.open(archive, 'w:gz') as tar:
                    item = tarfile.TarInfo('../escape' if kind == 'traversal' else 'index.html')
                    if kind == 'symlink': item.type, item.linkname = tarfile.SYMTYPE, '/etc/passwd'
                    if kind == 'hardlink': item.type, item.linkname = tarfile.LNKTYPE, 'index.html'
                    item.size = 100 if kind == 'large' else 1
                    tar.addfile(item, io.BytesIO(b'x' * item.size))
                    if kind == 'duplicate': tar.addfile(item, io.BytesIO(b'x'))
                    if kind == 'case':
                        item.name = 'INDEX.html'
                        tar.addfile(item, io.BytesIO(b'x'))
                with self.assertRaises(ValueError):
                    self.m.unpack(archive, self.root / ('extract-' + kind), '0' * 64, max_bytes=50)
        self.assertFalse((self.root / 'escape').exists())

    def test_archive_input_symlink_and_hardlink_are_rejected(self):
        report = self.pack()
        for kind in ['symlink', 'hardlink']:
            archive = self.root / (kind + '.tgz')
            if kind == 'symlink': os.symlink(report['archive'], archive)
            else: os.link(report['archive'], archive)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.m.unpack(archive, self.root / ('link-input-' + kind), report['manifestSha256'])
            archive.unlink()

    def test_actual_http_probe_checks_namespace_mime_hash_cache_and_missing_chunk(self):
        report = self.pack()
        self.deploy(report)
        root, meta = self.server, self.meta
        state = {'badVersion': False, 'badApi': False}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                status, body, mime, cache = 200, b'', 'application/json', 'no-store'
                if self.path == '/api/meta': body = json.dumps(dict(meta, secret='x') if state['badApi'] else meta).encode()
                elif self.path == '/version.json': body = json.dumps({'schemaVersion': 1, 'frontendRelease': 'wrong' if state['badVersion'] else 'web-A'}).encode()
                elif self.path == '/':
                    body, mime = (root / 'frontend/current/index.html').read_bytes(), 'text/html'
                elif self.path.startswith('/frontend-assets/web-A/'):
                    path = root / 'frontend/assets/web-A' / self.path.removeprefix('/frontend-assets/web-A/')
                    if path.is_file(): body, mime, cache = path.read_bytes(), 'text/javascript', 'public,max-age=31536000,immutable'
                    else: status = 404
                elif self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/api/meta')
                    self.end_headers()
                    return
                else: status = 404
                self.send_response(status)
                self.send_header('Content-Type', mime)
                self.send_header('Cache-Control', cache)
                self.end_headers()
                self.wfile.write(body)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = 'http://127.0.0.1:' + str(server.server_port)
        try:
            with patch.object(self.r, 'ORIGIN', origin), patch.object(self.r, 'ROOT', root):
                self.assertTrue(self.r.production_probe('web-A', 'backend-A'))
                state['badVersion'] = True
                self.assertFalse(self.r.production_probe('web-A', 'backend-A'))
                state['badVersion'], state['badApi'] = False, True
                with self.assertRaises(ValueError): self.r.production_probe('web-A', 'backend-A')
                with self.assertRaisesRegex(ValueError, 'redirect'): self.r.http_read(origin + '/redirect')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_wrong_outer_digest_and_partial_upload_leave_current_unchanged(self):
        report = self.pack()
        target = self.upload(report)
        for data in [target.read_bytes()[:-8], b'not-an-archive']:
            target.write_bytes(data)
            with self.assertRaises(ValueError):
                self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
            self.assertIsNone(self.adapter.current())

    def test_incoming_symlink_and_hardlink_are_not_trusted(self):
        report = self.pack()
        target = self.upload(report)
        target.unlink()
        os.symlink(report['archive'], target)
        with self.assertRaises((OSError, ValueError)):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        target.unlink()
        os.link(report['archive'], target)
        with self.assertRaises(ValueError):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)

    def test_incoming_replacement_after_open_is_rejected(self):
        report = self.pack()
        target = self.upload(report)
        def replace():
            replacement = target.with_suffix('.replacement')
            replacement.write_bytes(b'evil')
            os.replace(replacement, target)
        self.adapter.after_incoming_open = replace
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        self.assertIsNone(self.adapter.current())

    def test_inplace_incoming_mutation_during_copy_is_rejected(self):
        report = self.pack()
        target = self.upload(report)
        self.adapter.after_incoming_open = lambda: target.write_bytes(b'evil')
        with self.assertRaises(ValueError):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        self.assertIsNone(self.adapter.current())

    def test_disk_space_preflight_prevents_switch(self):
        report = self.pack()
        self.upload(report)
        self.adapter.free_bytes = lambda: 0
        with self.assertRaisesRegex(ValueError, 'space'):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        self.assertIsNone(self.adapter.current())

    def test_meta_rejects_missing_unknown_incompatible_and_unverified_backend(self):
        for change in [None, {}, dict(self.meta, secret='x'), dict(self.meta, backendRelease='unknown'),
                       dict(self.meta, api={'major': 2, 'minor': 9}), dict(self.meta, capabilities=[])]:
            with self.subTest(meta=change):
                self.meta = change
                report = self.pack('meta-' + str(len(list(self.root.glob('input-*')))))
                with self.assertRaises(ValueError): self.deploy(report, report['assetNamespace'])
                self.assertIsNone(self.adapter.current())
                self.assertFalse(os.path.lexists(self.server / 'frontend/assets' / report['assetNamespace']))

    def test_current_compare_and_swap_rejects_stale_caller(self):
        a, b = self.pack(), self.pack('web-B')
        self.deploy(a)
        with self.assertRaisesRegex(ValueError, 'current'):
            self.deploy(b, 'op-B', None)
        self.assertEqual(self.adapter.current(), 'web-A')

    def test_same_namespace_different_bytes_never_overwrites_sealed_files(self):
        a = self.pack()
        self.deploy(a)
        first = self.server / 'frontend/releases/web-A/assets/main.js'
        original = first.read_bytes()
        shutil.rmtree(self.root / 'input-web-A')
        (self.root / 'web-A.tgz').unlink()
        b = self.pack(script='export const result=999;')
        with self.assertRaisesRegex(ValueError, 'namespace|immutable'):
            self.deploy(b, 'op-B', 'web-A')
        self.assertEqual(first.read_bytes(), original)

    def test_sealed_retry_is_idempotent_and_modes_are_readonly(self):
        report = self.pack()
        result = self.deploy(report)
        self.assertEqual(self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None), result)
        self.assertFalse((self.server / 'frontend/releases/web-A/index.html').stat().st_mode & 0o222)
        self.assertEqual(self.deploy(report, 'op-B', 'web-A')['state'], 'committed')

    def test_crash_after_seal_can_resume_without_mutating_sealed_release(self):
        report = self.pack()
        self.upload(report)
        def crash(phase):
            if phase == 'sealed': raise KeyboardInterrupt('crash')
        self.adapter.checkpoint = crash
        with self.assertRaises(KeyboardInterrupt):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        inode = (self.server / 'frontend/releases/web-A/index.html').stat().st_ino
        self.adapter.checkpoint = lambda phase: None
        result = self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        self.assertEqual(result['state'], 'committed')
        self.assertEqual((self.server / 'frontend/releases/web-A/index.html').stat().st_ino, inode)

    def test_failed_check_recovers_exact_captured_version_once(self):
        a, b = self.pack(), self.pack('web-B')
        self.deploy(a)
        self.adapter.probe = lambda namespace, backend: namespace != 'web-B'
        result = self.deploy(b, 'op-B', 'web-A')
        self.assertEqual(result['state'], 'recovered')
        self.assertFalse(result['success'])
        self.assertEqual(result['rollbackTarget'], 'web-A')
        self.assertEqual(self.adapter.current(), 'web-A')

    def test_recovery_failure_records_needs_attention_without_retry_loop(self):
        a, b = self.pack(), self.pack('web-B')
        self.deploy(a)
        count = []
        def probe(namespace, backend):
            count.append(namespace)
            return len(count) == 1
        self.adapter.probe = probe
        result = self.deploy(b, 'op-B', 'web-A')
        self.assertEqual(result['state'], 'needs_attention')
        self.assertEqual(self.adapter.current(), 'web-A')
        self.assertEqual(count, ['web-A', 'web-B', 'web-A'])

    def test_post_switch_current_drift_does_not_overwrite_other_operator(self):
        a, b, c = self.pack(), self.pack('web-B'), self.pack('web-C')
        self.deploy(a)
        self.deploy(c, 'op-C', 'web-A')
        self.adapter.rollback('undo-C', 'web-C', 'web-A')
        def probe(namespace, backend):
            if namespace == 'web-B':
                self.adapter.atomic_pointer('current', 'web-C')
                return False
            return True
        self.adapter.probe = probe
        result = self.deploy(b, 'op-B', 'web-A')
        self.assertEqual(result['state'], 'needs_attention')
        self.assertEqual(self.adapter.current(), 'web-C')

    def test_bad_baseline_does_not_activate(self):
        a = self.pack()
        self.adapter.probe = lambda namespace, backend: False
        with self.assertRaisesRegex(ValueError, 'baseline'): self.deploy(a)
        self.assertIsNone(self.adapter.current())
        self.assertFalse(os.path.lexists(self.server / 'frontend/assets/web-A'))

    def test_stale_crashed_operation_cannot_recover_after_later_generation(self):
        a, b, c = self.pack(), self.pack('web-B'), self.pack('web-C')
        self.deploy(a)
        self.upload(b, 'op-B')
        def crash(phase):
            if phase == 'after_switch': raise KeyboardInterrupt('crash')
        self.adapter.checkpoint = crash
        with self.assertRaises(KeyboardInterrupt):
            self.adapter.deploy('op-B', 'web-B', b['archiveSha256'], b['manifestSha256'], 'web-A')
        self.adapter.checkpoint = lambda phase: None
        self.deploy(c, 'op-C', 'web-B')
        self.adapter.rollback('undo-C', 'web-C', 'web-B')
        self.adapter.probe = lambda namespace, backend: namespace != 'web-B'
        result = self.adapter.deploy('op-B', 'web-B', b['archiveSha256'], b['manifestSha256'], 'web-A')
        self.assertEqual(result['state'], 'needs_attention')
        self.assertEqual(self.adapter.current(), 'web-B')

    def test_missing_trusted_acceptance_never_activates_candidate(self):
        report = self.pack()
        self.adapter.approval = lambda manifest, manifest_sha: False
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            self.deploy(report)
        self.assertIsNone(self.adapter.current())
        self.assertFalse(os.path.lexists(self.server / 'frontend/assets/web-A'))
        # A private sealed candidate is not public authorization on retry.
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            self.adapter.deploy('op-A', 'web-A', report['archiveSha256'], report['manifestSha256'], None)
        self.assertFalse(os.path.lexists(self.server / 'frontend/assets/web-A'))

    def test_rollback_requires_compatible_retained_target(self):
        a, b = self.pack(), self.pack('web-B')
        self.deploy(a)
        self.deploy(b, 'op-B', 'web-A')
        self.meta = dict(self.meta, backendRelease='backend-B')
        with self.assertRaises(ValueError): self.adapter.rollback('undo-B', 'web-B', 'web-A')
        self.assertEqual(self.adapter.current(), 'web-B')

    def test_operation_id_and_pointer_paths_reject_traversal(self):
        report = self.pack()
        for operation, namespace in [('../x', 'web-A'), ('op-A', '../x'), ('op/A', 'web-A')]:
            with self.assertRaises(ValueError):
                self.adapter.deploy(operation, namespace, report['archiveSha256'], report['manifestSha256'], None)


if __name__ == '__main__':
    unittest.main()
