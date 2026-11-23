import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserRoots = ['apps/frontend', 'apps/web/app', 'apps/web/components', 'apps/web/features', 'apps/web/gateways', 'apps/web/public', 'packages/domain'];
const files = execFileSync('git', ['ls-files', '-z', '--', ...browserRoots], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const sources = files.filter(name => /\.(?:[cm]?js|jsx|tsx?|css|html|svg|json)$/.test(name) && !/(?:^|\/)(?:tests|__tests__)\//.test(name) && !/\.test\./.test(name));

test('browser source declares no family, family utility, font loader or font preload', () => {
  assert.ok(sources.length > 100, 'Expected complete tracked browser source inventory');
  const prohibited = /font-family\s*[:=]|fontFamily\s*[:=]|--font\s*:|\bfont-(?:sans|serif|mono)\b|next\/font|@font-face|fonts\.(?:googleapis|gstatic)\.com|\bas\s*=\s*["']font["']/i;
  for (const name of sources) {
    assert.doesNotMatch(readFileSync(resolve(root, name), 'utf8'), prohibited, name);
  }
  assert.equal(files.filter(name => /\.(?:woff2?|otf|ttf|eot)$/i.test(name)).length, 0);
});

test('CSS avoids font shorthand that would also set family on native controls', () => {
  for (const name of sources.filter(name => extname(name) === '.css')) {
    assert.doesNotMatch(readFileSync(resolve(root, name), 'utf8'), /(?:^|[;{])\s*font\s*:/m, name);
  }
});

test('text sizing, weight and code whitespace remain independent of family', () => {
  const css = readFileSync(resolve(root, 'apps/web/app/globals.css'), 'utf8');
  assert.match(css, /font-size:\s*14px/);
  assert.match(css, /font-weight:\s*600/);
  assert.match(css, /font-size:\s*inherit; font-weight:\s*inherit/);
  const code = readFileSync(resolve(root, 'apps/web/features/workspace/safe-markdown.module.css'), 'utf8');
  assert.match(code, /font-size:\s*13px; white-space:\s*pre/);
});
