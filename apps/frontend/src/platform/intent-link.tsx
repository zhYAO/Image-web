import Link, { type LinkProps } from './link';
import { useNavigation } from './navigation';
import { resolveRoute } from '../route-policy';

/** Reuse intent semantics without Next prefetch scheduling or a second route store. */
export function IntentLink({ href, onMouseEnter, onFocus, onTouchStart, ...props }: Omit<LinkProps, 'prefetch'>) {
  const navigation = useNavigation();
  const warm = () => {
    const route = resolveRoute(href);
    if (route.kind === 'page' && ['workspace', 'catalogue', 'assets'].includes(route.page)) navigation.prefetchWorkspace();
  };
  return <Link {...props} href={href} prefetch={false}
    onMouseEnter={event => { onMouseEnter?.(event); if (!event.defaultPrevented) warm(); }}
    onFocus={event => { onFocus?.(event); if (!event.defaultPrevented) warm(); }}
    onTouchStart={event => { onTouchStart?.(event); if (!event.defaultPrevented) warm(); }} />;
}
