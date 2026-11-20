import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// pnpm test tasks and the Next standalone server both run from apps/web.
const requireAtApp=createRequire(path.join(process.cwd(),'package.json'));
const table={
  jpegEnc:[()=>import('@jsquash/jpeg/encode.js'),'@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'],
  jpegDec:[()=>import('@jsquash/jpeg/decode.js'),'@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'],
  pngEnc:[()=>import('@jsquash/png/encode.js'),'@jsquash/png/codec/pkg/squoosh_png_bg.wasm'],
  pngDec:[()=>import('@jsquash/png/decode.js'),'@jsquash/png/codec/pkg/squoosh_png_bg.wasm'],
  webpDec:[()=>import('@jsquash/webp/decode.js'),'@jsquash/webp/codec/dec/webp_dec.wasm'],
};
const modules=new Map(), binaries=new Map();
async function codec(key) {
  if(!modules.has(key)){
    const pending=(async()=>{
      const [load,binaryName]=table[key];
      const binary=requireAtApp.resolve(binaryName);
      if(!binaries.has(binary)){
        const compiled=readFile(binary).then(b=>WebAssembly.compile(b));
        binaries.set(binary,compiled);
        compiled.catch(()=>{ if(binaries.get(binary)===compiled)binaries.delete(binary); });
      }
      if(typeof globalThis.ImageData==='undefined'){
        // PNG's Rust bindings construct ImageData; Node has no browser object.
        globalThis.ImageData=class ImageData{
          constructor(data,width,height){this.data=data;this.width=width;this.height=height;}
        };
      }
      const imported=await load();
      await imported.init(await binaries.get(binary));
      return imported.default;
    })();
    modules.set(key,pending);
    pending.catch(()=>{if(modules.get(key)===pending)modules.delete(key);});
  }
  return modules.get(key);
}
export async function decodeRasterPixels(bytes,format) {
  const decode=await codec(format+'Dec');
  return decode(Uint8Array.from(bytes).buffer,format==='jpeg'?{preserveOrientation:false}:undefined);
}
export async function encodeRasterPixels(image,format,quality=92) {
  const encode=await codec(format+'Enc');
  return Buffer.from(await encode(image,format==='jpeg'?{quality}:undefined));
}
