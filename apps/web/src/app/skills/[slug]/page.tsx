import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { findSkillBySlug, loadSkillCatalog } from '../../../data/skill-catalog';

interface SkillDetailPageProps {
  params: Promise<{ slug: string }>;
}

export const generateMetadata = async ({
  params,
}: SkillDetailPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const catalog = await loadSkillCatalog();
  const entry = findSkillBySlug(catalog, slug);
  if (!entry) return { title: 'Not Found' };
  return { description: entry.summary, title: entry.title };
};

/**
 * /skills/[slug] — public detail page for a single published Skill.
 *
 * Renders the version snapshot (steps, capabilities, output contract)
 * and a "useSkill" link that forwards to `/?skill=<slug>`. Per
 * COMM-003 the link only pre-selects; it must never auto-execute.
 */
const SkillDetailPage = async ({ params }: SkillDetailPageProps) => {
  const { slug } = await params;
  const catalog = await loadSkillCatalog();
  const entry = findSkillBySlug(catalog, slug);

  if (!entry) {
    notFound();
  }

  const t = await getTranslations('skills');
  const version = entry.latestVersion;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12 sm:px-10 sm:py-16">
      <nav className="text-sm text-stone-500">
        <Link href="/skills" className="transition hover:text-stone-800">
          {t('title')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-stone-800">{entry.title}</span>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{entry.title}</h1>
          <span className="rounded-full border border-black/10 bg-stone-50 px-2.5 py-0.5 text-xs text-stone-600">
            {entry.category}
          </span>
        </div>
        <p className="text-base leading-7 text-stone-700">{entry.summary}</p>
      </header>

      <Link
        href={`/?skill=${encodeURIComponent(entry.slug)}`}
        className="self-start rounded-lg bg-stone-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-stone-700"
      >
        {t('useSkill')}
      </Link>

      <section className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{t('capabilities')}</h2>
        <ul className="flex flex-wrap gap-2">
          {version.allowedCapabilities.map((capability) => (
            <li
              key={capability}
              className="rounded-full border border-black/10 bg-stone-50 px-3 py-1 text-xs text-stone-700"
            >
              {capability}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{t('steps')}</h2>
        <ol className="flex flex-col gap-4">
          {version.steps.map((step, index) => (
            <li key={`step-${index}`} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-300 text-sm font-semibold text-stone-700">
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-stone-900">{step.capability}</p>
                <p className="text-xs text-stone-500">
                  {t('outputs')}：{step.outputCount}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{t('outputs')}</h2>
        <dl className="flex flex-wrap gap-6 text-sm">
          <div>
            <dt className="text-stone-500">min</dt>
            <dd className="font-medium text-stone-900">{version.outputContract.minOutputs}</dd>
          </div>
          <div>
            <dt className="text-stone-500">max</dt>
            <dd className="font-medium text-stone-900">{version.outputContract.maxOutputs}</dd>
          </div>
          <div>
            <dt className="text-stone-500">formats</dt>
            <dd className="font-medium text-stone-900">
              {version.outputContract.allowedFormats.join(' · ')}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
};

export default SkillDetailPage;