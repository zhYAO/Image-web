// SSR equivalence fixture. Run with the web app directory as argv[2].
// This applies the same replacementFor through Node resolve hooks; it does not
// validate webpack emission, Next RSC/hydration, browser execution, or all grammars.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const webRoot = process.argv[2] || process.cwd();
const source = String.raw`
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
// Streamdown includes animation times in SSR markup. Fix both original clocks.
Object.defineProperty(performance, 'now', { value: () => 1000 });
Date.now = () => 1000;
const require = createRequire(path.join(process.cwd(), 'package.json'));
const uiRoot = path.dirname(path.dirname(require.resolve('@lobehub/ui')));
let replacements = 0;
if (process.env.REVIEW_SLIM === '1') {
  const { createMarkdownBuildProfile } = await import('./build/markdown-profile.mjs');
  const profile = createMarkdownBuildProfile(process.cwd(), true);
  registerHooks({ resolve(specifier, context, nextResolve) {
    const base = context.parentURL?.startsWith('file:')
      ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const replacement = profile.replacementFor(specifier, base);
    if (replacement) replacements++;
    return nextResolve(replacement ? pathToFileURL(replacement).href : specifier, context);
  } });
}
const { default: Markdown } = await import(pathToFileURL(path.join(uiRoot, 'es/Markdown/Markdown.mjs')));
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const fence = '\x60\x60\x60';
const cases = [
  '# 中文说明\n\n| 尺码 | 材质 |\n| --- | --- |\n| M | 棉 |\n\n> [!NOTE]\n> text\n\n$x+y$ [safe](https://example.com)',
  fence + 'mermaid\ngraph TD\nA-->B\n' + fence + '\n\n' + fence + 'html\n<html><script>window.bad=1</script></html>\n' + fence,
  fence + 'python\nprint("中文<script> & x")',
  fence + 'elisp\n(message "中文")\n' + fence,
];
const results = [];
for (const animated of [false, true]) for (const content of cases) {
  // Baseline omits precisely the two application flags newly added in this diff.
  const newFlags = process.env.REVIEW_SLIM === '1'
    ? { enableGithubAlert: false, fullFeaturedCodeBlock: false } : {};
  results.push(renderToStaticMarkup(createElement(Markdown, {
    allowHtml: false,
    animated,
    borderRadius: 10,
    componentProps: { a: { rel: 'noopener noreferrer' }, highlight: { copyable: true, showLanguage: true } },
    enableHtmlPreview: false,
    enableImageGallery: false,
    enableLatex: false,
    enableMermaid: false,
    enableStream: animated,
    fontSize: 15,
    lineHeight: 1.7,
    streamAnimationGranularity: 'word',
    streamSmoothingPreset: 'realtime',
    variant: 'chat',
    ...newFlags,
  }, content)));
}
console.log(JSON.stringify({ results, replacements }));
`;

function run(slim) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: webRoot,
    input: source,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', REVIEW_SLIM: slim ? '1' : '0' },
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
const baseline = run(false);
const candidate = run(true);
assert.equal(candidate.results.length, 8);
assert.ok(candidate.replacements > 0);
for (let index = 0; index < candidate.results.length; index++) {
  assert.equal(candidate.results[index], baseline.results[index], `SSR case ${index} changed`);
}
const serialized = JSON.stringify(candidate.results);
console.log(JSON.stringify({
  cases: candidate.results.length,
  SSR_markup_equal: true,
  replacements: candidate.replacements,
  sha256: createHash('sha256').update(serialized).digest('hex'),
  bytes: Buffer.byteLength(serialized),
}));
