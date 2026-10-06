import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  renderApparelPages,
  formatApparelComposition,
} from "@/server/apparel/apparel-renderer";
import { apparelFixture, apparelIds } from "./apparel-fixtures";

async function sources() {
  const main = await sharp({
    create: { width: 600, height: 800, channels: 3, background: "#bc8e66" },
  })
    .jpeg()
    .toBuffer();
  const display = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: "#71879e" },
  })
    .jpeg()
    .toBuffer();
  const logo = await sharp(
    Buffer.from(
      '<svg width="400" height="100"><rect x="20" y="20" width="360" height="60" fill="white"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const map = new Map(apparelIds.map((id) => [id, main]));
  map.set(apparelIds[5]!, display);
  map.set(apparelIds[6]!, logo);
  return map;
}
describe("deterministic apparel renderer", () => {
  it("renders exact catalog names, JPEG encodings and unstretched display dimensions", async () => {
    const map = await sources();
    const hashes = [...map.values()].map((bytes) =>
      createHash("sha256").update(bytes).digest("hex"),
    );
    const pages = [];
    for await (const page of renderApparelPages(apparelFixture, async (id) =>
      map.get(id)!,
    ))
      pages.push(page);
    expect(pages.map((page) => page.name)).toEqual([
      "主图/1.jpg",
      "主图/2.jpg",
      "主图/3.jpg",
      "主图/4.jpg",
      "主图/5.jpg",
      "images/详情2_01.jpg",
      "images/详情2_03.jpg",
      "images/详情2_04.jpg",
      "images/详情2_05.jpg",
      "images/详情2_06.jpg",
      "images/详情2_07.jpg",
    ]);
    expect(pages.map((page) => [page.width, page.height])).toEqual([
      [750, 1000],
      [750, 1000],
      [750, 1000],
      [750, 1000],
      [750, 1000],
      [790, 1227],
      [790, 574],
      [790, 631],
      [790, 1555],
      [790, 1243],
      [790, 676],
    ]);
    for (const page of pages) {
      const meta = await sharp(page.bytes).metadata();
      expect(meta).toMatchObject({
        format: "jpeg",
        space: "srgb",
        isProgressive: true,
        chromaSubsampling: "4:4:4",
      });
      expect(meta.orientation).toBeUndefined();
    }
    expect(
      [...map.values()].map((bytes) =>
        createHash("sha256").update(bytes).digest("hex"),
      ),
    ).toEqual(hashes);
  });
  it("rejects wrong source ratio before publishing any page", async () => {
    const map = await sources();
    map.set(apparelIds[0]!, map.get(apparelIds[5]!)!);
    let count = 0;
    await expect(
      (async () => {
        for await (const _ of renderApparelPages(apparelFixture, async (id) =>
          map.get(id)!,
        )) {
          void _;
          count++;
        }
      })(),
    ).rejects.toThrow(/3:4/);
    expect(count).toBe(0);
  });
  it("rejects an opaque logo and excessive DESIGN text during preflight", async () => {
    const map = await sources();
    const opaque = await sharp({
      create: { width: 400, height: 100, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(
      renderApparelPages(apparelFixture, async (id) =>
        id === apparelIds[6] ? opaque : map.get(id)!,
      ).next(),
    ).rejects.toThrow(/Logo/);
    await expect(
      renderApparelPages(
        {
          ...apparelFixture,
          brief: {
            ...apparelFixture.brief,
            design: "长篇商品描述".repeat(200),
          },
        },
        async (id) => map.get(id)!,
      ).next(),
    ).rejects.toThrow(/Design/);
  });
  it("rejects an excessively tall display before publishing any page", async () => {
    const map = await sources();
    map.set(
      apparelIds[5]!,
      await sharp({
        create: { width: 1, height: 100, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
    );
    await expect(
      renderApparelPages(apparelFixture, async (id) => map.get(id)!).next(),
    ).rejects.toThrow(/高度/);
  });
  it("normalizes EXIF and composites the logo once on the first detail", async () => {
    const map = await sources();
    map.set(
      apparelIds[0]!,
      await sharp({
        create: { width: 800, height: 600, channels: 3, background: "#bc8e66" },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    const pages = [];
    for await (const page of renderApparelPages(apparelFixture, async (id) =>
      map.get(id)!,
    ))
      pages.push(page);
    const sample = async (bytes: Uint8Array, x: number, y: number) =>
      Array.from(
        (
          await sharp(bytes)
            .extract({ left: x, top: y, width: 1, height: 1 })
            .raw()
            .toBuffer()
        ).subarray(0, 3),
      );
    expect(await sample(pages[0]!.bytes, 375, 805)).toEqual([255, 255, 255]);
    expect(await sample(pages[5]!.bytes, 395, 958)).toEqual([255, 255, 255]);
    expect((await sample(pages[5]!.bytes, 395, 920))[0]).toBeLessThan(240);
    expect(
      (await sharp(pages[0]!.bytes).metadata()).orientation,
    ).toBeUndefined();
  });
  it("points to overflowing care and table fields and rejects an empty crop", async () => {
    const map = await sources();
    await expect(
      renderApparelPages(
        {
          ...apparelFixture,
          brief: { ...apparelFixture.brief, care: "冷水手洗".repeat(300) },
        },
        async (id) => map.get(id)!,
      ).next(),
    ).rejects.toThrow(/洗涤方式/);
    await expect(
      renderApparelPages(
        {
          ...apparelFixture,
          brief: { ...apparelFixture.brief, size: "超长尺码".repeat(10) },
        },
        async (id) => map.get(id)!,
      ).next(),
    ).rejects.toThrow(/尺码/);
    await expect(
      renderApparelPages(
        { ...apparelFixture, fabricCrop: [0.5, 0.5, 0.5, 0.6] },
        async (id) => map.get(id)!,
      ).next(),
    ).rejects.toThrow(/裁切/);
  });
  it("normalizes composition without duplicating percentage signs", () => {
    expect(formatApparelComposition("80 棉\n20% 亚麻")).toBe(
      "80% 棉 / 20% 亚麻",
    );
  });
  it("rejects multiline size values before publishing instead of clipping table rows", async () => {
    const map = await sources();
    await expect(
      renderApparelPages(
        { ...apparelFixture, brief: { ...apparelFixture.brief, size: "M\nL" } },
        async (id) => map.get(id)!,
      ).next(),
    ).rejects.toThrow(/尺码.*单行/);
  });
});
