import { renderToString } from 'react-dom/server';
import { NavigationProvider } from './platform/navigation';
import { HomePage } from './pages/home';
import { LegalPage } from './pages/legal';
import { CataloguePage } from './pages/catalogue';
import { Suspense } from 'react';

export const publicPrerenderPaths = ['/', '/home', '/terms', '/privacy', '/create'] as const;

/** Build-only entry. Never imported by main.tsx or the browser route graph. */
export function renderPublicPage(path: string) {
  if (!(publicPrerenderPaths as readonly string[]).includes(path)) throw new Error('Not an approved public prerender route');
  const home = path === '/' || path === '/home';
  const catalogue = path === '/create';
  return {
    status: 200,
    title: home ? 'ZImage · 一句话开始创作' : catalogue ? '电商生图 · ZImage' : path === '/terms' ? '服务条款（未批准草案）· ZImage' : '隐私政策（未批准草案）· ZImage',
    description: '聊天与 AI 生图一体化创作工作区',
    robots: home || catalogue ? 'index,follow' : 'noindex,nofollow',
    html: renderToString(<NavigationProvider initialHref={path}>{home ? <HomePage /> : catalogue ? <Suspense fallback={<p role="status">正在打开电商创作…</p>}><CataloguePage /></Suspense> : <LegalPage kind={path === '/terms' ? 'terms' : 'privacy'} />}</NavigationProvider>),
  };
}
