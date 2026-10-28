export function safeReturnTo(value: string | null | undefined, fallback = '/workspace') {
  if (!value?.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || ['/api', '/auth'].some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
