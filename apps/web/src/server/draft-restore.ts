import { z } from 'zod';

/**
 * AUTH-006: only safe-to-restore draft fields may round-trip through the
 * anonymous composer. The browser stores this in local storage after a
 * pending submission is intercepted; the BFF re-validates with this schema
 * before redirecting the user back to the composer.
 *
 * Forbidden fields (must throw when present):
 *   * provider / model identifiers
 *   * raw file blobs or signed URLs
 *   * task ids, ledger events, execution plans
 *   * invitation codes, OTP values, session cookies
 *
 * The restore payload is therefore a strict subset of the agent request
 * input — it intentionally lacks any way to execute or pre-charge credits.
 */
export const homeComposerDraftSchema = z
  .object({
    prompt: z.string().max(2_000).default(''),
    selectedTool: z
      .enum(['generate', 'remove_background', 'replace_background', 'outpaint_resize', 'upscale'])
      .optional(),
    selectedSkillVersionId: z.uuid().optional(),
    primaryAssetId: z.uuid().optional(),
    referenceAssets: z
      .array(
        z.object({
          assetId: z.uuid(),
          role: z.enum(['style', 'scene', 'composition']),
        }),
      )
      .max(3)
      .default([]),
    parameters: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('generate') }),
        z.object({ kind: z.literal('remove_background') }),
        z.object({ kind: z.literal('replace_background'), backgroundPrompt: z.string().max(2_000) }),
        z.object({ kind: z.literal('outpaint_resize') }),
        z.object({ kind: z.literal('upscale'), factor: z.union([z.literal(2), z.literal(4)]) }),
        z.object({ kind: z.literal('skill') }),
        z.object({ kind: z.literal('prompt') }),
      ])
      .optional(),
    requestedOutputCount: z.number().int().min(1).max(8).optional(),
    /** Optional local fallback id so the user can be returned to the draft on login. */
    localDraftId: z.uuid().optional(),
  })
  .strict();

export type HomeComposerDraft = z.infer<typeof homeComposerDraftSchema>;

/**
 * Serializable variant that the BFF can store in a short-lived HttpOnly
 * cookie during the redirect to `/auth/callback`. The cookie body is a
 * base64url-encoded JSON string; the BFF decodes and re-validates with
 * `homeComposerDraftSchema` before rehydrating the composer.
 */
export const serializableDraftSchema = z
  .object({
    payload: homeComposerDraftSchema,
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type SerializableDraft = z.infer<typeof serializableDraftSchema>;

const DRAFT_TTL_MS = 30 * 60 * 1000; // 30 minutes, matches Supabase OTP TTL

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const padding = remainder === 0 ? '' : '='.repeat(4 - remainder);
  return Buffer.from(padded + padding, 'base64').toString('utf8');
};

/**
 * Encode a draft for transport in a short-lived cookie. The result is a
 * base64url JSON envelope; the BFF must always re-validate the decoded
 * payload with `homeComposerDraftSchema` to catch schema drift.
 */
export const encodeDraft = (payload: HomeComposerDraft): string => {
  const now = new Date();
  const envelope: SerializableDraft = serializableDraftSchema.parse({
    payload,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  });
  return toBase64Url(JSON.stringify(envelope));
};

/**
 * Decode a cookie value and re-validate the payload. Returns `null` when
 * the envelope is invalid, expired, or carries unknown fields — the BFF
 * must treat this as "user must re-select draft state manually".
 */
export const decodeDraft = (rawCookie: string | undefined): HomeComposerDraft | null => {
  if (!rawCookie) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(rawCookie));
  } catch {
    return null;
  }

  const envelope = serializableDraftSchema.safeParse(parsed);
  if (!envelope.success) {
    return null;
  }

  if (new Date(envelope.data.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return envelope.data.payload;
};

/**
 * Read the draft from a Next.js Request cookies store. Mirrors the
 * signature Next.js 15+ uses for `cookies()` in route handlers.
 */
export const readDraftFromCookieStore = (
  cookies: { get(name: string): { value: string } | undefined },
  cookieName = 'zima.draft',
): HomeComposerDraft | null => decodeDraft(cookies.get(cookieName)?.value);