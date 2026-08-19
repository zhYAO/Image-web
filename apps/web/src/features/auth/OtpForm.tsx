'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Second step of the AUTH flow. Supabase sends an OTP email that
 * contains a verification link with `token_hash` + `type` query
 * parameters. The browser lands on `/auth/callback` once the user
 * clicks the link (Supabase Auth configures `additional_redirect_urls`
 * to include the app origin). The challenge from step 1 round-trips
 * in the `state` query parameter so the BFF can identify the right
 * reservation.
 *
 * Per TECH-SELECTION §3.4 the BFF never trusts the URL or the email;
 * it only trusts the verified Auth claims on the server-side client.
 */
export interface OtpFormProps {
  email: string;
  challenge: string;
  expiresAt: string;
}

export const OtpForm = ({ email, challenge, expiresAt }: OtpFormProps) => {
  const t = useTranslations('auth');
  const tErrors = useTranslations('auth.errors');
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSimulateClick = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      // In local development with the Supabase InBucket SMTP the link
      // delivered to the user lands on the callback directly. We forward
      // the challenge here so the BFF can map the verification back to
      // the matching reservation. The token_hash arrives automatically
      // via the email link; this client only adds `state`.
      const params = new URLSearchParams({ state: challenge });
      router.push(`/auth/callback?${params.toString()}`);
    } catch {
      setError(tErrors('internal_error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSimulateClick}
      className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white p-8 shadow-sm"
      aria-describedby={error ? 'otp-error' : undefined}
    >
      <p className="text-sm leading-6 text-stone-600">
        {t('email.label')}：<span className="font-mono">{email}</span>
      </p>
      <p className="text-xs text-stone-500">预约有效期：{new Date(expiresAt).toLocaleString('zh-CN')}</p>
      <p className="text-sm leading-6 text-stone-700">{t('subtitle')}</p>

      {error ? (
        <p id="otp-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-stone-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-400"
      >
        {submitting ? t('otp.submitting') : t('otp.submit')}
      </button>
    </form>
  );
};