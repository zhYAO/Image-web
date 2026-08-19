import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('foundation');
  return {
    title: t('title'),
    description: t('description'),
  };
}

const FoundationPage = async () => {
  const t = await getTranslations('foundation');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-16 sm:px-10">
      <section aria-labelledby="foundation-title" className="max-w-2xl rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12">
        <p className="mb-4 text-sm font-semibold tracking-[0.18em] text-stone-500 uppercase">{t('eyebrow')}</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl" id="foundation-title">
          {t('title')}
        </h1>
        <p className="mt-6 text-base leading-7 text-stone-700 sm:text-lg">{t('description')}</p>
        <p className="mt-8 border-l-2 border-stone-300 pl-4 text-sm leading-6 text-stone-600">{t('status')}</p>
      </section>
    </main>
  );
};

export default FoundationPage;

