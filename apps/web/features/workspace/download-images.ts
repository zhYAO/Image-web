import type { GenerationBatch } from '@zimage/domain';

/** Cross-origin download attributes are ignored; download a local blob to keep the workspace open. */
export async function downloadImages(batch: GenerationBatch, isCurrent: () => boolean = () => true) {
  let downloaded = 0;
  let failed = 0;
  for (const [index, asset] of batch.assets.entries()) {
    if (!isCurrent()) break;
    if (!asset.url || asset.expired || asset.status !== 'succeeded') continue;
    try {
      const response = await fetch(asset.url, { credentials: 'omit', signal: AbortSignal.timeout(30_000) });
      if (!isCurrent()) break;
      if (!response.ok) throw new Error('Image download failed');
      const blob = await response.blob();
      if (!isCurrent()) break;
      const extension = new URL(asset.url, window.location.href).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'png';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `zimage-${batch.id}-${index + 1}.${extension}`;
        document.body.append(link);
        link.click();
        downloaded += 1;
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      failed += 1;
    }
  }
  return { downloaded, failed };
}
