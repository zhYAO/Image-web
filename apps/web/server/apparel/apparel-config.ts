/** Unaccepted optimization: production stays off until an explicit code review. */
export function isApparelSourceReuseEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED === "true";
}
