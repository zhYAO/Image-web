import { commerceHref, workspaceRoute } from '../../web/features/workspace/workspace-route';

export type PageId = 'home' | 'workspace' | 'catalogue' | 'assets' | 'account' | 'auth' | 'verify' | 'reset' | 'terms' | 'privacy';
export type PageRoute = { kind: 'page'; page: PageId; private: boolean; href: string };
export type FrontendRoute = PageRoute | { kind: 'redirect'; href: string } | { kind: 'not-found' } | { kind: 'outside' };

/** Browser routing cannot set HTTP status. The ingress must enforce the same exclusions. */
export function resolveRoute(input: string): FrontendRoute {
  if (!input.startsWith('/') || input.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(input)) return { kind: 'not-found' };
  const url = new URL(input, 'https://frontend.invalid');
  const path = url.pathname;
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/frontend-assets/') || /\.[a-z0-9]+$/i.test(path)) return { kind: 'outside' };
  if (path.includes('//') || /%(?:2f|5c|00)/i.test(path)) return { kind: 'not-found' };
  const canonical = path.length > 1 ? path.replace(/\/$/, '') : path;
  const page = (name: PageId, restricted = false): PageRoute => ({ kind: 'page', page: name, private: restricted, href: `${path}${url.search}${url.hash}` });
  if (canonical === '/' && url.searchParams.has('scene')) {
    const legacy = workspaceRoute('/', url.search);
    return legacy.kind === 'commerce' ? { kind: 'redirect', href: commerceHref(legacy.scene, legacy.platform, legacy.template) } : { kind: 'not-found' };
  }
  if (canonical === '/' || canonical === '/home') return page('home');
  if (canonical === '/chat' || canonical === '/image') return { kind: 'redirect', href: '/workspace' };
  if (canonical === '/skills' || /^\/skills\/[^/]+$/.test(canonical)) return { kind: 'redirect', href: '/create' };
  const workspace = workspaceRoute(canonical, url.search);
  if (workspace.kind === 'home' || workspace.kind === 'session' || workspace.kind === 'commerce') return page('workspace', true);
  if (workspace.kind === 'invalid') return { kind: 'not-found' };
  if (workspace.kind === 'catalogue') return page('catalogue');
  if (workspace.kind === 'assets') return page('assets');
  if (canonical === '/account') return page('account', true);
  if (canonical === '/login' || canonical === '/auth') return page('auth');
  if (canonical === '/auth/verify') return page('verify');
  if (canonical === '/auth/reset') return page('reset');
  if (canonical === '/terms') return page('terms');
  if (canonical === '/privacy') return page('privacy');
  return { kind: 'not-found' };
}
