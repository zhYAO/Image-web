import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
const uiRoot = path.dirname(path.dirname(requireFromWeb.resolve('@lobehub/ui')));
const requireFromUI = createRequire(path.join(uiRoot, 'package.json'));
const profileModule = new URL('../build/markdown-profile.mjs', import.meta.url);

test('real static and streamed SSR markup stays byte-identical with server replacements', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./markdown-profile-ssr.mjs', import.meta.url)), webRoot], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cases, 8);
  assert.equal(report.SSR_markup_equal, true);
  assert.ok(report.replacements > 0);
});

test('server metadata preserves every installed language, alias and theme while client keeps original Shiki', async () => {
  const { createMarkdownBuildProfile } = await import(profileModule);
  const server = createMarkdownBuildProfile(webRoot, true);
  const client = createMarkdownBuildProfile(webRoot, false);
  assert.equal(client.replacementFor('shiki', uiRoot), undefined);
  const original = await import(pathToFileURL(requireFromUI.resolve('shiki')));
  const metadata = await import(pathToFileURL(server.replacementFor('shiki', uiRoot)));
  const serializable = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(metadata.bundledLanguagesInfo, serializable(original.bundledLanguagesInfo));
  assert.deepEqual(metadata.bundledThemesInfo, serializable(original.bundledThemesInfo));
  assert.equal(metadata.bundledLanguagesInfo.length, 242);
  assert.throws(() => metadata.codeToHtml('x', { lang: 'python' }), /server/);
  assert.throws(() => metadata.getSingletonHighlighter(), /server/);
});

test('only exact disabled branches are replaced, preserving code highlighter and unrelated module requests', async () => {
  const { createMarkdownBuildProfile } = await import(profileModule);
  const profile = createMarkdownBuildProfile(webRoot, false);
  const context = path.join(uiRoot, 'es/mdx/mdxComponents');
  const replacement = profile.replacementFor('../../Mermaid/Mermaid.mjs', context);
  assert.ok(replacement);
  const disabled = await import(pathToFileURL(replacement));
  assert.throws(() => disabled.default(), /disabled/);
  assert.throws(() => disabled.rehypeGithubAlerts(), /disabled/);
  assert.throws(() => disabled.HighlighterFullFeatured(), /disabled/);
  assert.equal(profile.replacementFor('../../Highlighter/Highlighter.mjs', context), undefined);
  for (const request of ['shiki/langs', 'shiki/wasm', 'rehype-raw-extra', './Mermaid.mjs'])
    assert.equal(profile.replacementFor(request, '/unrelated'), undefined);
  const latex = await import(pathToFileURL(profile.replacementFor('./latex.mjs', path.join(uiRoot, 'es/hooks/useMarkdown'))));
  assert.throws(() => latex.preprocessLaTeX('x'), /disabled/);
  assert.throws(() => latex.isLastFormulaRenderable('x'), /disabled/);
});
