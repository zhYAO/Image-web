// Candidate build inputs only. Production acceptance and the formal release
// manifest are supplied independently by the release packager after testing.
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = /^[a-f0-9]{64}$/;
const capability = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const objectWithKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uniqueStrings = (value, pattern, minimum = 0, maximumLength = 128) => Array.isArray(value) && value.length >= minimum && value.length <= 256
  && value.every(item => typeof item === 'string' && item.length <= maximumLength && pattern.test(item)) && new Set(value).size === value.length;
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function validateCandidateDescriptor(value) {
  const requirements = value?.apiRequirements;
  if (!objectWithKeys(value, ['apiRequirements', 'allowedBackendReleases'])
    || !objectWithKeys(requirements, ['major', 'minMinor', 'capabilities'])
    || !integer(requirements.major) || requirements.major < 1 || !integer(requirements.minMinor)
    || !uniqueStrings(requirements.capabilities, capability, 0, 100)
    || !uniqueStrings(value.allowedBackendReleases, identifier, 1)) throw new Error('Invalid frontend candidate descriptor');
  return value;
}

export function validateCandidateMetadata(value, namespace) {
  if (!objectWithKeys(value, ['schemaVersion', 'namespace', 'apiRequirements', 'allowedBackendReleases', 'sourceIdentity', 'buildToolchainFingerprint'])
    || value.schemaVersion !== 1 || typeof value.namespace !== 'string' || !identifier.test(value.namespace)
    || value.namespace !== namespace || value.namespace === 'none'
    || !objectWithKeys(value.sourceIdentity, ['sourceSHA', 'treeFingerprint', 'lockfileSha256', 'dirty'])
    || typeof value.sourceIdentity.sourceSHA !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceIdentity.sourceSHA)
    || typeof value.sourceIdentity.treeFingerprint !== 'string' || !sha256.test(value.sourceIdentity.treeFingerprint)
    || typeof value.sourceIdentity.lockfileSha256 !== 'string' || !sha256.test(value.sourceIdentity.lockfileSha256)
    || typeof value.sourceIdentity.dirty !== 'boolean'
    || typeof value.buildToolchainFingerprint !== 'string' || !sha256.test(value.buildToolchainFingerprint)) throw new Error('Invalid frontend candidate metadata');
  validateCandidateDescriptor({ apiRequirements: value.apiRequirements, allowedBackendReleases: value.allowedBackendReleases });
  return value;
}
