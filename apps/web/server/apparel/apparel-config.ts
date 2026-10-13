/** Runtime opt-in, sampled once per authorized claim. No credential is involved. */
export function isApparelSourceReuseEnabled() {
  return process.env.ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED === "true";
}
