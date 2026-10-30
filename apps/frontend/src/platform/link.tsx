import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { resolveRoute } from '../route-policy';
import { useNavigation } from './navigation';

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean | null;
  scroll?: boolean;
  replace?: boolean;
};

/** A real anchor for prerender/no-JS, with navigation enhanced on ordinary clicks. */
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, prefetch = false, scroll, replace, onClick, onFocus, onMouseEnter, ...props }, ref) {
  const navigation = useNavigation();
  const intent = () => {
    const route = resolveRoute(href);
    if (prefetch !== false && route.kind === 'page' && ['workspace', 'assets', 'catalogue'].includes(route.page)) navigation.prefetchWorkspace();
  };
  return <a {...props} ref={ref} href={href}
    onFocus={event => { onFocus?.(event); if (!event.defaultPrevented) intent(); }}
    onMouseEnter={event => { onMouseEnter?.(event); if (!event.defaultPrevented) intent(); }}
    onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.target && props.target !== '_self') || props.download !== undefined) return;
      const route = resolveRoute(href);
      if (route.kind === 'outside' || route.kind === 'not-found') return;
      event.preventDefault();
      navigation[replace ? 'replace' : 'push'](route.kind === 'redirect' ? route.href : href, { scroll });
    }} />;
});
export default Link;
