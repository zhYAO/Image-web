import { getTranslations } from 'next-intl/server';

/**
 * Recent projects placeholder. M5 only renders the empty state — the
 * RSC reads verified claims (from `app/page.tsx`) and skips this block
 * entirely for anonymous users. M6 will replace the empty state with
 * a paginated query against the `projects` table once the migration is
 * merged.
 */
export const RecentProjects = async () => {
  const t = await getTranslations('home.recentProjects');

  return (
    <section
      aria-labelledby="home-recent-title"
      className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 id="home-recent-title" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <span className="text-xs text-stone-500">{t('viewAll')}</span>
      </header>
      <p className="text-sm leading-6 text-stone-600">{t('empty')}</p>
    </section>
  );
};