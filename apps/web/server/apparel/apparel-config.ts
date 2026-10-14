/** Retired runtime opt-in after the failed gate; Reader remains research-only. */
export function isApparelSourceReuseEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  return false;
}
