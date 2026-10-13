import { WorkspaceError } from '@zimage/domain';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 16_384;
const formats = {
  'image/png': { extension: 'png', aliases: ['png'] },
  'image/jpeg': { extension: 'jpg', aliases: ['jpg', 'jpeg'] },
  'image/webp': { extension: 'webp', aliases: ['webp'] },
} as const;
type ImageMime = keyof typeof formats;

function unreadable(message = '这张图片无法读取，请另存为 PNG、JPEG 或 WebP 后重试。') {
  return new WorkspaceError({ code: 'BAD_REQUEST', message, retryable: false });
}

function readHeader(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reader.onabort = () => reject(unreadable('图片读取失败，请重新选择这张图片。'));
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

function imageMime(bytes: Uint8Array): ImageMime | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
}

async function dimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try { return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }
  const image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(unreadable());
    });
    image.src = url;
    await loaded;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

export async function normalizeReferenceUploadFile(file: File): Promise<File> {
  if (file.size > MAX_BYTES) throw unreadable('每张参考图不能超过 10 MB。');
  if (file.size === 0) throw unreadable();
  const mime = imageMime(await readHeader(file));
  if (!mime) throw unreadable();
  // Decode only supported raster contents with the detected MIME. The original
  // filename/type may be incorrect; neither authorizes untrusted contents.
  let decoded: { width: number; height: number };
  try { decoded = await dimensions(new Blob([file], { type: mime })); }
  catch { throw unreadable(); }
  if (decoded.width < 1 || decoded.height < 1) throw unreadable();
  if (decoded.width > MAX_DIMENSION || decoded.height > MAX_DIMENSION) {
    throw unreadable(`图片尺寸过大，最长边不能超过 ${MAX_DIMENSION} 像素。`);
  }
  const format = formats[mime];
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (file.type === mime && (format.aliases as readonly string[]).includes(extension)
    && file.name.trim() && file.name.length <= 255) return file;
  const basename = file.name.split(/[/\\]/).at(-1) ?? '';
  const stem = basename.replace(/\.[^.]*$/, '').trim() || 'reference';
  const name = `${stem.slice(0, 254 - format.extension.length)}.${format.extension}`;
  // Metadata-only copy: preserve the source bytes, EXIF and transparency.
  return new File([file], name, { type: mime, lastModified: file.lastModified });
}
