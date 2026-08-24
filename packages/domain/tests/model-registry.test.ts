import { describe, expect, it } from 'vitest';

import {
  IMAGE_PROVIDER_CAPABILITIES,
  MODEL_REGISTRY_VERSION,
  PHASE1_SKILLS,
  resolveImageModel,
} from '../src';

describe('versioned Phase 1 model and skill registry', () => {
  it('keeps stable logical IDs for Gemini and Seedream', () => {
    expect(MODEL_REGISTRY_VERSION).toMatch(/^2026-/);
    expect(IMAGE_PROVIDER_CAPABILITIES.map((capability) => capability.provider)).toEqual(['gemini', 'seedream']);
    expect(resolveImageModel({ model: 'gemini-3-pro-image', provider: 'gemini' })).toMatchObject({
      model: 'gemini-3-pro-image',
      provider: 'gemini',
    });
  });

  it('fails closed for an unsupported provider/model pair', () => {
    expect(() => resolveImageModel({ model: 'seedream-4.5', provider: 'gemini' })).toThrow(/不支持/);
  });

  it('publishes exactly three immutable Phase 1 skill versions', () => {
    expect(PHASE1_SKILLS).toHaveLength(3);
    expect(PHASE1_SKILLS.every((skill) => /^1\.0\.0$/.test(skill.version))).toBe(true);
  });
});
