import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const buildRoot = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

// Opt-in production webpack profile for the application's fixed Markdown flags.
// Keep defaults/development and the full client Shiki implementation unchanged.
export function createMarkdownBuildProfile(webRoot, isServer) {
  const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
  const uiRoot = path.dirname(path.dirname(requireFromWeb.resolve('@lobehub/ui')));
  const requireFromUI = createRequire(path.join(uiRoot, 'package.json'));
  for (const [actual, expected] of [
    [readJson(path.join(uiRoot, 'package.json')).version, '5.30.0'],
    [readJson(requireFromWeb.resolve('next/package.json')).version, '16.4.1'],
    [readJson(requireFromUI.resolve('shiki/package.json')).version, '4.4.3'],
  ]) {
    if (actual !== expected) throw new Error('Markdown build profile requires renewed dependency audit');
  }
  const disabled = path.join(buildRoot, 'disabled-markdown-branch.mjs');
  const aliases = Object.fromEntries([
    ['rehype-github-alerts', disabled],
    ['rehype-katex', disabled],
    ['remark-math', disabled],
    ['rehype-raw', disabled],
    ...['Mermaid/Mermaid.mjs', 'HtmlPreview/HtmlPreview.mjs',
      'Highlighter/FullFeatured.mjs', 'hooks/useMarkdown/latex.mjs']
      .map(file => [path.join(uiRoot, 'es', file), disabled]),
    ...(isServer ? [['shiki', path.join(buildRoot, 'shiki-server-metadata.mjs')]] : []),
  ]);
  return {
    aliases,
    replacementFor(request, context) {
      const candidate = request.startsWith('.') ? path.resolve(context, request) : request;
      return Object.hasOwn(aliases, candidate) ? aliases[candidate] : undefined;
    },
  };
}
