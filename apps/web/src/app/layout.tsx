import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import './globals.css';

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('metadata');

  return {
    description: t('description'),
    title: t('title'),
  };
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

const RootLayout = async ({ children }: RootLayoutProps) => {
  const messages = await getMessages();

  return (
    <html lang="zh-CN">
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
};

export default RootLayout;

