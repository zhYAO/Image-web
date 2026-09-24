import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { validateReferenceUpload } from '@/server/assets/reference-upload-service';

const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['2001:db8::',32],['::ffff:0:0',96]] as const) blocked.addSubnet(ip, bits, 'ipv6');

export function assertPublicImportUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !url.hostname || url.href.length > 2048) throw new Error('仅支持公开 HTTPS 商品链接。');
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('请使用公开商品域名。');
  return url;
}
async function publicAddress(host: string) {
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => blocked.check(entry.address, entry.family === 4 ? 'ipv4' : 'ipv6'))) throw new Error('商品链接无法安全访问，请上传参考图。');
  return addresses[0]!;
}
async function fetchPublic(url: URL, maxBytes: number, redirects = 0): Promise<{ bytes: Uint8Array; contentType: string; url: URL }> {
  if (redirects > 3) throw new Error('商品链接跳转过多，请上传参考图。');
  const address = await publicAddress(url.hostname);
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const call = httpsRequest(url, { timeout: 15_000, headers: { accept: 'text/html,image/png,image/jpeg,image/webp', 'user-agent': 'ZImage-commerce-import/1.0' },
      lookup: (_host, _options, callback) => callback(null, address.address, address.family) }, resolve);
    call.on('error', reject); call.on('timeout', () => call.destroy(new Error('商品链接读取超时，请上传参考图。'))); call.end();
  });
  if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    return fetchPublic(assertPublicImportUrl(new URL(response.headers.location, url).href), maxBytes, redirects + 1);
  }
  if (response.statusCode !== 200 || Number(response.headers['content-length'] ?? 0) > maxBytes) { response.resume(); throw new Error('商品链接无法读取，请上传参考图。'); }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maxBytes) { response.destroy(); throw new Error('商品链接图片超过 10 MB，请上传较小图片。'); }
    chunks.push(bytes);
  }
  return { bytes: Buffer.concat(chunks), contentType: String(response.headers['content-type'] ?? '').split(';')[0]!.toLowerCase(), url };
}

export async function importPublicProductImage(raw: string) {
  const page = await fetchPublic(assertPublicImportUrl(raw), 1_000_000);
  let imageUrl = page.url;
  let image = page;
  if (page.contentType === 'text/html') {
    const html = new TextDecoder().decode(page.bytes);
    const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
    const tag = tags.find(value => /(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/i.test(value));
    const candidate = tag?.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&');
    if (!candidate) throw new Error('未找到公开商品图片，请保留链接并手动上传参考图。');
    imageUrl = assertPublicImportUrl(new URL(candidate, page.url).href);
    image = await fetchPublic(imageUrl, 10 * 1024 * 1024);
  }
  const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType === 'image/png' ? 'png' : image.contentType === 'image/webp' ? 'webp' : undefined;
  if (!extension) throw new Error('链接未提供可用的 JPG、PNG 或 WebP 图片，请手动上传。');
  await validateReferenceUpload({ bytes: image.bytes, mimeType: image.contentType, name: `imported-product.${extension}`, size: image.bytes.byteLength });
  return { bytes: image.bytes, mimeType: image.contentType, name: `imported-product.${extension}`, sourceUrl: imageUrl.href };
}
