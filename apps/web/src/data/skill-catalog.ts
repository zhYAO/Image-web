import { z } from 'zod';

/**
 * Static seed schema for the Phase 1 /skills and /skills/[slug] pages.
 *
 * The shape mirrors `SkillVersion` from `doc/requirements.md` §4.7 but
 * drops the `inputSchema` field because the public catalogue only needs
 * a display projection — the full JSON Schema is enforced server-side
 * by the Skill publication RPC (SKILL-004), not by the browser.
 *
 * M6 reads this seed at request time inside the RSC; M7+ will replace
 * it with a read-only view once the `skills` / `skill_versions`
 * migrations land and the curation RPC is approved.
 */

const imageCapabilitySchema = z.enum([
  'generate',
  'remove_background',
  'replace_background',
  'outpaint_resize',
  'upscale',
]);

const skillStepSchema = z.object({
  capability: imageCapabilitySchema,
  inputBindings: z.array(z.string()).min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  outputCount: z.number().int().min(1).max(8),
});

const skillOutputContractSchema = z.object({
  minOutputs: z.number().int().min(1).max(8),
  maxOutputs: z.number().int().min(1).max(8),
  allowedFormats: z.array(z.enum(['jpeg', 'png', 'webp'])).min(1),
  requiresTransparency: z.boolean().optional(),
});

const skillVersionSchema = z.object({
  id: z.uuid(),
  skillId: z.uuid(),
  version: z.number().int().min(1),
  status: z.enum(['draft', 'published', 'retired']),
  allowedCapabilities: z.array(imageCapabilitySchema).min(1),
  requiredCapabilities: z.array(imageCapabilitySchema),
  steps: z.array(skillStepSchema).min(1).max(3),
  outputContract: skillOutputContractSchema,
});

export const skillCatalogEntrySchema = z.object({
  slug: z.string().min(1).max(128),
  title: z.string().min(1).max(128),
  summary: z.string().min(1).max(500),
  category: z.string().min(1).max(64),
  latestVersion: skillVersionSchema,
});

export const skillCatalogSchema = z.array(skillCatalogEntrySchema);

export type SkillCatalogEntry = z.infer<typeof skillCatalogEntrySchema>;
export type SkillCatalog = ReadonlyArray<SkillCatalogEntry>;

/**
 * Load and validate the static skill catalogue. Throws at request time
 * if the seed drifts from the schema — this is intentional so a bad
 * seed never silently renders an incomplete page.
 */
export const loadSkillCatalog = async (): Promise<SkillCatalog> => {
  const raw = (await import('./skills.json')).default as unknown;
  return skillCatalogSchema.parse(raw);
};

/**
 * Find a single skill by slug. Returns `null` when the slug is unknown
 * so the caller can render a 404 without throwing.
 */
export const findSkillBySlug = (
  catalog: SkillCatalog,
  slug: string,
): SkillCatalogEntry | null => catalog.find((entry) => entry.slug === slug) ?? null;