import { vi } from 'vitest';

// Encoded by Sharp and fully decoded before use: 64x48 RGBA, alpha 0.4.
export const referencePng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAlklEQVRogeXOMQEAIAzAsOqcAFxgDW2TkYMjf7rzzs/SAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gFtAWUlxVqOXnasAAAAAElFTkSuQmCC', 'base64'));

export const referenceJpeg = Uint8Array.from(Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAwAEADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AlANkqAAAAAAAAAAAAAAAAAAAAAAf/9k=', 'base64'));
export const referenceWebp = Uint8Array.from(Buffer.from('UklGRkYAAABXRUJQVlA4IDoAAABQAwCdASpAADAAPm02mEkkIyKhIqgAgA2JZwAAFaRH1jzZYAD+5AF//+Sn/3lf67tw38GW2wQAAAAA', 'base64'));

export const readReferenceBytes = (file: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(file);
});

export function stubReferenceBitmap() {
  const close = vi.fn();
  const decode = vi.fn().mockResolvedValue({ width: 64, height: 48, close });
  vi.stubGlobal('createImageBitmap', decode);
  return { decode, close };
}
