import { useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * Top-level navigation bar for the public site. The set of links is
 * intentionally minimal in Phase 1: home, skills index, community index
 * and the entry point to `/auth`. The component is rendered by the
 * root layout so every page inherits the same primary navigation and
 * skip-to-content link (a11y baseline).
 *
 * Phase 1 must not surface user-specific links (recent projects,
 * credits, profile) because those require the session boundary that is
 * out of scope until M6. The HomePage is allowed to render a separate
 * "logged-in" rail below this navigation when it has a verified session.
 */
export const AppNavigation = () => {
  const tNav = useTranslations('navigation');

  return (
    <nav
      aria-label={tNav('home')}
      className="sticky top-0 z-10 w-full border-b border-black/10 bg-white/80 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3 sm:px-10">
        <Link href="/" className="text-base font-semibold tracking-tight text-stone-900">
          Zima
        </Link>
        <ul className="flex items-center gap-6 text-sm text-stone-700">
          <li>
            <Link href="/" className="transition hover:text-stone-950">
              {tNav('home')}
            </Link>
          </li>
          <li>
            <Link href="/skills" className="transition hover:text-stone-950">
              {tNav('skills')}
            </Link>
          </li>
          <li>
            <Link href="/community" className="transition hover:text-stone-950">
              {tNav('community')}
            </Link>
          </li>
          <li>
            <Link
              href="/auth"
              className="rounded-full border border-stone-900 px-4 py-1.5 text-stone-900 hover:bg-stone-900 hover:text-white"
            >
              {tNav('auth')}
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
};