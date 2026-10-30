import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { renderPublicPage } from '../src/prerender';
import { isAllowedClientModule, assertClientSource } from '../build/client-boundary';

describe('static public content', () => {
  it.each(['/', '/home'])('renders the existing full homepage at %s without runtime requests', (path) => {
    const request = vi.spyOn(globalThis, 'fetch');
    const page = renderPublicPage(path);
    expect(page.status).toBe(200);
    expect(page.html).toContain('让灵感，');
    expect(page.html).toContain('成为下一张好图。');
    expect(page.html).toContain('id="landing-main"');
    expect(page.html).toContain('href="/create/product-main"');
    expect(page.html).toContain('width="1254"');
    expect(page.html).not.toContain('/_next/image');
    expect(page.robots).toBe('index,follow');
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
  it.each(['/terms', '/privacy'])('preserves the unapproved legal state at %s', path => {
    const page = renderPublicPage(path);
    expect(page.html).toContain('未批准草案');
    expect(page.html).toContain('不能作为公开发布版本');
    expect(page.robots).toBe('noindex,nofollow');
  });
  it('prerenders the real commerce catalogue without enumerating private sessions', () => {
    const page = renderPublicPage('/create');
    expect(page.html).toContain('电商生图');
    expect(page.html).toContain('href="/create/product-main"');
    expect(page.html).toContain('href="/create/apparel-catalog"');
    expect(page.robots).toBe('index,follow');
  });
  it.each(['/workspace', '/account', '/sessions/private-id', '/create/batch', '/unknown'])('refuses to enumerate %s as a public page', path => {
    expect(() => renderPublicPage(path)).toThrow('Not an approved public prerender route');
  });
  it('uses real anchors in server markup', () => {
    expect(typeof renderToString).toBe('function');
    expect(renderPublicPage('/').html).toContain('href="/login?returnTo=%2Fworkspace"');
  });
});

describe('frontend source boundary', () => {
  it.each([
    '/repo/apps/web/server/auth.ts', '/repo/apps/web/lib/supabase/server.ts',
    '/repo/apps/web/app/account/page.tsx', '/repo/node_modules/next/dist/index.js',
    '/repo/node_modules/@sentry/nextjs/index.js', '/repo/node_modules/sharp/lib/index.js',
    '/repo/fonts/NotoSansCJKsc-Regular.otf', '/repo/apps/web/gateways/mock-workspace-gateway.ts',
  ])('rejects server/unmigrated module %s', id => expect(isAllowedClientModule(id)).toBe(false));
  it.each(['/repo/apps/frontend/src/main.tsx', '/repo/packages/domain/src/index.ts', '/repo/apps/web/features/brand/landing/LandingPage.tsx', '/repo/apps/web/features/workspace/workspace-route.ts'])('accepts reviewed client module %s', id => expect(isAllowedClientModule(id)).toBe(true));
  it('rejects old compile-time public flags and server imports before bundling', () => {
    expect(() => assertClientSource('const x = process.env.NEXT_PUBLIC_DATA_MODE;', '/repo/apps/frontend/src/test.ts')).toThrow();
    expect(() => assertClientSource('import x from "node:fs";', '/repo/apps/frontend/src/test.ts')).toThrow();
    expect(() => assertClientSource('import x from "next/headers";', '/repo/apps/web/features/brand/example.tsx')).toThrow();
    expect(() => assertClientSource('import Link from "next/link";', '/repo/apps/web/features/brand/landing/LandingPage.tsx')).not.toThrow();
  });
});
