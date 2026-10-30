import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { HomePage } from './pages/home';
import { LegalPage } from './pages/legal';
import Link from './platform/link';
import { useNavigation } from './platform/navigation';
import { useRuntime } from './platform/runtime-provider';
import { resolveRoute, type PageId, type PageRoute } from './route-policy';

type RuntimePage = Exclude<PageId, 'home' | 'terms' | 'privacy'>;
export type PageModules = Partial<Record<RuntimePage, ComponentType<{ route: PageRoute }>>>;
const Catalogue = lazy(() => import('./pages/catalogue').then(module => ({ default: module.CataloguePage })));

function Unavailable() {
  return <main className="glass-page"><div className="glass-card" role="alert"><h1>此入口暂不可用</h1><p>请稍后重试。</p><Link href="/home">返回首页</Link></div></main>;
}
export function Routes({ pages = {}, legalCreditBalance }: { pages?: PageModules; legalCreditBalance?: ReactNode }) {
  const navigation = useNavigation();
  const runtime = useRuntime();
  const route = resolveRoute(navigation.href);
  const publicHome = route.kind === 'page' && route.page === 'home';
  useEffect(() => {
    document.title = publicHome ? 'ZImage · 一句话开始创作' : 'ZImage · 创作空间';
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); }
    robots.content = publicHome ? 'index,follow' : 'noindex,nofollow';
  }, [publicHome]);
  const redirect = route.kind === 'redirect' ? route.href : undefined;
  useEffect(() => { if (redirect) navigation.replace(redirect, { scroll: false }); }, [redirect, navigation]);
  if (route.kind === 'redirect') return <p role="status">正在打开…</p>;
  if (route.kind !== 'page') return <main className="glass-page"><h1>页面不存在</h1><Link href="/home">返回首页</Link></main>;
  if (route.page === 'home') return <HomePage />;
  if (route.page === 'terms' || route.page === 'privacy') return <LegalPage kind={route.page} creditBalance={legalCreditBalance} />;
  if (route.page === 'catalogue') return <Suspense fallback={<p role="status">正在打开电商创作…</p>}><Catalogue /></Suspense>;
  if (runtime.status === 'checking') return <main className="glass-page"><p role="status">正在确认服务…</p></main>;
  if (runtime.status !== 'ready') return <Unavailable />;
  const Page = pages[route.page];
  return Page ? <Suspense fallback={<p role="status">正在打开…</p>}><Page route={route} /></Suspense> : <Unavailable />;
}
