/** Next inlines this public boolean at build time; it is independent of reuse. */
export function isApparelVisibleLoadingEnabled() {
  return process.env.NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED === "true";
}
