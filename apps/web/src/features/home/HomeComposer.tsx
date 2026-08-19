import { getTranslations } from 'next-intl/server';

/**
 * Static placeholder for the Phase 1 home composer. M5 keeps the form
 * disabled and explicitly tells the user that real submission lands
 * with the M6 `/api/v1/agent/respond` route handler. Tool selection is
 * a read-only chip strip so the layout is final but no state mutation
 * happens before M6.
 *
 * The composer is rendered server-side because the only meaningful
 * behaviour in M5 is "look & feel + copy". Once `/api/v1/agent/respond`
 * is wired, this component will move to a client wrapper that manages
 * draft state and posts to the BFF.
 */
export const HomeComposer = async () => {
  const t = await getTranslations('home.composer');

  const tools = [
    { id: 'generate', label: t('tools.generate') },
    { id: 'remove_background', label: t('tools.remove_background') },
    { id: 'replace_background', label: t('tools.replace_background') },
    { id: 'outpaint_resize', label: t('tools.outpaint_resize') },
    { id: 'upscale', label: t('tools.upscale') },
  ] as const;

  return (
    <section
      aria-labelledby="home-composer-title"
      className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12"
    >
      <div className="flex flex-col gap-3">
        <h2 id="home-composer-title" className="text-2xl font-semibold tracking-tight">
          {t('title')}
        </h2>
        <p className="text-sm leading-6 text-stone-600">{t('prompt')}</p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <label className="sr-only" htmlFor="home-composer-input">
          {t('placeholder')}
        </label>
        <textarea
          id="home-composer-input"
          disabled
          rows={4}
          placeholder={t('placeholder')}
          className="w-full resize-none rounded-lg border border-black/15 bg-stone-50 px-4 py-3 text-base text-stone-700 focus:border-stone-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-80"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2" aria-label={t('tools.title')}>
        {tools.map((tool) => (
          <span
            key={tool.id}
            className="rounded-full border border-black/10 bg-stone-50 px-3 py-1 text-xs text-stone-700"
          >
            {tool.label}
          </span>
        ))}
      </div>

      <p className="mt-6 text-xs leading-5 text-stone-500">{t('submitAnonymous')}</p>
    </section>
  );
};