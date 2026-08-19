import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AuthPageClient } from '../../features/auth/AuthPageClient';
import {
  parseAuthErrorCode,
  PUBLIC_AUTH_ERROR_KEYS,
  UNMAPped_AUTH_ERROR_KEY,
} from '../../features/auth/public-error-code';

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('metadata.auth');
  return { description: t('description'), title: t('title') };
};

interface AuthPageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * Two-step authentication page. Step 1 sends the invitation + email and
 * creates a 10-minute reservation. Step 2 collects the OTP and forwards
 * the browser to `/auth/callback` where the BFF redeems the reservation.
 *
 * The wrapper is an RSC so the URL-based error code is translated
 * server-side (no raw codes in the DOM). The inner `AuthPageClient` is a
 * client component that owns the stepper state.
 */
const AuthPage = async ({ searchParams }: AuthPageProps) => {
  const params = await searchParams;
  const errorCode = parseAuthErrorCode(params.error);
  const errorKey = errorCode ? PUBLIC_AUTH_ERROR_KEYS[errorCode] : null;
  const t = await getTranslations('auth');

  return (
    <AuthPageClient
      errorMessage={errorKey ? t(`errors.${errorKey}`) : null}
      fallbackMessage={errorCode === null && params.error ? t(`errors.${UNMAPped_AUTH_ERROR_KEY}`) : null}
      title={t('title')}
      subtitle={t('subtitle')}
    />
  );
};

export default AuthPage;