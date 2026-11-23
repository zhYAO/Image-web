import { decodeRaster, writeRaster } from '@/server/images/raster-engine';
export async function solid(width: number, height: number, color: string, marks: Array<[number, number, number, number, string]> = [], alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (x: number, y: number, w: number, h: number, hex: string, a: number) => {
    const rgb = Number.parseInt(hex.slice(1), 16);
    for (let row=y; row<y+h; row++) for (let col=x; col<x+w; col++) {
      const i = 4 * (row * width + col);
      data[i] = rgb >>> 16; data[i+1] = (rgb >>> 8) & 255; data[i+2] = rgb & 255; data[i+3] = a;
    }
  };
  fill(0, 0, width, height, color, alpha);
  for (const mark of marks) fill(...mark,255);
  return Buffer.from(await writeRaster({width,height,data},'png'));
}
export async function rgb(bytes: Uint8Array) {
  const {pixels, meta: info} = await decodeRaster(bytes);
  const data = Buffer.alloc(3 * info.width * info.height);
  for (let i=0, j=0; i<pixels.data.length; i+=4,j+=3) data.set(pixels.data.subarray(i,i+3),j);
  return {data,info};
}
export async function exifJpeg(bytes: Uint8Array, orientation: number) {
  const image = (await decodeRaster(bytes)).pixels;
  const jpeg = Buffer.from(await writeRaster(image,'jpg'));
  const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000000000000000000','hex');
  exif.writeUInt16LE(orientation,28);
  return Buffer.concat([jpeg.subarray(0,2),exif,jpeg.subarray(2)]);
}
