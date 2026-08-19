import { describe, expect, it } from 'vitest';

import { decodeDraft, encodeDraft, homeComposerDraftSchema, readDraftFromCookieStore, type HomeComposerDraft } from './draft-restore.js';

const sampleDraft: HomeComposerDraft = {
  prompt: '把这双鞋放进浅灰影棚背景',
  selectedTool: 'replace_background',
  referenceAssets: [
    { assetId: '11111111-1111-4111-8111-111111111111', role: 'style' },
  ],
  parameters: { kind: 'replace_background', backgroundPrompt: 'soft studio background' },
  requestedOutputCount: 4,
};

describe('homeComposerDraftSchema', () => {
  it('accepts the canonical payload', () => {
    expect(() => homeComposerDraftSchema.parse(sampleDraft)).not.toThrow();
  });

  it('rejects provider identifiers', () => {
    expect(() =>
      homeComposerDraftSchema.parse({ ...sampleDraft, providerId: 'aliyun-bailian' }),
    ).toThrow();
  });

  it('rejects file blobs', () => {
    expect(() =>
      homeComposerDraftSchema.parse({ ...sampleDraft, file: { name: 'x.png', bytes: new ArrayBuffer(8) } }),
    ).toThrow();
  });

  it('rejects more than three reference assets', () => {
    const tooMany = Array.from({ length: 4 }, (_, i) => ({
      assetId: `11111111-1111-4111-8111-1111111111${(i + 1).toString().padStart(2, '0')}`,
      role: 'style' as const,
    }));
    expect(() => homeComposerDraftSchema.parse({ ...sampleDraft, referenceAssets: tooMany })).toThrow();
  });

  it('rejects requested output counts above 8', () => {
    expect(() =>
      homeComposerDraftSchema.parse({ ...sampleDraft, requestedOutputCount: 9 }),
    ).toThrow();
  });
});

describe('encodeDraft / decodeDraft', () => {
  it('round-trips a valid draft', () => {
    const encoded = encodeDraft(sampleDraft);
    const decoded = decodeDraft(encoded);
    expect(decoded).toEqual(sampleDraft);
  });

  it('rejects expired envelopes', () => {
    // Encode a draft, then re-encode it with a stale expiry to simulate
    // an expired cookie without depending on string mutation heuristics.
    const staleEnvelope = {
      payload: sampleDraft,
      issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const encoded = Buffer.from(JSON.stringify(staleEnvelope), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeDraft(encoded)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(decodeDraft(undefined)).toBeNull();
    expect(decodeDraft('not-a-cookie')).toBeNull();
    expect(decodeDraft(Buffer.from('{"prompt":1}', 'utf8').toString('base64'))).toBeNull();
  });
});

describe('readDraftFromCookieStore', () => {
  it('returns the decoded draft when the cookie is set', () => {
    const encoded = encodeDraft(sampleDraft);
    const cookie = { get: (name: string) => (name === 'zima.draft' ? { value: encoded } : undefined) };
    expect(readDraftFromCookieStore(cookie)).toEqual(sampleDraft);
  });

  it('returns null when the cookie is missing', () => {
    const cookie = { get: () => undefined };
    expect(readDraftFromCookieStore(cookie)).toBeNull();
  });
});