import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigation } from './platform/navigation';
import { useRuntime } from './platform/runtime-provider';
import { prefetchWorkspace } from './platform/load-workspace';
import { resolveRoute } from './route-policy';
import { Routes } from './routes';
import { trackNavigation } from './platform/observability';
import { RuntimeBoundary } from './platform/runtime-boundary';

const Runtime = lazy(() => import('./runtime-application').then(module => ({ default: module.RuntimeApplication })));
export { prefetchWorkspace };
/** Once entered, keep providers and one owner-bound workspace through home visits. */
export function Application() {
  const navigation = useNavigation();
  const runtime = useRuntime();
  const route = resolveRoute(navigation.href);
  const needsRuntime = route.kind === 'page' && route.page !== 'home';
  const [entered, setEntered] = useState(false);
  useEffect(() => trackNavigation(navigation.pathname), [navigation.pathname]);
  if (needsRuntime && runtime.status === 'ready' && !entered) setEntered(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.zTheme = media.matches ? 'dark' : 'light'; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return entered ? <RuntimeBoundary><Suspense fallback={<p role="status">正在打开创作空间…</p>}><Runtime /></Suspense></RuntimeBoundary> : <Routes />;
}
