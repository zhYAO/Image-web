/** Only approved public catalogue images receive the immutable release prefix. */
export function publicAssetUrl(value: string): string {
  if (!value.startsWith('/commerce/') || /[?#\\%\u0000-\u001f\u007f]/.test(value)
    || value.split('/').slice(1).some(part => !part || part === '.' || part === '..')) return value;
  const namespace = typeof __ZIMAGE_ASSET_NAMESPACE__ === 'string' ? __ZIMAGE_ASSET_NAMESPACE__ : '';
  return namespace ? `/frontend-assets/${namespace}${value}` : value;
}
