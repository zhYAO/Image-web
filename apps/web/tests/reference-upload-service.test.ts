import { describe, expect, it } from 'vitest';

import { validateReferenceUpload } from '@/server/assets/reference-upload-service';

const png = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
));

describe('reference upload validation', () => {
  it('accepts a decoded PNG and returns trusted dimensions', async () => {
    await expect(validateReferenceUpload({
      bytes: png,
      mimeType: 'image/png',
      name: 'reference.png',
      size: png.byteLength,
    })).resolves.toMatchObject({ extension: 'png', height: 1, width: 1 });
  });

  it('rejects MIME/extension spoofing before Storage upload', async () => {
    await expect(validateReferenceUpload({
      bytes: Uint8Array.from(Buffer.from('<svg><script /></svg>')),
      mimeType: 'image/png',
      name: 'attack.png',
      size: 22,
    })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(validateReferenceUpload({
      bytes: png,
      mimeType: 'image/png',
      name: 'reference.svg',
      size: png.byteLength,
    })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('rejects payloads above the fixed 10 MB limit before decoding', async () => {
    await expect(validateReferenceUpload({
      bytes: png,
      mimeType: 'image/png',
      name: 'large.png',
      size: 10 * 1024 * 1024 + 1,
    })).rejects.toMatchObject({ code: 'bad_request' });
  });
});
