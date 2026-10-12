import { describe, expect, it } from 'vitest';
import { CHAT_PROVIDER_MODELS, IMAGE_PROVIDER_CAPABILITIES, MODEL_REGISTRY_VERSION, TRIAL_CREDIT_CATALOG, imageCreditItem, quoteCredits, resolveImageModel, generationBatchSchema } from '../src';

describe('Plan Pro new image admissions', () => {
  it('advertises and defaults to the distinct Plan identity while retaining chat providers', () => {
    expect(IMAGE_PROVIDER_CAPABILITIES.map(p => ({ provider: p.provider, models: p.models.map(m => m.id) }))).toEqual([
      { provider: 'seedream', models: ['doubao-seedream-5.0-pro'] },
    ]);
    expect(resolveImageModel({}).model).toBe('doubao-seedream-5.0-pro');
    expect(MODEL_REGISTRY_VERSION).toBe('2026-10-12.1');
    expect(CHAT_PROVIDER_MODELS.map(p => p.id)).toEqual(['doubao', 'minimax']);
  });

  it.each(['seedream-4.5', 'seedream-5.0-flash', 'seedream-5.0-pro', 'gemini-3-pro-image'])('rejects %s for new generation', model => {
    expect(() => resolveImageModel({ provider: model.startsWith('gemini') ? 'gemini' : 'seedream', model })).toThrow(/主动更新/);
  });

  it('quotes only Plan Pro for images using a new price version', () => {
    expect(imageCreditItem({ resolution: '2K', count: 2 })).toMatchObject({ provider: 'seedream', model: 'doubao-seedream-5.0-pro' });
    expect(quoteCredits(TRIAL_CREDIT_CATALOG, [imageCreditItem({ resolution: '2K', count: 2 })])).toMatchObject({ version: '2026-10-12.1', totalMinor: 60 });
    expect(TRIAL_CREDIT_CATALOG.prices.filter(p => p.operation === 'image').map(p => p.model)).toEqual(['doubao-seedream-5.0-pro']);
  });

  it.each(['seedream-4.5', 'seedream-5.0-flash', 'seedream-5.0-pro', 'gemini-3-pro-image'])('continues parsing historical %s records', model => {
    const batch = { id: crypto.randomUUID(), sessionId: crypto.randomUUID(), model, provider: model.startsWith('gemini') ? 'gemini' : 'seedream', source: 'direct', prompt: 'original prompt', status: 'succeeded', config: { count: 1, aspectRatio: '1:1', resolution: '2K' }, createdAt: new Date().toISOString(), assets: [{ id: crypto.randomUUID(), status: 'succeeded' }] };
    expect(generationBatchSchema.parse(batch).model).toBe(model);
  });
});
