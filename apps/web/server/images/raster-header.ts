// Validate dimensions and the complete container before WebAssembly may allocate pixels.
export type RasterFormat = 'png' | 'jpeg' | 'webp';
export type RasterLimits = { maxBytes: number; maxEdge: number; maxPixels: number; expectedFormat?: RasterFormat };
export type RasterHeader = { format: RasterFormat; width: number; height: number; orientation: number; hasAlpha: boolean };
export class InvalidRaster extends Error {
  readonly reason: 'invalid' | 'too-large' | 'animated';
  constructor(reason: InvalidRaster['reason']) { super('raster_' + reason); this.reason = reason; }
}
const invalid = (): never => { throw new InvalidRaster('invalid'); };
const animated = (): never => { throw new InvalidRaster('animated'); };
const ascii = (b: Buffer, i: number, n: number) => b.toString('ascii', i, i + n);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i=0; i<8; i++) n=(n & 1) ? (n>>>1)^0xedb88320 : n>>>1;
  return n>>>0;
});
export function crc32(bytes: Uint8Array) {
  let crc=0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte)&255]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function exif(b: Buffer): number {
  if (ascii(b,0,6)==='Exif\0\0') b=b.subarray(6);
  if (b.length<8) return 1;
  const order=ascii(b,0,2);
  if(order!=='II' && order!=='MM') return 1;
  const u16=(n:number)=>order==='II'?b.readUInt16LE(n):b.readUInt16BE(n);
  const u32=(n:number)=>order==='II'?b.readUInt32LE(n):b.readUInt32BE(n);
  if(u16(2)!==42)return 1;
  const start=u32(4);
  if(start>b.length-2)return 1;
  const count=Math.min(u16(start),Math.floor((b.length-start-2)/12));
  for(let i=0;i<count;i++){
    const p=start+2+i*12;
    if(u16(p)===0x112&&u16(p+2)===3&&u32(p+4)===1){
      const v=u16(p+8);
      return v>=1&&v<=8?v:1;
    }
  }
  return 1;
}

function png(b:Buffer): RasterHeader {
  let p=8, width=0, height=0, orientation=1, hasAlpha=false, idat=false, ended=false, chunks=0;
  while(p<b.length){
    if(++chunks>32768 || p+12>b.length)invalid();
    const len=b.readUInt32BE(p), name=ascii(b,p+4,4), end=p+8+len;
    if(end+4>b.length||!/^[a-zA-Z]{4}$/.test(name)||crc32(b.subarray(p+4,end))!==b.readUInt32BE(end))invalid();
    const v=b.subarray(p+8,end);
    if(p===8&&name!=='IHDR')invalid();
    if(name==='IHDR'){
      if(p!==8||len!==13)invalid();
      width=v.readUInt32BE(0); height=v.readUInt32BE(4);
      hasAlpha=v[9]===4||v[9]===6;
    }
    if(name==='acTL'||name==='fcTL'||name==='fdAT')animated();
    if(name==='eXIf')orientation=exif(v);
    if(name==='tRNS')hasAlpha=true;
    if(name==='IDAT'&&len>0)idat=true;
    p=end+4;
    if(name==='IEND'){ if(len!==0||p!==b.length) invalid(); ended=true; break; }
  }
  if(!idat||!ended)invalid();
  return {format:'png',width,height,orientation,hasAlpha};
}

function jpeg(b:Buffer): RasterHeader {
  if(b.length<12 || b[b.length-2]!==0xff || b[b.length-1]!==0xd9)invalid();
  let p=2,width=0,height=0,orientation=1,chunks=0;
  while(p<b.length) {
    if(++chunks>32768 || b[p++]!==0xff)invalid();
    while(b[p]===0xff)p++;
    const type=b[p++];
    if(type===undefined || p+2>b.length || type===0 || type===0xd8 || type===0xd9 || (type>=0xd0&&type<=0xd7))invalid();
    const len=b.readUInt16BE(p);
    if(len<2 || p+len>b.length)invalid();
    if(type===0xda){ if(!width||!height||p+len>=b.length-2)invalid(); return {format:'jpeg',width,height,orientation,hasAlpha:false}; }
    if(type===0xe1&&ascii(b,p+2,6)==='Exif\0\0')orientation=exif(b.subarray(p+2,p+len));
    if(type>=0xc0 && type<=0xcf && ![0xc4,0xc8,0xcc].includes(type)){
      if(len<8||width||height)invalid();
      height=b.readUInt16BE(p+3);width=b.readUInt16BE(p+5);
    }
    p+=len;
  }
  return invalid();
}

function webp(b:Buffer): RasterHeader {
  if(b.length<20||b.readUInt32LE(4)!==b.length-8)invalid();
  let p=12,width=0,height=0,canvasWidth=0,canvasHeight=0,orientation=1,hasAlpha=false,frames=0,chunks=0;
  while(p<b.length){
    if(++chunks>32768||p+8>b.length)invalid();
    const n=ascii(b,p,4),len=b.readUInt32LE(p+4),end=p+8+len,next=end+(len&1);
    if(next>b.length || (len&1)&&b[end]!==0)invalid();
    const v=b.subarray(p+8,end);
    if(n==='ANIM'||n==='ANMF')animated();
    if(n==='VP8X'){
      if(p!==12||len!==10)invalid();
      if(v[0]!&2)animated();
      hasAlpha=Boolean(v[0]!&16);
      canvasWidth=1+v.readUIntLE(4,3); canvasHeight=1+v.readUIntLE(7,3);
    } else if(n==='VP8 '){
      if(++frames>1||len<10||v[3]!==0x9d||v[4]!==1||v[5]!==0x2a)invalid();
      width=v.readUInt16LE(6)&0x3fff;height=v.readUInt16LE(8)&0x3fff;
    } else if(n==='VP8L'){
      if(++frames>1||len<5||v[0]!==0x2f)invalid();
      const bits=v.readUInt32LE(1);
      if(bits>>>29)invalid();
      width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;
      hasAlpha ||= Boolean((bits>>>28)&1);
    } else if(n==='ALPH')hasAlpha=true;
    else if(n==='EXIF')orientation=exif(v);
    p=next;
  }
  if(frames!==1||(canvasWidth&&(canvasWidth!==width||canvasHeight!==height)))invalid();
  return {format:'webp',width,height,orientation,hasAlpha};
}

export function inspectRaster(bytes:Uint8Array,limits:RasterLimits): RasterHeader{
  if(bytes.length>limits.maxBytes)throw new InvalidRaster('too-large');
  if(bytes.length<12)invalid();
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let meta:RasterHeader;
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))meta=png(b);
  else if(b[0]===255&&b[1]===216&&b[2]===255)meta=jpeg(b);
  else if(ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP')meta=webp(b);
  else return invalid();
  if(!meta.width||!meta.height||limits.expectedFormat&&limits.expectedFormat!==meta.format)invalid();
  if(meta.width>limits.maxEdge||meta.height>limits.maxEdge||meta.width*meta.height>limits.maxPixels)throw new InvalidRaster('too-large');
  return meta;
}
