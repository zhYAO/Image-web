import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('community');
  return { description: t('subtitle'), title: t('title') };
};

/**
 * /community — public curated cases index. M6 only renders the empty
 * state because the `community_cases` table and curation RPC are not
 * yet approved (COMM-001). The page is reachable so the navigation
 * links resolve to a real route rather than a 404.
 *
 * M7+ will replace this with a read-only query once the migration
 * and authorized-asset policies land.
 */
const CommunityPage = async () => {
  const t = await getTranslations('community');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 sm:px-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="text-base leading-7 text-stone-600">{t('subtitle')}</p>
      </header>

      <section
        aria-labelledby="community-empty"
        className="rounded-3xl border border-dashed border-black/10 bg-white/60 p-12 text-center"
      >
        <p id="community-empty" className="text-sm leading-6 text-stone-500">
          {t('empty')}
        </p>
      </section>
    </div>
  );
};

export default CommunityPage;