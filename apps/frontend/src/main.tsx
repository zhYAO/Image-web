import { createRoot, hydrateRoot } from 'react-dom/client';
import { NavigationProvider } from './platform/navigation';
import { RuntimeProvider } from './platform/runtime-provider';
import { Application, prefetchWorkspace } from './application';
import { initializeObservability } from './platform/observability';
import '../../web/app/globals.css';
import '../../web/features/brand/bridge.css';
import '../../web/features/brand/liquid-glass.css';

const root = document.getElementById('root');
if (!root) throw new Error('Frontend root is missing');
const initialHref = `${location.pathname}${location.search}${location.hash}`;
const descriptor = typeof __ZIMAGE_COMPATIBILITY__ === 'undefined' ? undefined : __ZIMAGE_COMPATIBILITY__;
const application = <NavigationProvider initialHref={initialHref} prefetchWorkspace={prefetchWorkspace}><RuntimeProvider descriptor={descriptor}><Application /></RuntimeProvider></NavigationProvider>;
if (root.children.length > 0) hydrateRoot(root, application);
else createRoot(root).render(application);
window.setTimeout(() => { void initializeObservability(typeof __ZIMAGE_OBSERVABILITY__ === 'undefined' ? null : __ZIMAGE_OBSERVABILITY__).catch(() => undefined); }, 0);
