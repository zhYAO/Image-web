import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

export type NavigationOptions = { scroll?: boolean };
export type Navigation = {
  href: string;
  pathname: string;
  searchParams: URLSearchParams;
  push: (url: string, options?: NavigationOptions) => void;
  replace: (url: string, options?: NavigationOptions) => void;
  prefetchWorkspace: () => void;
};
const Context = createContext<Navigation | null>(null);
const eventName = 'zimage:navigate';
const currentHref = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const subscribe = (listener: () => void) => {
  window.addEventListener(eventName, listener);
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
};

export function NavigationProvider({ children, initialHref = '/', prefetchWorkspace = () => {} }: {
  children: ReactNode;
  initialHref?: string;
  prefetchWorkspace?: () => void;
}) {
  const href = useSyncExternalStore(subscribe, currentHref, () => initialHref);
  const navigate = useCallback((method: 'pushState' | 'replaceState', target: string, options?: NavigationOptions) => {
    if (!/^(?:\/|\?|#)/.test(target) || target.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(target)) throw new Error('Expected a local navigation URL');
    const url = new URL(target, window.location.href);
    if (url.origin !== window.location.origin) throw new Error('Expected a same-origin navigation URL');
    window.history[method](null, '', `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(eventName));
    if (options?.scroll !== false) {
      requestAnimationFrame(() => {
        let id = '';
        try { id = decodeURIComponent(url.hash.slice(1)); } catch { /* Invalid fragment has no target. */ }
        const element = id ? document.getElementById(id) : null;
        if (element) element.scrollIntoView();
        else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      });
    }
  }, []);
  const value = useMemo<Navigation>(() => {
    const url = new URL(href, 'https://frontend.invalid');
    return {
      href, pathname: url.pathname, searchParams: new URLSearchParams(url.search),
      push: (url, options) => navigate('pushState', url, options),
      replace: (url, options) => navigate('replaceState', url, options),
      prefetchWorkspace,
    };
  }, [href, navigate, prefetchWorkspace]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNavigation(): Navigation {
  const navigation = useContext(Context);
  if (!navigation) throw new Error('NavigationProvider is required');
  return navigation;
}
