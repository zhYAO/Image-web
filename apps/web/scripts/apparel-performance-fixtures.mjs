// Fixed synthetic RGB pixels; no user photos or model calls.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { seededRandom } from "./apparel-performance-statistics.mjs";
export const fixtureSeed = 20261013;
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function createFixtures(sharp, directory, beforeSource=async()=>{}) {
  await fs.mkdir(directory, { recursive: true });
  const cases = [];
  for (const [name, width, height, displays, pad] of [
    ["normal", 750, 1000, 1, false],
    ["oversize", 750, 1000, 20, true],
    ["large-pixels", 3000, 4000, 1, false],
  ]) {
    const entries = [];
    for (let index = 0; index < 6; index++) {
      await beforeSource();
      // Xorshift uses deterministic integer pixels; distinct seeds produce distinct views.
      let x = (fixtureSeed + index * 101) >>> 0;
      const raw = Buffer.allocUnsafe(width * height * 3);
      for (let j = 0; j < raw.length; j++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        raw[j] = x & 255;
      }
      let bytes = await sharp(raw, { raw: { width, height, channels: 3 } })
        .jpeg({
          quality: name === "large-pixels" ? 78 : 85,
          chromaSubsampling: "4:2:0",
        })
        .toBuffer();
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error("fixture exceeds upload admission");
      if (pad)
        bytes = Buffer.concat([
          bytes,
          Buffer.alloc(10 * 1024 * 1024 - bytes.length),
        ]);
      const file = `${name}-photo-${index}.jpg`;
      await fs.writeFile(path.join(directory, file), bytes);
      const meta = await sharp(bytes).metadata();
      if (meta.width !== width || meta.height !== height)
        throw new Error("decoded dimensions mismatch");
      entries.push({
        file,
        width,
        height,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const logo = await sharp(
      Buffer.from(
        '<svg width="200" height="50"><rect x="10" y="10" width="180" height="30" fill="white"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const file = `${name}-logo.png`;
    await fs.writeFile(path.join(directory, file), logo);
    const logoEntry = {
      file,
      width: 200,
      height: 50,
      bytes: logo.length,
      sha256: createHash("sha256").update(logo).digest("hex"),
    };
    const photos = Array.from({ length: 5 + displays }, (_, i) => ({
      id: id(i + 1),
      ...entries[i < 5 ? i : 5],
    }));
    const logoId = id(5 + displays + 1);
    const plan = {
      engine: "apparel-catalog",
      scene: "apparel-catalog",
      layoutVersion: "1.0.0",
      brief: {
        name: "固定合成测试衬衫",
        sku: "FIXTURE",
        color: "合成RGB",
        composition: "100 亚麻",
        care: "冷水手洗",
        size: "M",
        measurements: {
          length: "65",
          chest: "100",
          shoulder: "40",
          sleeve: "58",
        },
        weightRecommendation: "45 - 55kg",
        design: "合成测试纹理",
        fabric: "合成测试",
      },
      sources: {
        mains: photos.slice(0, 5).map((p) => p.id),
        displays: photos
          .slice(5)
          .map((p, i) => ({ id: p.id, name: `展示${i + 1}.jpg` })),
        logo: logoId,
      },
      fabricCrop: [0.24, 0.2, 0.76, 0.57],
    };
    cases.push({
      name,
      seed: fixtureSeed,
      width,
      height,
      pixels: width * height,
      displays,
      padded: pad,
      plan,
      sources: [...photos, { id: logoId, ...logoEntry }],
    });
  }
  const manifest = {
    seed: fixtureSeed,
    scope:
      "Synthetic actual decoded pixels,25ms local copy-read latency; no production or provider",
    cases,
  };
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
export function balancedOrders(pairs, seed = fixtureSeed) {
  const random = seededRandom(seed),
    values = Array.from({ length: pairs }, (_, i) =>
      i % 2 === 0 ? "BR" : "RB",
    );
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
