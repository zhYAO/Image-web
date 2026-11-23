import { resolvePublicImageBase, validatePublicImageBase } from '../build/public-image-base.mjs';
import { publicExampleUrl, isDirectPublicExample } from '../features/commerce/public-example-images';

// Explicitly public examples/brand images only. Never rewrite API, signed,
// uploaded, object/data URLs, static-import objects or authentication paths.
export function publicAssetUrl(value: string): string {
  const base = resolvePublicImageBase(process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL, process.env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL);
  return publicExampleUrl(value, base);
}

export function usesDirectPublicImage(value: string): boolean {
  return isDirectPublicExample(value, validatePublicImageBase(process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL));
}
