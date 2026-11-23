import Image from 'next/image';
import type { ComponentProps } from 'react';
import { publicAssetUrl, usesDirectPublicImage } from '@/lib/public-assets';

/** Only the configured, reviewed examples bypass Next's optimizer. */
export default function PublicExampleImage(props: ComponentProps<typeof Image>) {
  const src = typeof props.src === 'string' ? publicAssetUrl(props.src) : props.src;
  const direct = typeof src === 'string' && usesDirectPublicImage(src);
  return <Image {...props} src={src} {...(direct ? { unoptimized: true } : {})} />;
}
