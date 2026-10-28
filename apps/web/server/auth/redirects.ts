const PROTECTED_PREFIXES = ['/api', '/auth'];

export function normalizeReturnTo(value: string | null | undefined) {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/workspace';
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || PROTECTED_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return '/workspace';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/workspace';
  }
}
