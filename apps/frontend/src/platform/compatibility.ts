import { apiMetaSchema, frontendApiRequirementsSchema } from '@zimage/domain';

// Candidate runtime requirements and release identity allowlist only. This gate
// does not certify combination acceptance or authorize production publication.
export type RuntimeCompatibility = { compatible: boolean; issues: string[] };

export function checkRuntimeCompatibility(descriptor: unknown, metaInput: unknown): RuntimeCompatibility {
  const issues: string[] = [];
  const input = descriptor && typeof descriptor === 'object' ? descriptor as Record<string, unknown> : undefined;
  const requirements = frontendApiRequirementsSchema.safeParse(input?.apiRequirements);
  const releases = input?.allowedBackendReleases;
  const validReleases = Array.isArray(releases) && releases.length > 0 && releases.length <= 256
    && releases.every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    && new Set(releases).size === releases.length;
  if (!input || Object.keys(input).some(key => !['apiRequirements', 'allowedBackendReleases'].includes(key)) || Object.hasOwn(input, '__proto__') || !requirements.success || !validReleases) issues.push('invalid_descriptor');
  const meta = apiMetaSchema.safeParse(metaInput);
  if (!meta.success) issues.push('invalid_api_meta');
  if (issues.length || !requirements.success || !meta.success || !Array.isArray(releases)) return { compatible: false, issues };
  if (requirements.data.major !== meta.data.api.major) issues.push('api_major_mismatch');
  else if (requirements.data.minMinor > meta.data.api.minor) issues.push('api_minor_too_low');
  if (requirements.data.capabilities.some(capability => !meta.data.capabilities.includes(capability))) issues.push('missing_capability');
  if (!releases.includes(meta.data.backendRelease)) issues.push('backend_not_allowed');
  return { compatible: issues.length === 0, issues };
}
