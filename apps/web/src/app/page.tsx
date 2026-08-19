import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { FeaturedCases } from '../features/home/FeaturedCases';
import { HomeComposer } from '../features/home/HomeComposer';
import { RecentProjects } from '../features/home/RecentProjects';
import {
  createServerUserClient,
  getVerifiedClaimsOrNull,
  type ServerCookieAdapter,
} from '@zima/supabase';

import { loadServerEnv } from '../server/env';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home');
  return { description: t('subtitle'), title: t('eyebrow') };
}

/**
 * Home page RSC. Phase 1 renders two branches off the verified session:
 *
 *   * Anonymous → Hero + composer + featured cases + anonymous hint.
 *   * Verified  → Anonymous content + recent projects rail.
 *
 * `getVerifiedClaimsOrNull` is the only sanctioned session probe for
 * RSC; it goes through `auth.getUser()` so the SDK revalidates the JWT.
 * Anything that requires a real `Profile` row belongs in M6 once the
 * `profiles` migration is connected to Auth via the finalize RPC.
 */
const HomePage = async () => {
  const env = loadServerEnv();
  const cookieStore = await cookies();
  const adapter: ServerCookieAdapter = {
    getAll: () =>
      cookieStore.getAll().map((cookie) => ({ name: cookie.name, value: cookie.value })),
    setAll: (entries) => {
      for (const entry of entries) {
        cookieStore.set({ name: entry.name, value: entry.value, ...(entry.options ?? {}) });
      }
    },
  };
  const userClient = createServerUserClient(env, adapter);
  const claims = await getVerifiedClaimsOrNull(userClient);
  const isAuthenticated = claims !== null;

  const t = await getTranslations('home');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-12 sm:px-10 sm:py-16">
      <section
        aria-labelledby="home-hero-title"
        className="flex flex-col gap-3 rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12"
      >
        <p className="text-sm font-semibold tracking-[0.18em] text-stone-500 uppercase">
          {t('eyebrow')}
        </p>
        <h1 id="home-hero-title" className="text-3xl font-semibold tracking-tight sm:text-5xl">
          {t('title')}
        </h1>
        <p className="max-w-2xl text-base leading-7 text-stone-700 sm:text-lg">{t('subtitle')}</p>
      </section>

      <HomeComposer />

      <FeaturedCases />

      {isAuthenticated ? <RecentProjects /> : (
        <p className="rounded-3xl border border-dashed border-black/10 bg-white/60 px-6 py-4 text-sm leading-6 text-stone-600">
          {t('anonymousHint')}
        </p>
      )}
    </div>
  );
};

export default HomePage;