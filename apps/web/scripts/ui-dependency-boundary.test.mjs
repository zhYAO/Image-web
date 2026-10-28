import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
const retired = ['@lobehub/ui', '@lobehub/icons', 'antd', 'antd-style', '@emotion/cache', '@emotion/react'];

test('retired UI packages are absent from the app manifest and module resolution', () => {
  const manifest = JSON.parse(readFileSync(path.join(webRoot, 'package.json'), 'utf8'));
  for (const name of retired) {
    assert.equal(manifest.dependencies[name], undefined, name);
    assert.throws(() => requireFromWeb.resolve(name), { code: 'MODULE_NOT_FOUND' }, name);
  }
});

test('production views and build configuration have no retired UI imports or replacement profiles', () => {
  const invalid = [];
  const importPattern = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\()\s*['"]([^'"]+)['"]/g;
  function inspect(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) inspect(file);
      else if (/\.[cm]?[jt]sx?$/.test(item.name)) {
        const source = readFileSync(file, 'utf8');
        for (const [, name] of source.matchAll(importPattern))
          if (retired.some(packageName => name === packageName || name.startsWith(`${packageName}/`))) invalid.push(file);
      }
    }
  }
  for (const directory of ['app', 'features', 'build']) inspect(path.join(webRoot, directory));
  assert.deepEqual(invalid, []);
  for (const file of ['next.config.ts', 'vitest.config.ts'])
    assert.doesNotMatch(readFileSync(path.join(webRoot, file), 'utf8'), /createMarkdownBuildProfile|NormalModuleReplacementPlugin/);
});
