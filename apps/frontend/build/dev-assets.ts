import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';
import policy from './public-asset-allowlist.json';

const allowed = new Set(policy.files);
const contentTypes: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };

/** Development serves the same reviewed media set as production copying. */
export function devAssets(source: string): Plugin {
  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const rawPath = request.url?.split('?')[0] ?? '';
    if (!/^\/(?:commerce|licenses)(?:\/|$)/.test(rawPath)) return next();
    const serve = async () => {
      const file = rawPath.slice(1);
      if (!['GET', 'HEAD'].includes(request.method ?? '') || !allowed.has(file)) {
        response.statusCode = 404; response.end(); return;
      }
      const root = await realpath(source);
      let target = root;
      for (const component of file.split('/')) {
        target = join(target, component);
        if ((await lstat(target)).isSymbolicLink()) throw new Error('Symlink is not a public development resource');
      }
      const actual = await realpath(target);
      const info = await lstat(actual);
      if (!actual.startsWith(`${root}${sep}`) || !info.isFile() || actual !== resolve(root, file)) throw new Error('Invalid public resource');
      response.setHeader('content-type', contentTypes[file.split('.').pop() ?? ''] ?? 'application/octet-stream');
      response.setHeader('content-length', info.size);
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(actual);
      stream.on('error', () => { if (!response.headersSent) response.statusCode = 404; response.end(); });
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    };
    void serve().catch(() => { if (!response.headersSent) response.statusCode = 404; response.end(); });
  };
  return { name: 'zimage-dev-public-assets', apply: 'serve', configureServer(server) { server.middlewares.use(middleware); } };
}
