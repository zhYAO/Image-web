import { getTranslations } from 'next-intl/server';

/**
 * Featured cases placeholder. Always rendered (anonymous and logged-in)
 * because the curated catalogue is public by definition. M5 leaves the
 * grid empty; M6 wires it to the read-only `featured_cases` view after
 * the curation migration lands.
 */
export const FeaturedCases = async () => {
  const t = await getTranslations('home.featuredCases');

  return (
    <section
      aria-labelledby="home-cases-title"
      className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 id="home-cases-title" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <span className="text-xs text-stone-500">{t('viewAll')}</span>
      </header>
      <p className="text-sm leading-6 text-stone-600">{t('empty')}</p>
    </section>
  );
};