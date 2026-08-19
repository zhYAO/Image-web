import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { loadSkillCatalog } from '../../data/skill-catalog';

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('skills');
  return { description: t('subtitle'), title: t('title') };
};

/**
 * /skills — public catalogue of published official Skills. M6 reads
 * from a static JSON seed; M7+ will swap to a read-only DB view once
 * the `skills` migration and curation RPC are approved.
 *
 * Per SKILL-003 the page is browsable by anonymous users. The
 * "useSkill" link on each card forwards to `/?skill=<slug>` so the
 * home composer can pre-select it; COMM-003 mandates that pre-selection
 * must never auto-execute, which the composer enforces in M6+.
 */
const SkillsPage = async () => {
  const catalog = await loadSkillCatalog();
  const t = await getTranslations('skills');

  const categories = Array.from(new Set(catalog.map((entry) => entry.category)));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 sm:px-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="text-base leading-7 text-stone-600">{t('subtitle')}</p>
      </header>

      <nav aria-label={t('categoryAll')} className="flex flex-wrap gap-2">
        <span className="rounded-full border border-stone-900 bg-stone-900 px-3 py-1 text-xs text-white">
          {t('categoryAll')}
        </span>
        {categories.map((category) => (
          <span
            key={category}
            className="rounded-full border border-black/10 bg-stone-50 px-3 py-1 text-xs text-stone-700"
          >
            {category}
          </span>
        ))}
      </nav>

      {catalog.length === 0 ? (
        <p className="text-sm text-stone-600">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {catalog.map((entry) => {
            const version = entry.latestVersion;
            return (
              <li key={entry.slug}>
                <Link
                  href={`/skills/${entry.slug}`}
                  className="flex h-full flex-col gap-3 rounded-3xl border border-black/10 bg-white p-8 shadow-sm transition hover:border-stone-300"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold tracking-tight">{entry.title}</h2>
                    <span className="rounded-full border border-black/10 bg-stone-50 px-2.5 py-0.5 text-xs text-stone-600">
                      {entry.category}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-stone-600">{entry.summary}</p>
                  <dl className="mt-auto flex flex-wrap gap-4 pt-4 text-xs text-stone-500">
                    <div>
                      <dt className="inline">{t('steps')}</dt>
                      <dd className="ml-1 inline font-medium text-stone-800">
                        {version.steps.length}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">{t('outputs')}</dt>
                      <dd className="ml-1 inline font-medium text-stone-800">
                        {version.outputContract.maxOutputs}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">{t('capabilities')}</dt>
                      <dd className="ml-1 inline font-medium text-stone-800">
                        {version.allowedCapabilities.join(' · ')}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SkillsPage;