"""Offline business-code boundary tests; never install, network or start services."""
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('business-transfer.py')
SHA = '1' * 40
HOST = {'node': '24.19.0', 'abi': '137', 'napi': '10', 'platform': 'darwin', 'arch': 'x64', 'libc': None}


def digest(body):
    return hashlib.sha256(body).hexdigest()


class BusinessTransferTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'business-only export/verify tool is not implemented')
        spec = importlib.util.spec_from_file_location('business_transfer_test', SCRIPT)
        self.tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.tool)
        temp = tempfile.TemporaryDirectory(prefix='business-transfer-test-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.source = self.root / 'source'
        self.dist = self.source / 'apps/web/.next'
        self.standalone = self.dist / 'standalone'
        self.out = self.root / 'export'
        self.source.mkdir()
        for name, data in {
            'package.json': {'packageManager': 'pnpm@11.19.0'},
            'apps/web/package.json': {'name': '@zimage/web', 'dependencies': {'next': '16.4.1', 'sharp': '0.35.5'}},
            'packages/domain/package.json': {'name': '@zimage/domain', 'exports': {'.': './src/index.ts'}},
        }.items():
            self.put(self.source / name, json.dumps(data))
        self.put(self.source / 'pnpm-lock.yaml', 'lockfileVersion: 9\n')
        self.put(self.source / 'pnpm-workspace.yaml', 'packages: [apps/*, packages/*]\n')
        self.put(self.source / 'apps/web/next.config.ts', 'export default {};\n')
        self.put(self.source / 'apps/web/build/static-assets-config.mjs', 'export const fixture = true;\n')
        entries = []
        for p in sorted(self.source.rglob('*')):
            if p.is_file():
                entries.append({'path': p.relative_to(self.source).as_posix(), 'bytes': p.stat().st_size,
                                'sha256': digest(p.read_bytes()), 'mode': 0o644})
        self.source_manifest = self.root / 'source-manifest.json'
        fp = self.tool.handoff.fingerprint(entries)
        self.source_manifest.write_text(json.dumps({'schema': 1, 'baseCommit': SHA, 'sourceState': 'clean',
            'formalBuildEligible': True, 'fileCount': len(entries), 'fingerprintSha256': fp, 'files': entries}))
        self.config = {'distDir': '.next', 'output': 'standalone', 'env': {'ZIMAGE_BUILD_SHA': SHA},
            'transpilePackages': ['@zimage/domain'], 'outputFileTracingRoot': str(self.source),
            'outputFileTracingExcludes': {'next-server': ['**/setup-dev-bundler.js']}, 'experimental': {}}
        self.put(self.dist / 'required-server-files.json', json.dumps({'config': self.config}))
        self.put(self.standalone / 'apps/web/.next/required-server-files.json', json.dumps({'config': self.config}))
        self.put(self.standalone / 'apps/web/.next/BUILD_ID', SHA)
        self.put(self.standalone / 'apps/web/.next/server/app/api/meta/route.js', 'module.exports = {};\n')
        self.put(self.dist / 'static/chunks/app.js', 'console.log("fixture");\n')
        server_config = dict(self.config, distDir='./.next')
        self.put(self.standalone / 'apps/web/server.js', 'const nextConfig = ' + json.dumps(server_config)
                 + '\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)\n')
        for name in ['package.json', 'apps/web/package.json', 'packages/domain/package.json']:
            self.put(self.standalone / name, (self.source / name).read_bytes())
        self.receipt = self.root / 'build-result.json'
        self.receipt.write_text(json.dumps({'schema': 1, 'commit': SHA, 'sourceFingerprintSha256': fp,
            'sourceFilesVerifiedAfterBuild': len(entries), 'sourceArchiveVerified': True,
            'lockSha256': digest((self.source / 'pnpm-lock.yaml').read_bytes()), 'publicConfigSha256': '2' * 64,
            'staticAssetSha256': '3' * 64, 'BUILD_ID': SHA, 'buildPlatform': 'darwin-x64', 'runtimeAbi': '137',
            'toolchain': {'node': '24.19.0', 'pnpm': '11.19.0'}, 'secretsInjected': False,
            'serverStarted': False, 'packagerCalled': False, 'productionReady': False, 'linuxRunnable': False,
            'timings': [{'step': 'install', 'exitCode': 0}, {'step': 'next-build', 'exitCode': 0}]}))
        self.refresh_compiled_receipt()

    def put(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode())
        path.chmod(0o644)

    def tree_fingerprint(self, root):
        entries = []
        for current, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [n for n in dirs if not n.startswith('.env')]
            for name in dirs + files:
                if name.startswith('.env'): continue
                p = Path(current) / name; relative = p.relative_to(root).as_posix()
                if p.is_symlink(): entries.append({'path': relative, 'kind': 'symlink', 'target': os.readlink(p)})
                elif p.is_file(): entries.append({'path': relative, 'kind': 'file', 'bytes': p.stat().st_size, 'sha256': digest(p.read_bytes()), 'mode': p.stat().st_mode & 0o777})
        return digest(json.dumps(sorted(entries, key=lambda e: e['path']), sort_keys=True, separators=(',', ':')).encode())

    def refresh_compiled_receipt(self):
        receipt = json.loads(self.receipt.read_text())
        receipt.update(actualDist=str(self.dist), sourceManifestSha256=digest(self.source_manifest.read_bytes()),
            standaloneTreeFingerprintSha256=self.tree_fingerprint(self.standalone),
            staticTreeFingerprintSha256=self.tree_fingerprint(self.dist / 'static'))
        self.receipt.write_text(json.dumps(receipt))

    def export(self):
        with patch.object(self.tool, 'node_identity', return_value=HOST):
            return self.tool.export_code(self.source, self.dist, self.source_manifest,
                digest(self.source_manifest.read_bytes()), self.receipt, digest(self.receipt.read_bytes()),
                SHA, Path('/unused/node'), self.out)

    def verify(self, result=None):
        result = result or self.export()
        return self.tool.verify_code(Path(result['archive']), Path(result['manifest']), result['manifestSha256'], SHA)

    def mutate_archive(self, result, transform):
        manifest = json.loads(Path(result['manifest']).read_text())
        with tarfile.open(result['archive'], 'r:gz') as tf:
            members = [(m.name, m.mode, tf.extractfile(m).read(), m.type, m.linkname) for m in tf]
        archive = self.root / 'mutated.tgz'
        with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode='w', format=tarfile.USTAR_FORMAT) as tf:
                for name, mode, body, kind, link in transform(members):
                    m = tarfile.TarInfo(name); m.mode = mode; m.size = len(body); m.type = kind; m.linkname = link
                    tf.addfile(m, io.BytesIO(body) if kind == tarfile.REGTYPE else None)
        manifest['archive'] = {'bytes': archive.stat().st_size, 'sha256': digest(archive.read_bytes())}
        target = self.root / 'mutated.json'; target.write_bytes(self.tool.canonical(manifest))
        return {'archive': str(archive), 'manifest': str(target), 'manifestSha256': digest(target.read_bytes())}

    def test_round_trip_preserves_config_and_omits_host_runtime_and_diagnostics(self):
        self.put(self.standalone / 'node_modules/darwin.node', b'\xcf\xfa\xed\xfehost')
        self.put(self.standalone / 'apps/web/.next/server/app/api/meta/route.js.nft.json', '{}')
        self.put(self.standalone / 'apps/web/.next/server/a.js.map', '{}')
        self.put(self.standalone / '.env.production', 'fixture: must not read or export')
        self.put(self.standalone / 'apps/web/public/logo.svg', '<svg/>')
        self.refresh_compiled_receipt()
        result = self.export(); verified = self.verify(result)
        names = [e['path'] for e in verified['manifest']['files']]
        self.assertEqual(verified['manifest']['buildHost'], HOST)
        self.assertFalse(verified['productionReady'])
        self.assertIn('apps/web/.next/static/chunks/app.js', names)
        self.assertTrue(all('node_modules' not in p and not p.endswith(('.map', '.nft.json')) for p in names))
        self.assertEqual(verified['manifest']['build']['dependencyResolution']['transpilePackages'], ['@zimage/domain'])
        self.assertEqual(verified['manifest']['build']['configSha256'], digest((self.dist / 'required-server-files.json').read_bytes()))

    def test_source_drift_cannot_be_relabelled(self):
        self.put(self.source / 'apps/web/next.config.ts', 'changed')
        with self.assertRaisesRegex(ValueError, 'Source'):
            self.export()
        self.assertFalse(self.out.exists())

    def test_frozen_source_can_include_original_public_images_without_exporting_them(self):
        name = 'apps/web/public/commerce/apparel-v2/source-detail.png'
        path = self.source / name; self.put(path, b'original source fixture')
        source = json.loads(self.source_manifest.read_text())
        source['files'].append({'path': name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes()), 'mode': 0o644})
        source['files'].sort(key=lambda e: e['path'])
        source['fileCount'] = len(source['files']); source['fingerprintSha256'] = self.tool.handoff.fingerprint(source['files'])
        self.source_manifest.write_text(json.dumps(source))
        receipt = json.loads(self.receipt.read_text())
        receipt.update(sourceFilesVerifiedAfterBuild=source['fileCount'], sourceFingerprintSha256=source['fingerprintSha256'])
        self.receipt.write_text(json.dumps(receipt))
        self.refresh_compiled_receipt()
        result = self.verify()
        self.assertNotIn(name, [e['path'] for e in result['manifest']['files']])

    def test_stale_build_marker_and_serialized_config_mismatch_fail(self):
        for mutation in ['build-id', 'serialized-config']:
            with self.subTest(mutation=mutation):
                p = self.standalone / ('apps/web/.next/BUILD_ID' if mutation == 'build-id' else 'apps/web/server.js')
                before = p.read_bytes()
                self.put(p, '0' * 40 if mutation == 'build-id' else 'const nextConfig = {}\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG = ""')
                with self.assertRaises(ValueError): self.export()
                self.assertFalse(self.out.exists()); self.put(p, before)

    def test_forbidden_native_headers_and_names_are_rejected_in_business_paths(self):
        for name, body in [('app.node', b'ordinary'), ('app.js', b'\x7fELFfixture'),
                           ('app.js', b'\xcf\xfa\xed\xfehost'), ('app.js', b'MZfixture')]:
            with self.subTest(name=name, body=body):
                p = self.standalone / 'apps/web/.next/server' / name; self.put(p, body)
                with self.assertRaisesRegex(ValueError, 'Native'): self.export()
                self.assertFalse(self.out.exists()); p.unlink()

    def test_business_symlink_and_unknown_source_paths_fail(self):
        p = self.standalone / 'apps/web/.next/server/out.js'
        p.symlink_to(self.source / 'package.json')
        with self.assertRaisesRegex(ValueError, 'link'): self.export()
        p.unlink(); self.put(self.standalone / 'apps/web/unknown.py', 'print(1)')
        with self.assertRaisesRegex(ValueError, 'Business path'): self.export()

    def test_duplicate_json_key_is_rejected(self):
        self.receipt.write_text('{"schema":1,"schema":1}')
        with self.assertRaisesRegex(ValueError, 'Duplicate'): self.export()

    def test_nonfinite_json_and_control_characters_in_paths_are_rejected(self):
        self.receipt.write_text(self.receipt.read_text()[:-1] + ',"unexpected":NaN}')
        with self.assertRaisesRegex(ValueError, 'JSON'): self.export()
        with self.assertRaisesRegex(ValueError, 'path'):
            self.tool.business_path('apps/web/.next/server/new\nline.js')

    def test_legitimate_public_route_is_preserved(self):
        self.put(self.standalone / 'apps/web/.next/server/app/public/page.js', 'module.exports = {};')
        self.refresh_compiled_receipt()
        verified = self.verify()
        self.assertIn('apps/web/.next/server/app/public/page.js', [e['path'] for e in verified['manifest']['files']])

    def test_hidden_concatenated_tar_members_are_rejected(self):
        result = self.export()
        path = Path(result['archive'])
        decompressed = gzip.decompress(path.read_bytes())
        with io.BytesIO() as extra:
            with tarfile.open(fileobj=extra, mode='w') as tf:
                member = tarfile.TarInfo('hidden'); member.size = 1; tf.addfile(member, io.BytesIO(b'x'))
            path.write_bytes(gzip.compress(decompressed + extra.getvalue()))
        manifest = json.loads(Path(result['manifest']).read_text())
        manifest['archive'] = {'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())}
        Path(result['manifest']).write_bytes(self.tool.canonical(manifest))
        result['manifestSha256'] = digest(Path(result['manifest']).read_bytes())
        with self.assertRaisesRegex(ValueError, 'after business tar'): self.verify(result)

    def test_successful_receipt_does_not_authorize_later_compiled_or_static_changes(self):
        for p in [self.standalone / 'apps/web/.next/server/app/api/meta/route.js', self.dist / 'static/chunks/app.js']:
            with self.subTest(path=str(p)):
                before = p.read_bytes(); self.put(p, 'changed after successful build receipt')
                with self.assertRaisesRegex(ValueError, 'compiled.*fingerprint'): self.export()
                self.assertFalse(self.out.exists()); self.put(p, before)

    def test_raw_tar_rejects_transparent_gnu_and_pax_metadata_headers(self):
        result = self.export()
        manifest = json.loads(Path(result['manifest']).read_text())
        original = gzip.decompress(Path(result['archive']).read_bytes())
        for kind in [tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK, tarfile.XHDTYPE, tarfile.XGLTYPE]:
            with self.subTest(kind=kind):
                header = tarfile.TarInfo('././@LongLink'); header.type = kind
                hidden = manifest['files'][0]['path'].encode() + b'\0\xcf\xfa\xed\xfehidden-native'
                if kind in (tarfile.XHDTYPE, tarfile.XGLTYPE): hidden = b''
                header.size = len(hidden)
                raw = header.tobuf(format=tarfile.GNU_FORMAT) + hidden + b'\0' * ((-len(hidden)) % 512) + original
                path = self.root / 'metadata.tgz'; path.write_bytes(gzip.compress(raw))
                data = dict(manifest, archive={'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())})
                meta = self.root / 'metadata.json'; meta.write_bytes(self.tool.canonical(data))
                with self.assertRaisesRegex(ValueError, 'USTAR|metadata'):
                    self.tool.verify_code(path, meta, digest(meta.read_bytes()), SHA)

    def test_raw_tar_rejects_nonzero_member_padding_and_missing_double_eof(self):
        result = self.export()
        manifest = json.loads(Path(result['manifest']).read_text())
        original = gzip.decompress(Path(result['archive']).read_bytes())
        first_size = int(original[124:136].strip(b'\0 '), 8)
        padding_offset = 512 + first_size
        with self.subTest(problem='hidden member padding'):
            raw = bytearray(original); raw[padding_offset:padding_offset + 4] = b'\xcf\xfa\xed\xfe'
            path = self.root / 'padding.tgz'; path.write_bytes(gzip.compress(raw))
            data = dict(manifest, archive={'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())})
            meta = self.root / 'padding.json'; meta.write_bytes(self.tool.canonical(data))
            with self.assertRaisesRegex(ValueError, 'padding'):
                self.tool.verify_code(path, meta, digest(meta.read_bytes()), SHA)
        with self.subTest(problem='missing second end block'):
            offset = 0
            while any(original[offset:offset + 512]):
                size = int(original[offset + 124:offset + 136].strip(b'\0 ') or b'0', 8)
                offset += 512 + (size + 511) // 512 * 512
            raw = original[:offset + 512]
            path = self.root / 'eof.tgz'; path.write_bytes(gzip.compress(raw))
            data = dict(manifest, archive={'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())})
            meta = self.root / 'eof.json'; meta.write_bytes(self.tool.canonical(data))
            with self.assertRaisesRegex(ValueError, 'end marker'):
                self.tool.verify_code(path, meta, digest(meta.read_bytes()), SHA)
        with self.subTest(problem='hidden header padding'):
            raw = bytearray(original)
            offset = raw[:100].index(0) + 1
            raw[offset:offset + 4] = b'\xcf\xfa\xed\xfe'
            raw[148:156] = b'        '
            raw[148:156] = ('%06o\0 ' % sum(raw[:512])).encode()
            path = self.root / 'header.tgz'; path.write_bytes(gzip.compress(raw))
            data = dict(manifest, archive={'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())})
            meta = self.root / 'header.json'; meta.write_bytes(self.tool.canonical(data))
            with self.assertRaisesRegex(ValueError, 'header'):
                self.tool.verify_code(path, meta, digest(meta.read_bytes()), SHA)

    def test_invalid_build_receipt_stops_before_outputs(self):
        data = json.loads(self.receipt.read_text()); data['timings'][1]['exitCode'] = 1
        self.receipt.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'build receipt'): self.export()
        self.assertFalse(self.out.exists())

    def test_verify_rejects_wrong_manifest_hash_without_mutation(self):
        result = self.export()
        with self.assertRaisesRegex(ValueError, 'Manifest checksum'):
            self.tool.verify_code(Path(result['archive']), Path(result['manifest']), '0' * 64, SHA)

    def test_strict_tar_rejects_duplicate_escape_link_missing_and_extra_members(self):
        result = self.export()
        changes = {
            'duplicate': lambda m: m + [m[0]],
            'escape': lambda m: m + [('../escape.js', 0o644, b'x', tarfile.REGTYPE, '')],
            'symlink': lambda m: [(m[0][0], 0o644, b'', tarfile.SYMTYPE, '/outside')] + m[1:],
            'hardlink': lambda m: [(m[0][0], 0o644, b'', tarfile.LNKTYPE, m[1][0])] + m[1:],
            'missing': lambda m: m[1:],
            'extra': lambda m: m + [('apps/web/.next/server/extra.js', 0o644, b'x', tarfile.REGTYPE, '')],
            'changed-bytes': lambda m: [(m[0][0], m[0][1], b'changed', m[0][3], '')] + m[1:],
        }
        for name, transform in changes.items():
            with self.subTest(name=name):
                changed = self.mutate_archive(result, transform)
                with self.assertRaises(ValueError): self.verify(changed)
                Path(changed['archive']).unlink(); Path(changed['manifest']).unlink()

    def test_verify_checks_native_header_even_with_consistent_forged_hashes(self):
        result = self.export()
        changed = self.mutate_archive(result, lambda m: [(n, mode, b'\x7fELF'+b'X'*64 if n.endswith('route.js') else b, typ, link) for n, mode, b, typ, link in m])
        data = json.loads(Path(changed['manifest']).read_text())
        for entry in data['files']:
            if entry['path'].endswith('route.js'):
                entry.update(bytes=68, sha256=digest(b'\x7fELF'+b'X'*64))
        data['totalBytes'] = sum(e['bytes'] for e in data['files'])
        Path(changed['manifest']).write_bytes(self.tool.canonical(data))
        changed['manifestSha256'] = digest(Path(changed['manifest']).read_bytes())
        with self.assertRaisesRegex(ValueError, 'Native'): self.verify(changed)

    def test_export_never_overwrites_existing_destination(self):
        self.out.mkdir(); self.put(self.out / 'keep', 'unchanged')
        with self.assertRaises(ValueError): self.export()
        self.assertEqual((self.out / 'keep').read_text(), 'unchanged')


if __name__ == '__main__':
    unittest.main()
