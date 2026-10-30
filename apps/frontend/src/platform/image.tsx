import { forwardRef, type ImgHTMLAttributes } from 'react';
import { publicAssetUrl } from './public-assets';

// Existing public images already declare dimensions and WebP sources. No
// private URL, signature, blob or API route is passed through an optimizer.
const Image = forwardRef<HTMLImageElement, ImgHTMLAttributes<HTMLImageElement>>(function Image({ src, alt, ...props }, ref) {
  // eslint-disable-next-line @next/next/no-img-element -- Static host has no Next image optimization route; public WebP sources retain dimensions.
  return <img {...props} ref={ref} src={typeof src === 'string' ? publicAssetUrl(src) : src} alt={alt ?? ''} />;
});
export default Image;
