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
    expect(() => resolveImageModel({ model: 'seedream-5.0-flash', provider: 'gemini' })).toThrow(/不支持/);
  });

  it('only advertises Seedream resolutions accepted by the configured 5.0 models', () => {
    expect(resolveImageModel({ model: 'seedream-5.0-flash', provider: 'seedream' }).capability.resolutions)
      .toEqual(['2K']);
  });

  it('keeps the configured Gemini 1K and 2K resolutions available', () => {
    expect(resolveImageModel({ model: 'gemini-3-pro-image', provider: 'gemini' }).capability.resolutions)
      .toEqual(['1K', '2K']);
  });

  it('publishes exactly three official versioned skills without execution instructions', () => {
    expect(PHASE1_SKILLS).toHaveLength(3);
    expect(PHASE1_SKILLS.every((skill) => !('promptTemplate' in skill) && !('fields' in skill))).toBe(true);
    expect(PHASE1_SKILLS.every((skill) => /^2\.0\.0$/.test(skill.version))).toBe(true);
  });
});
