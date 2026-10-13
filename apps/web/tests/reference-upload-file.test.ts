import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeReferenceUploadFile } from '@/gateways/reference-upload-file';
import { readReferenceBytes, referenceJpeg, referencePng, referenceWebp, stubReferenceBitmap } from './reference-file-fixtures';

let bitmap: ReturnType<typeof stubReferenceBitmap>;
beforeEach(() => { bitmap = stubReferenceBitmap(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('readable reference upload copies', () => {
  it.each([
    { bytes: referenceJpeg, name: 'photo.png', expectedName: 'photo.jpg', mime: 'image/jpeg' },
    { bytes: referenceWebp, name: 'photo.jpg', expectedName: 'photo.webp', mime: 'image/webp' },
  ])('preserves $mime bytes when the supplied suffix/type are incorrect', async ({ bytes, name, expectedName, mime }) => {
    const prepared = await normalizeReferenceUploadFile(new File([bytes], name, { type: 'image/png' }));
    expect(prepared.name).toBe(expectedName);
    expect(prepared.type).toBe(mime);
    expect(await readReferenceBytes(prepared)).toEqual(bytes);
  });
  it('corrects the misleading JPEG name/type of PNG bytes without changing the original or transparency bytes', async () => {
    const original = new File([referencePng], '微信图片_20260831201450_3011_4.jpg', { type: 'image/jpeg', lastModified: 1234 });
    const prepared = await normalizeReferenceUploadFile(original);
    expect(prepared.name).toBe('微信图片_20260831201450_3011_4.png');
    expect(prepared.type).toBe('image/png');
    expect(prepared.lastModified).toBe(1234);
    expect(await readReferenceBytes(prepared)).toEqual(await readReferenceBytes(original));
    expect(original.name).toMatch(/\.jpg$/);
    expect(original.type).toBe('image/jpeg');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('keeps an already usable PNG file unchanged', async () => {
    const original = new File([referencePng], 'photo.PNG', { type: 'image/png' });
    expect(await normalizeReferenceUploadFile(original)).toBe(original);
    expect(bitmap.decode).toHaveBeenCalledOnce();
  });
  it('does not rely on a missing MIME or unsupported filename to identify valid raster bytes', async () => {
    const original = new File([referencePng], 'photo.data');
    const prepared = await normalizeReferenceUploadFile(original);
    expect(prepared.name).toBe('photo.png');
    expect(prepared.type).toBe('image/png');
  });
  it('rejects SVG or unknown contents before attempting a browser image decode', async () => {
    await expect(normalizeReferenceUploadFile(new File(['<svg><script /></svg>'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toMatchObject({ safe: { code: 'BAD_REQUEST' } });
    expect(bitmap.decode).not.toHaveBeenCalled();
  });
  it('does not allow a forged PNG prefix or corrupt image through a metadata rename', async () => {
    bitmap.decode.mockRejectedValueOnce(new Error('cannot decode'));
    const forged = new File([referencePng.slice(0, 12)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(normalizeReferenceUploadFile(forged)).rejects.toMatchObject({ safe: { code: 'BAD_REQUEST' } });
  });
  it('rejects oversized files before decoding', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' });
    await expect(normalizeReferenceUploadFile(file)).rejects.toMatchObject({ safe: { code: 'BAD_REQUEST', message: expect.stringContaining('10 MB') } });
    expect(bitmap.decode).not.toHaveBeenCalled();
  });
  it('retains the pixel limit and closes an oversized decoded bitmap', async () => {
    bitmap.decode.mockResolvedValueOnce({ width: 16385, height: 1, close: bitmap.close });
    await expect(normalizeReferenceUploadFile(new File([referencePng], 'photo.png', { type: 'image/png' }))).rejects.toMatchObject({ safe: { code: 'BAD_REQUEST' } });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('uses and releases the Image fallback when ImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const created = vi.fn(() => 'blob:reference');
    const revoked = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = created;
      static revokeObjectURL = revoked;
    });
    class DecodedImage {
      naturalWidth = 64;
      naturalHeight = 48;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      removeAttribute() {}
    }
    vi.stubGlobal('Image', DecodedImage);
    await expect(normalizeReferenceUploadFile(new File([referencePng], 'photo.jpg', { type: 'image/jpeg' }))).resolves.toMatchObject({ name: 'photo.png', type: 'image/png' });
    expect(created).toHaveBeenCalledOnce();
    expect(revoked).toHaveBeenCalledWith('blob:reference');
  });
});
