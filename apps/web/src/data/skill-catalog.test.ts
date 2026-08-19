import { describe, expect, it } from 'vitest';

import { findSkillBySlug, loadSkillCatalog, skillCatalogSchema } from './skill-catalog';
import seed from './skills.json';

const firstSeed = seed[0];
if (!firstSeed) throw new Error('test seed must have at least one entry');

describe('skillCatalogSchema', () => {
  it('parses the static seed without errors', () => {
    const parsed = skillCatalogSchema.parse(seed);
    expect(parsed).toHaveLength(2);
  });

  it('rejects a seed with more than 3 steps', () => {
    const baseStep = firstSeed.latestVersion.steps[0];
    if (!baseStep) throw new Error('seed must have at least one step');
    const bad = [
      {
        ...firstSeed,
        latestVersion: {
          ...firstSeed.latestVersion,
          steps: [
            ...firstSeed.latestVersion.steps,
            baseStep,
            baseStep,
          ],
        },
      },
    ];
    expect(() => skillCatalogSchema.parse(bad)).toThrow();
  });
});

describe('loadSkillCatalog', () => {
  it('returns the full catalogue', async () => {
    const catalog = await loadSkillCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(2);
  });
});

describe('findSkillBySlug', () => {
  it('returns the matching entry', async () => {
    const catalog = await loadSkillCatalog();
    const entry = findSkillBySlug(catalog, 'white-background-product');
    expect(entry?.title).toBe('白底商品图');
  });

  it('returns null for an unknown slug', async () => {
    const catalog = await loadSkillCatalog();
    expect(findSkillBySlug(catalog, 'not-a-real-slug')).toBeNull();
  });
});