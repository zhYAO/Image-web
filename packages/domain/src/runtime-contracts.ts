import { z } from 'zod';

function strictRuntimeObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess((input, context) => {
    // Zod intentionally skips this key when copying object properties. Our
    // wire contracts require rejecting undeclared fields, including this one.
    if (input !== null && typeof input === 'object' && Object.hasOwn(input, '__proto__')) {
      context.addIssue({ code: 'custom', message: 'Unexpected runtime contract field' });
      return z.NEVER;
    }
    return input;
  }, z.strictObject(shape));
}

const nonnegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const releaseIdentifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const publicValue = z.string().min(1).refine(
  (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value),
  { message: 'Expected a nonblank public value without control characters' },
);

// Only these fields may cross the public configuration boundary. In particular,
// browser Supabase credentials are not part of this HTTP-only contract.
export const publicConfigSchema = strictRuntimeObject({
  schemaVersion: z.literal(1),
  formalAuth: z.boolean(),
  dataMode: z.literal('http'),
  captchaSiteKey: publicValue.max(2048).nullable(),
  approvedLegalVersion: publicValue.max(80).nullable(),
  registrationEnabled: z.boolean(),
}).superRefine((config, context) => {
  if (config.registrationEnabled && (
    !config.formalAuth || config.approvedLegalVersion === null || config.captchaSiteKey === null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['registrationEnabled'],
      message: 'Registration requires formal authentication, approved legal version and captcha site key',
    });
  }
});

const capabilitySchema = z.string().min(1).max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/);
const capabilitiesSchema = z.array(capabilitySchema).max(256).refine(
  (values) => new Set(values).size === values.length,
  { message: 'Capabilities must be unique' },
);

// Capabilities describe implemented protocol semantics, not dependency health,
// account permissions, provider availability or permission to charge a user.
export const apiMetaSchema = strictRuntimeObject({
  schemaVersion: z.literal(1),
  backendRelease: releaseIdentifier,
  api: strictRuntimeObject({ major: z.literal(1), minor: nonnegativeInteger }),
  capabilities: capabilitiesSchema,
});

export const frontendApiRequirementsSchema = strictRuntimeObject({
  major: nonnegativeInteger.min(1),
  minMinor: nonnegativeInteger,
  capabilities: capabilitiesSchema,
});

const payloadPathSchema = z.string().min(1).max(1024).refine((path) => {
  if (/[\u0000-\u001f\u007f\\%<>:"|?*#]/.test(path)) return false;
  return path.split('/').every((segment) => (
    segment.length > 0 && !segment.startsWith('.') && !/[. ]$/.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  ));
}, { message: 'Expected a portable relative payload path without hidden or traversal segments' });

// This index covers payload files only. Internal .release metadata (including
// this index and the manifest) is excluded to avoid recursive content hashes.
// Filesystem type, actual bytes/digests and dist content are checked by the
// future artifact verifier; schema validation alone cannot prove those facts.
export const frontendFileIndexSchema = strictRuntimeObject({
  schemaVersion: z.literal(1),
  files: z.array(strictRuntimeObject({
    path: payloadPathSchema,
    bytes: nonnegativeInteger,
    sha256,
  })).min(1),
}).superRefine((index, context) => {
  const paths = new Set<string>();
  for (const [position, file] of index.files.entries()) {
    const normalized = file.path.normalize('NFC').toLowerCase();
    if (paths.has(normalized)) {
      context.addIssue({ code: 'custom', path: ['files', position, 'path'], message: 'Payload paths must be unique across supported filesystems' });
    }
    paths.add(normalized);
  }
});

export const frontendManifestSchema = strictRuntimeObject({
  schemaVersion: z.literal(1),
  // Chosen before building, for /frontend-assets/<assetNamespace>/ URLs.
  assetNamespace: releaseIdentifier,
  // Computed after building from the payload index and public config digest;
  // it is not a Git SHA, namespace or digest of this manifest itself.
  artifactId: sha256,
  sourceSHA: z.string().regex(/^[a-f0-9]{40}$/),
  treeFingerprint: sha256,
  build: strictRuntimeObject({
    toolchainFingerprint: sha256,
    lockfileSha256: sha256,
    publicConfigFingerprint: sha256,
  }),
  fileIndex: strictRuntimeObject({
    path: z.literal('.release/file-index.json'),
    sha256,
    fileCount: nonnegativeInteger.min(1),
    totalBytes: nonnegativeInteger,
  }),
  apiRequirements: frontendApiRequirementsSchema,
  verifiedBackendReleases: z.array(releaseIdentifier).min(1).max(256).refine(
    (values) => new Set(values).size === values.length,
    { message: 'Verified backend releases must be unique' },
  ),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type ApiMeta = z.infer<typeof apiMetaSchema>;
export type FrontendApiRequirements = z.infer<typeof frontendApiRequirementsSchema>;
export type FrontendFileIndex = z.infer<typeof frontendFileIndexSchema>;
export type FrontendManifest = z.infer<typeof frontendManifestSchema>;

export type FrontendCompatibilityIssue =
  | { code: 'invalid_manifest' }
  | { code: 'invalid_api_meta' }
  | { code: 'api_major_mismatch'; required: number; actual: number }
  | { code: 'api_minor_too_low'; required: number; actual: number }
  | { code: 'missing_capability'; capability: string }
  | { code: 'backend_not_verified'; backendRelease: string };

export type FrontendCompatibility =
  | { compatible: true; issues: [] }
  | { compatible: false; issues: FrontendCompatibilityIssue[] };

/** Fail closed for untrusted input; never include raw validation values in errors. */
export function checkFrontendCompatibility(manifestInput: unknown, metaInput: unknown): FrontendCompatibility {
  const manifest = frontendManifestSchema.safeParse(manifestInput);
  const meta = apiMetaSchema.safeParse(metaInput);
  const issues: FrontendCompatibilityIssue[] = [];
  if (!manifest.success) issues.push({ code: 'invalid_manifest' });
  if (!meta.success) issues.push({ code: 'invalid_api_meta' });
  if (!manifest.success || !meta.success) return { compatible: false, issues };

  const required = manifest.data.apiRequirements;
  const actual = meta.data.api;
  if (required.major !== actual.major) {
    issues.push({ code: 'api_major_mismatch', required: required.major, actual: actual.major });
  } else if (actual.minor < required.minMinor) {
    issues.push({ code: 'api_minor_too_low', required: required.minMinor, actual: actual.minor });
  }
  const availableCapabilities = new Set(meta.data.capabilities);
  for (const capability of required.capabilities) {
    if (!availableCapabilities.has(capability)) issues.push({ code: 'missing_capability', capability });
  }
  if (!manifest.data.verifiedBackendReleases.includes(meta.data.backendRelease)) {
    issues.push({ code: 'backend_not_verified', backendRelease: meta.data.backendRelease });
  }
  return issues.length > 0 ? { compatible: false, issues } : { compatible: true, issues: [] };
}
