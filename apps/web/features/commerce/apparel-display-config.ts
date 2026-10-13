/** Next production builds inline the lock; a public opt-in cannot override it. */
export function isApparelVisibleLoadingEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED === "true";
}
