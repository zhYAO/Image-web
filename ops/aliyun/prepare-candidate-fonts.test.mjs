import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprints, prepareCandidateFonts, revision } from './prepare-candidate-fonts.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));

test('explicit source is retained without downloading; packager remains its validator', async () => {
  const source = 'a literal directory/$(not-executed)';
  assert.equal(await prepareCandidateFonts({ source, download() { throw Error('Unexpected download'); } }), source);
});

test('fallback requires an absolute runner temporary directory', async () => {
  await assert.rejects(prepareCandidateFonts({ runnerTemp: 'relative', download() { throw Error('Unexpected download'); } }), /absolute RUNNER_TEMP/);
});

test('fallback refuses changed upstream bytes before creating license/provenance', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'zimage-font-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(prepareCandidateFonts({ runnerTemp: root, project, async download(url, output) {
    calls.push(url);
    await writeFile(output, 'synthetic invalid font');
  } }), /font SHA-256 mismatch/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `https://raw.githubusercontent.com/notofonts/noto-cjk/${revision}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`);
  const directories = await readdir(root);
  assert.deepEqual(await readdir(path.join(root, directories[0])), ['NotoSansCJKsc-Regular.otf']);
});

test('all four fingerprints agree with the unchanged downstream packaging policy', async () => {
  const packager = await readFile(new URL('./package-static-assets.mjs', import.meta.url), 'utf8');
  for (const [name, digest] of Object.entries(fingerprints)) {
    assert.ok(packager.includes(`'${name}': '${digest}'`), `Downstream fingerprint differs: ${name}`);
  }
  for (const name of ['LICENSE.txt', 'README.md']) {
    const normalized = (await readFile(path.join(project, 'doc/licenses/apparel-noto', name), 'utf8')).replace(/\r?\n/g, '\r\n');
    assert.equal(createHash('sha256').update(normalized).digest('hex'), fingerprints[name]);
  }
});

test('proven official OTF bytes produce exactly the four original files offline', { skip: !process.env.ZIMAGE_TEST_ORIGINAL_FONT_SOURCE }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'zimage-font-proof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const urls = [];
  const source = await prepareCandidateFonts({ runnerTemp: root, project, async download(url, output) {
    urls.push(url);
    await copyFile(path.join(process.env.ZIMAGE_TEST_ORIGINAL_FONT_SOURCE, path.basename(output)), output);
  } });
  assert.equal(urls.length, 2);
  assert.deepEqual((await readdir(source)).sort(), Object.keys(fingerprints).sort());
  for (const [name, digest] of Object.entries(fingerprints))
    assert.equal(createHash('sha256').update(await readFile(path.join(source, name))).digest('hex'), digest);
});
