// @vitest-environment node
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createServer, type PluginOption, type ViteDevServer } from 'vite';
import { devAssets } from '../build/dev-assets';
import { devProxyOptions } from '../build/dev-runtime.mjs';

let backend: Server | undefined, frontend: ViteDevServer | undefined, frontendListener: Server | undefined, directory: string | undefined;
afterEach(async () => {
  if (frontendListener) { const current = frontendListener; current.closeAllConnections(); await new Promise<void>(resolve => current.close(() => resolve())); frontendListener = undefined; }
  await frontend?.close(); frontend = undefined;
  if (backend) { const current = backend; current.closeAllConnections(); await new Promise<void>(resolve => current.close(() => resolve())); backend = undefined; }
  if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined;
});
async function startFrontend(plugins: PluginOption[], proxy?: ReturnType<typeof devProxyOptions>) {
  frontend = await createServer({ configFile: false, envFile: false, root: directory, publicDir: false, logLevel: 'silent', plugins,
    server: { middlewareMode: true, hmr: false, proxy } });
  // Vite 7 resolves a configured port 0 to 5173. Let Node allocate a real
  // ephemeral listener so these fixtures never compete with dev:split.
  frontendListener = createHttpServer(frontend.middlewares);
  await new Promise<void>(resolve => frontendListener!.listen(0, '127.0.0.1', resolve));
  const address = frontendListener.address();
  if (!address || typeof address === 'string') throw new Error('Missing development listener');
  return `http://127.0.0.1:${address.port}`;
}
it('serves only reviewed public media and rejects excluded sources, traversal and symlinks', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zimage-dev-assets-'));
  const source = join(directory, 'public'); await mkdir(join(source, 'commerce/apparel-v2'), { recursive: true });
  await writeFile(join(source, 'commerce/apparel-v2/main-1.webp'), 'approved-image');
  await writeFile(join(source, 'commerce/apparel-v2/source-hero.png'), 'private-source');
  await writeFile(join(directory, 'outside.webp'), 'outside');
  await symlink(join(directory, 'outside.webp'), join(source, 'commerce/apparel-v2/main-2.webp'));
  const origin = await startFrontend([devAssets(source)]);
  const image = await fetch(`${origin}/commerce/apparel-v2/main-1.webp`);
  expect(image.status).toBe(200); expect(image.headers.get('content-type')).toBe('image/webp'); expect(await image.text()).toBe('approved-image');
  for (const path of ['/commerce/apparel-v2/source-hero.png', '/commerce/apparel-v2/main-2.webp', '/commerce/%2e%2e%2foutside.webp', '/commerce/unknown.webp']) expect((await fetch(`${origin}${path}`)).status).toBe(404);
  const head = await fetch(`${origin}/commerce/apparel-v2/main-1.webp`, { method: 'HEAD' });
  expect(head.status).toBe(200); expect(await head.text()).toBe('');
});
it('preserves Origin, Host and cookies through the same-origin API proxy and streams SSE before completion', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zimage-dev-proxy-'));
  let finishStream: (() => void) | undefined;
  backend = createHttpServer((request, response) => {
    if (request.url === '/api/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'set-cookie': ['first=fixture; Path=/; HttpOnly', 'second=fixture; Path=/; HttpOnly'] });
      response.write('data: first\n\n'); finishStream = () => response.end('data: done\n\n');
    } else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ origin: request.headers.origin, host: request.headers.host, cookie: request.headers.cookie, method: request.method })); }
  });
  await new Promise<void>(resolve => backend!.listen(0, '127.0.0.1', resolve));
  const address = backend.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture backend');
  const origin = await startFrontend([], devProxyOptions(`http://127.0.0.1:${address.port}`));
  const echo = await fetch(`${origin}/api/echo`, { method: 'POST', headers: { origin, cookie: 'session=fixture', 'content-type': 'application/json' }, body: '{}' });
  expect(await echo.json()).toEqual({ origin, host: new URL(origin).host, cookie: 'session=fixture', method: 'POST' });
  const response = await fetch(`${origin}/api/stream`, { signal: AbortSignal.timeout(5000) });
  expect(response.headers.getSetCookie()).toHaveLength(2);
  const reader = response.body!.getReader();
  try {
    const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toBe('data: first\n\n');
    finishStream!(); const second = await reader.read(); expect(new TextDecoder().decode(second.value)).toBe('data: done\n\n');
  } finally { finishStream?.(); await reader.cancel(); }
}, 15000);
