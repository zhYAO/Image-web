'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { InvitationForm } from '../../features/auth/InvitationForm';
import { OtpForm } from '../../features/auth/OtpForm';

interface OtpState {
  email: string;
  challenge: string;
  expiresAt: string;
}

/**
 * Two-step authentication page. Step 1 sends the invitation + email and
 * creates a 10-minute reservation. Step 2 collects the OTP and forwards
 * the browser to `/auth/callback` where the BFF redeems the reservation.
 *
 * The component lives under `app/auth/page.tsx` because Phase 1 keeps
 * the URL locale-free (next-intl single-locale mode, see
 * tech-selection.md §2.1).
 */
export default function AuthPage() {
  const t = useTranslations('auth');
  const [otp, setOtp] = useState<OtpState | null>(null);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-8 px-6 py-16 sm:px-10"
      aria-labelledby="auth-title"
    >
      <header className="flex flex-col gap-2 text-center">
        <h1 id="auth-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('title')}
        </h1>
        <p className="text-base leading-7 text-stone-600">{t('subtitle')}</p>
      </header>

      <section className="flex flex-col gap-6">
        {otp ? (
          <OtpForm email={otp.email} challenge={otp.challenge} expiresAt={otp.expiresAt} />
        ) : (
          <InvitationForm
            onChallenge={(challenge, email, expiresAt) => setOtp({ email, challenge, expiresAt })}
          />
        )}
      </section>
    </main>
  );
}