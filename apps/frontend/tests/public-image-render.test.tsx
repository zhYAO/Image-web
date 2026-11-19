import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import PublicExampleImage from '../../web/features/commerce/PublicExampleImage';
import { PreviewImage, ImageGallery } from '../../web/features/controls/PreviewImage';
import { publicAssetUrl } from '../src/platform/public-assets';
import { usesDirectPublicImage as nextDirect } from '../../web/lib/public-assets';
import { isDirectPublicExample } from '../../web/features/commerce/public-example-images';

const pinnedBase = 'https://www.zimage.store/static-assets/6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24';
const dialogMethods = ['showModal', 'close'] as const;
const originalDialog = dialogMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
beforeAll(() => {
  // jsdom lacks the native top layer. Emulate only its open bit for URL/component tests, not browser focus/accessibility acceptance.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterAll(() => dialogMethods.forEach((name, index) => {
  const descriptor = originalDialog[index];
  if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('renders actual dynamic apparel thumbnail and enlargement URLs without a static AST rewrite', () => {
  vi.stubGlobal('__ZIMAGE_PUBLIC_IMAGE_BASE__', pinnedBase);
  const files = [...Array.from({ length: 5 }, (_, index) => `main-${index + 1}`), 'detail-01', 'detail-03', 'detail-04', 'detail-05', 'detail-06', 'detail-07'];
  for (const file of files) {
    const preview = publicAssetUrl(`/commerce/apparel-v2/${file}.webp`);
    const original = publicAssetUrl(`/commerce/apparel-v2/${file}.jpg`);
    expect(isDirectPublicExample(preview, pinnedBase)).toBe(true);
    expect(isDirectPublicExample(original, pinnedBase)).toBe(true);
    render(<ImageGallery><PreviewImage src={preview} fullSource={original} alt="reviewed example" /></ImageGallery>);
    const image = screen.getByAltText('reviewed example');
    expect(image.getAttribute('src')).toBe(preview);
    fireEvent.click(image);
    expect([...document.querySelectorAll('img')].some(img => img.getAttribute('src') === original)).toBe(true);
    cleanup();
  }
});

it('uses the exact shared URL in the actual frontend image wrapper and limits the Next direct flag', () => {
  vi.stubGlobal('__ZIMAGE_PUBLIC_IMAGE_BASE__', pinnedBase);
  vi.stubEnv('ZIMAGE_PUBLIC_IMAGE_BASE_URL', pinnedBase);
  render(<PublicExampleImage src="/commerce/apparel-v2/main-1.webp" alt="homepage" width="280" height="350" />);
  const image = screen.getByAltText('homepage');
  expect(image.getAttribute('src')).toBe(pinnedBase + '/commerce/apparel-v2/main-1.webp');
  expect(image.hasAttribute('unoptimized')).toBe(false);
  expect(nextDirect(pinnedBase + '/commerce/apparel-v2/main-1.webp')).toBe(true);
  for (const value of ['/brand.svg', pinnedBase + '/commerce/unknown.webp', pinnedBase + '/commerce/apparel-v2/main-1.webp?x=1', 'https://other.test/commerce/apparel-v2/main-1.webp']) expect(nextDirect(value)).toBe(false);
  vi.stubEnv('ZIMAGE_PUBLIC_IMAGE_BASE_URL', '');
  expect(nextDirect(pinnedBase + '/commerce/apparel-v2/main-1.webp')).toBe(false);
});
