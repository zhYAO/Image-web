import { isPublicExamplePath, publicExampleUrl, isDirectPublicExample } from '../../../web/features/commerce/public-example-images';

/** Only approved public catalogue images receive the immutable release prefix. */
export function publicAssetUrl(value: string): string {
  if (!isPublicExamplePath(value)) return value;
  const external = typeof __ZIMAGE_PUBLIC_IMAGE_BASE__ === 'string' ? __ZIMAGE_PUBLIC_IMAGE_BASE__ : '';
  if (external) return publicExampleUrl(value, external);
  const namespace = typeof __ZIMAGE_ASSET_NAMESPACE__ === 'string' ? __ZIMAGE_ASSET_NAMESPACE__ : '';
  return namespace ? `/frontend-assets/${namespace}${value}` : value;
}

export function usesDirectPublicImage(value: string): boolean {
  return isDirectPublicExample(value, typeof __ZIMAGE_PUBLIC_IMAGE_BASE__ === 'string' ? __ZIMAGE_PUBLIC_IMAGE_BASE__ : undefined);
}
