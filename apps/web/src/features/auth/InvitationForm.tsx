'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

/**
 * First step of the AUTH flow. Submits the invitation code and email
 * to `POST /api/v1/auth/invitations/reserve`. On success the parent
 * stepper is advanced to the OTP step with the returned challenge.
 *
 * Per AUTH-006 and TECH-SELECTION §3.4 the BFF handles rate limiting
 * and HMAC validation; this client only ensures the inputs match the
 * Zod schemas so the user sees immediate field-level feedback.
 */
export interface InvitationFormProps {
  onChallenge: (challenge: string, email: string, expiresAt: string) => void;
}

export const InvitationForm = ({ onChallenge }: InvitationFormProps) => {
  const t = useTranslations('auth');
  const tErrors = useTranslations('auth.errors');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const response = await fetch('/api/v1/auth/invitations/reserve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          email: email.trim(),
          idempotencyKey,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
        const codeKey = (body.error?.code ?? 'internal_error') as
          | 'invalid_input'
          | 'rate_limited'
          | 'invitation_not_found'
          | 'invitation_disabled'
          | 'invitation_expired'
          | 'invitation_already_redeemed'
          | 'invitation_not_approved'
          | 'internal_error';
        setError(tErrors(codeKey));
        return;
      }

      const payload = (await response.json()) as { challenge: string; expiresAt: string };
      onChallenge(payload.challenge, email.trim(), payload.expiresAt);
    } catch {
      setError(tErrors('internal_error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white p-8 shadow-sm"
      aria-describedby={error ? 'auth-error' : undefined}
    >
      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold tracking-wide text-stone-700 uppercase" htmlFor="invitation-code">
          {t('invitation.label')}
        </label>
        <input
          id="invitation-code"
          required
          minLength={8}
          maxLength={128}
          autoComplete="off"
          spellCheck={false}
          className="rounded-lg border border-black/15 bg-stone-50 px-4 py-3 text-base focus:border-stone-700 focus:outline-none"
          placeholder={t('invitation.placeholder')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold tracking-wide text-stone-700 uppercase" htmlFor="invitation-email">
          {t('email.label')}
        </label>
        <input
          id="invitation-email"
          required
          type="email"
          inputMode="email"
          autoComplete="email"
          className="rounded-lg border border-black/15 bg-stone-50 px-4 py-3 text-base focus:border-stone-700 focus:outline-none"
          placeholder={t('email.placeholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {error ? (
        <p id="auth-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-stone-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-400"
      >
        {submitting ? t('invitation.submitting') : t('invitation.submit')}
      </button>
    </form>
  );
};