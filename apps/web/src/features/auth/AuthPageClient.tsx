'use client';

import { useState } from 'react';

import { InvitationForm } from './InvitationForm';
import { OtpForm } from './OtpForm';

interface OtpState {
  email: string;
  challenge: string;
  expiresAt: string;
}

export interface AuthPageClientProps {
  errorMessage: string | null;
  fallbackMessage: string | null;
  title: string;
  subtitle: string;
}

/**
 * Client wrapper that owns the OTP stepper state. Renders the banner
 * (mapped or fallback) at the top so returning users from `/auth/callback`
 * see what went wrong without flashing an empty form.
 */
export const AuthPageClient = ({ errorMessage, fallbackMessage, title, subtitle }: AuthPageClientProps) => {
  const [otp, setOtp] = useState<OtpState | null>(null);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-8 px-6 py-16 sm:px-10"
      aria-labelledby="auth-title"
    >
      <header className="flex flex-col gap-2 text-center">
        <h1 id="auth-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="text-base leading-7 text-stone-600">{subtitle}</p>
      </header>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMessage}
        </p>
      ) : fallbackMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {fallbackMessage}
        </p>
      ) : null}

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
};