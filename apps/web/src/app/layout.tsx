import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppNavigation } from '../features/navigation/AppNavigation';

import './globals.css';

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('metadata');

  return {
    description: t('description'),
    title: {
      default: t('title'),
      template: `%s · ${t('title')}`,
    },
  };
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

const RootLayout = async ({ children }: RootLayoutProps) => {
  const messages = await getMessages();
  const tNav = await getTranslations('navigation');

  return (
    <html lang="zh-CN">
      <body>
        <NextIntlClientProvider messages={messages}>
          <a
            href="#zima-main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-md focus:bg-stone-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
          >
            {tNav('skipToContent')}
          </a>
          <AppNavigation />
          <main id="zima-main" className="min-h-[calc(100vh-64px)]">
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
};

export default RootLayout;