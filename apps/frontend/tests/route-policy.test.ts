import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/route-policy';

describe('browser route classification', () => {
  it.each(['/', '/home', '/home/'])('keeps %s public', (url) => {
    expect(resolveRoute(url)).toMatchObject({ kind: 'page', page: 'home', private: false });
  });
  it.each(['/workspace', '/sessions/abc-123?task=t&batch=b&view=results', '/account'])('recognizes private %s', (url) => {
    expect(resolveRoute(url)).toMatchObject({ kind: 'page', private: true });
  });
  it('keeps deep-link query and fragment intact', () => {
    const route = resolveRoute('/sessions/abc-123?task=t&batch=b&view=results#output');
    expect(route).toMatchObject({ page: 'workspace', href: '/sessions/abc-123?task=t&batch=b&view=results#output' });
  });
  it.each(['/chat', '/image'])('canonicalizes %s', (url) => {
    expect(resolveRoute(url)).toEqual({ kind: 'redirect', href: '/workspace' });
  });
  it.each(['/skills', '/skills/old-tool'])('canonicalizes %s', (url) => {
    expect(resolveRoute(url)).toEqual({ kind: 'redirect', href: '/create' });
  });
  it('preserves legacy commerce intent using existing domain mapping', () => {
    expect(resolveRoute('/?scene=xhs-poster&platform=all&template=sample')).toEqual({
      kind: 'redirect', href: '/create/xhs-poster?platform=xiaohongshu&template=sample',
    });
  });
  it.each(['/api', '/api/meta', '/frontend-assets/v1/missing.js', '/missing.css', '/favicon.ico'])('does not swallow %s in SPA routing', (url) => {
    expect(resolveRoute(url)).toEqual({ kind: 'outside' });
  });
  it.each(['/create/batch', '/create/unknown', '/create/product-main/nested', '/?scene=batch', '/sessions/a%2fb', '/unknown', '//evil.test/path', 'https://evil.test/', '/home//'])('rejects %s', (url) => {
    expect(resolveRoute(url)).toEqual({ kind: 'not-found' });
  });
  it.each(['/create/product-main', '/create/apparel-catalog/', '/create/xhs-poster?platform=xiaohongshu'])('accepts only existing scene %s', (url) => {
    expect(resolveRoute(url)).toMatchObject({ kind: 'page', page: 'workspace', private: true });
  });
  it('keeps auth aliases and unapproved legal pages explicit', () => {
    expect(resolveRoute('/login?returnTo=%2Fworkspace')).toMatchObject({ page: 'auth', private: false });
    expect(resolveRoute('/auth/reset')).toMatchObject({ page: 'reset', private: false });
    expect(resolveRoute('/terms')).toMatchObject({ page: 'terms', private: false });
  });
});
