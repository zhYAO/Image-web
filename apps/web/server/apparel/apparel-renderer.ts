import { apparelPlanSchema, type ApparelPlan } from "@zimage/domain";
import sharp, { type OverlayOptions } from "sharp";
import path from "node:path";
import { existsSync } from "node:fs";
const JPEG = {
  quality: 95,
  progressive: true,
  chromaSubsampling: "4:4:4",
} as const;
const LIMIT = 16384 * 16384;
const punctuation = "，。；：、）】》！？";
type Page = { name: string; bytes: Uint8Array; width: number; height: number };
type Source = (id: string) => Promise<Uint8Array>;
function fontFile(bold: boolean) {
  for (const root of [process.cwd(), path.join(process.cwd(), "apps/web")]) {
    const file = path.join(
      root,
      "server/apparel/fonts",
      `NotoSansCJKsc-${bold ? "Bold" : "Regular"}.otf`,
    );
    if (existsSync(file)) return file;
  }
  throw new Error("缺少随应用打包的中文字体。");
}
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function textImage(
  value: string,
  size: number,
  bold = false,
  color = "#222222",
) {
  return sharp({
    text: {
      text: `<span foreground="${color}">${escape(value)}</span>`,
      font: `Noto Sans CJK SC ${bold ? "Bold " : ""}${size}`,
      fontfile: fontFile(bold),
      dpi: 72,
      rgba: true,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}
export function formatApparelComposition(value: string) {
  return value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.replace(
        /(^|[、，,;/；+])(\s*)(\d+(?:\.\d+)?)/g,
        (match, _separator, _space, _number, offset: number) =>
          /^\s*%/.test(part.slice(offset + match.length)) ? match : `${match}%`,
      ),
    )
    .join(" / ");
}
function textLayout() {
  const widths = new Map<string, number>();
  async function width(value: string, size: number) {
    if (!value) return 0;
    const key = `${size}:${value}`;
    if (!widths.has(key))
      widths.set(key, (await textImage(value, size)).info.width);
    return widths.get(key)!;
  }
  async function wrap(
    value: string,
    size: number,
    field: string,
    maxLines: number,
  ) {
    const chars = Array.from(value.replace(/[\r\n]+/g, " ").trim()),
      lines: string[] = [];
    while (chars.length) {
      let low = 0,
        high = Math.min(chars.length, 650);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if ((await width(chars.slice(0, mid).join(""), size)) <= 650) low = mid;
        else high = mid - 1;
      }
      if (low < chars.length && punctuation.includes(chars[low]!)) {
        do {
          low--;
        } while (low > 0 && punctuation.includes(chars[low - 1]!));
      }
      if (!low || punctuation.includes(chars[0]!))
        throw new Error(`${field} 文字或标点超出版式容量，请调整。`);
      lines.push(chars.splice(0, low).join(""));
      if (lines.length > maxLines)
        throw new Error(`${field} 文字超出版式容量，请精简。`);
    }
    return lines;
  }
  return { width, wrap };
}
async function label(
  value: string,
  left: number,
  top: number,
  size: number,
  bold = false,
  color?: string,
): Promise<OverlayOptions> {
  return { input: (await textImage(value, size, bold, color)).data, left, top };
}
function rule(top: number, color = "#222222"): OverlayOptions {
  return {
    input: Buffer.from(
      `<svg width="650" height="1"><rect width="650" height="1" fill="${color}"/></svg>`,
    ),
    left: 70,
    top,
  };
}
async function page(height: number, overlays: OverlayOptions[]) {
  return sharp({
    create: { width: 790, height, channels: 3, background: "white" },
  })
    .composite(overlays)
    .jpeg(JPEG)
    .toBuffer();
}
async function heading(value: string) {
  return [rule(65), await label(value, 70, 92, 28, true)];
}
async function linesOverlays(
  lines: string[],
  top: number,
  size: number,
  color?: string,
) {
  return Promise.all(
    lines.map((line, index) =>
      label(
        line,
        70,
        top + index * Math.round(size * 1.55),
        size,
        false,
        color,
      ),
    ),
  );
}
async function read(
  source: Source,
  id: string,
  field: string,
  format: "jpeg" | "png",
) {
  const bytes = Buffer.from(await source(id));
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error(`${field} 每张文件须小于 10 MB。`);
  try {
    const meta = await sharp(bytes, {
      limitInputPixels: LIMIT,
      failOn: "warning",
    }).metadata();
    if (
      meta.format !== format ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) !== 1
    )
      throw new Error("格式错误");
    const rotated = (meta.orientation ?? 0) >= 5;
    return {
      bytes,
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
    };
  } catch {
    throw new Error(
      `${field} 必须是有效的 ${format === "jpeg" ? "JPEG" : "透明 PNG"} 图片。`,
    );
  }
}
async function photo(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: LIMIT, failOn: "warning" })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toColourspace("srgb")
    .removeAlpha()
    .png()
    .toBuffer();
}
async function cropLogo(bytes: Buffer) {
  const { data, info } = await sharp(bytes, { limitInputPixels: LIMIT })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let x1 = info.width,
    y1 = info.height,
    x2 = -1,
    y2 = -1,
    transparent = false;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3]!;
      transparent ||= alpha < 255;
      if (alpha) {
        x1 = Math.min(x1, x);
        y1 = Math.min(y1, y);
        x2 = Math.max(x2, x);
        y2 = Math.max(y2, y);
      }
    }
  if (!transparent || x2 < x1)
    throw new Error("Logo 必须有透明背景，且包含可见内容。");
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract({ left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 })
    .png()
    .toBuffer();
}
async function watermark(bytes: Buffer, logo: Buffer, width: number) {
  const meta = await sharp(bytes).metadata();
  const scaled = await sharp(logo)
    .resize({ width })
    .png()
    .toBuffer({ resolveWithObject: true });
  const top = Math.round(meta.height! * 0.795);
  if (top + scaled.info.height > meta.height!)
    throw new Error("Logo 高宽比超出规定位置的可用高度，请调整 Logo。");
  return sharp(bytes)
    .composite([
      { input: scaled.data, left: Math.round((meta.width! - width) / 2), top },
    ])
    .jpeg(JPEG)
    .toBuffer();
}
/** All inputs and text are validated before the first page is yielded. */
export async function* renderApparelPages(
  input: ApparelPlan,
  source: Source,
): AsyncGenerator<Page> {
  const plan = apparelPlanSchema.parse(input),
    sizes = new Map<string, { width: number; height: number }>();
  for (const [index, id] of [
    ...plan.sources.mains,
    ...plan.sources.displays.map((item) => item.id),
  ].entries()) {
    const field = index < 5 ? `主图 ${index + 1}` : `展示照片 ${index - 4}`;
    const loaded = await read(source, id, field, "jpeg");
    if (index < 5 && Math.abs(loaded.width / loaded.height / 0.75 - 1) > 0.005)
      throw new Error(`${field} 经 EXIF 校正后须为 3:4（容差 0.5%）。`);
    if (
      index >= 5 &&
      Math.round((loaded.height * 790) / loaded.width) + 281 > 40000
    )
      throw new Error(`${field} 输出高度超过 40000px，请调整照片比例。`);
    await photo(loaded.bytes);
    sizes.set(id, { width: loaded.width, height: loaded.height });
  }
  const logo = await cropLogo(
      (await read(source, plan.sources.logo, "Logo", "png")).bytes,
    ),
    logoMeta = await sharp(logo).metadata();
  for (const [height, logoWidth] of [
    [1000, 300],
    ...plan.sources.displays.map((item) => [
      Math.round(
        (sizes.get(item.id)!.height * 790) / sizes.get(item.id)!.width,
      ),
      315,
    ]),
  ]) {
    if (
      Math.round(height! * 0.795) +
        Math.round((logoMeta.height! * logoWidth!) / logoMeta.width!) >
      height!
    )
      throw new Error("Logo 高宽比超出规定位置的可用高度，请调整 Logo。");
  }
  const layout = textLayout(),
    brief = plan.brief;
  const composition = await layout.wrap(
    `面料成分  ${formatApparelComposition(brief.composition)}`,
    20,
    "面料成分",
    1,
  );
  const color = await layout.wrap(`颜色      ${brief.color}`, 20, "颜色", 1),
    care = await layout.wrap(brief.care, 20, "洗涤方式", 8);
  const info = [
    ...(await heading("商品信息")),
    await label(composition[0]!, 70, 143, 20),
    await label(color[0]!, 70, 182, 20),
    await label("养护指南", 70, 247, 28, true),
    ...(await linesOverlays(care, 298, 20)),
  ];
  const headers = ["尺码", "衣长", "胸围", "肩宽", "袖长", "体重推荐"];
  const values = [
    brief.size,
    brief.measurements.length,
    brief.measurements.chest,
    brief.measurements.shoulder,
    brief.measurements.sleeve,
    brief.weightRecommendation
      .replace(/\r?\n/g, " ")
      .replace(/\s*[-–—]\s*/g, "–"),
  ];
  const xs = [72, 172, 275, 380, 485, 585],
    rights = [152, 255, 360, 465, 570, 720];
  const size = [
    ...(await heading("尺码信息")),
    rule(166),
    rule(221, "#999999"),
    rule(276),
  ];
  for (let index = 0; index < values.length; index++) {
    if (/[\r\n]/.test(values[index]!))
      throw new Error(`${headers[index]} 须为单行，请精简。`);
    if ((await layout.width(values[index]!, 20)) > rights[index]! - xs[index]!)
      throw new Error(`${headers[index]} 超出尺码表列宽，请精简。`);
    size.push(
      await label(headers[index]!, xs[index]!, 181, 20),
      await label(values[index]!, xs[index]!, 236, 20),
    );
  }
  size.push(
    ...(await linesOverlays(
      await layout.wrap(
        "温馨提示：由于测量方式不同，尺寸可能存在1–3cm误差，属于正常范围。",
        15,
        "尺码提示",
        4,
      ),
      330,
      15,
      "#666666",
    )),
  );
  async function block(value: string, title: string, maxLines: number) {
    for (let font = 24; font >= 12; font--) {
      let lines: string[];
      try {
        lines = await layout.wrap(value, font, title, maxLines);
      } catch {
        continue;
      }
      if (160 + lines.length * Math.round(font * 1.55) <= 480)
        return page(502, [
          ...(await heading(title)),
          ...(await linesOverlays(lines, 160, font)),
        ]);
    }
    throw new Error(
      `${title === "DESIGN" ? "Design" : "Fabric"} 文字超出 502px 版式容量，请精简。`,
    );
  }
  const design = await block(brief.design, "DESIGN", 5),
    fabric = await block(brief.fabric, "FABRIC", 17);
  const main1 = await photo(
    (await read(source, plan.sources.mains[0]!, "主图 1", "jpeg")).bytes,
  );
  const main2 = await photo(
      (await read(source, plan.sources.mains[1]!, "主图 2", "jpeg")).bytes,
    ),
    meta2 = await sharp(main2).metadata();
  const [x1, y1, x2, y2] = plan.fabricCrop,
    left = Math.round(x1 * meta2.width!),
    top = Math.round(y1 * meta2.height!);
  const cropWidth = Math.round(x2 * meta2.width!) - left,
    cropHeight = Math.round(y2 * meta2.height!) - top;
  if (cropWidth < 1 || cropHeight < 1)
    throw new Error("面料裁切区域过小，请调整。");
  const crop = await sharp(main2)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(790, 741, { fit: "cover" })
    .png()
    .toBuffer();
  let watermarkedMain1: Buffer | undefined;
  for (let index = 0; index < 5; index++) {
    const normalized =
      index === 0
        ? main1
        : await photo(
            (
              await read(
                source,
                plan.sources.mains[index]!,
                `主图 ${index + 1}`,
                "jpeg",
              )
            ).bytes,
          );
    const fitted = await sharp(normalized)
        .resize(750, 1000, { fit: "cover" })
        .png()
        .toBuffer(),
      bytes = await watermark(fitted, logo, 300);
    if (index === 0) watermarkedMain1 = bytes;
    yield { name: `主图/${index + 1}.jpg`, bytes, width: 750, height: 1000 };
  }
  yield {
    name: "images/详情2_01.jpg",
    bytes: await page(1227, [
      {
        input: await sharp(watermarkedMain1!)
          .resize({ width: 790 })
          .png()
          .toBuffer(),
        left: 0,
        top: 110,
      },
    ]),
    width: 790,
    height: 1227,
  };
  yield {
    name: "images/详情2_03.jpg",
    bytes: await page(574, info),
    width: 790,
    height: 574,
  };
  yield {
    name: "images/详情2_04.jpg",
    bytes: await page(631, size),
    width: 790,
    height: 631,
  };
  const mainHeight = Math.round(
    (sizes.get(plan.sources.mains[0]!)!.height * 790) /
      sizes.get(plan.sources.mains[0]!)!.width,
  );
  yield {
    name: "images/详情2_05.jpg",
    bytes: await page(502 + mainHeight, [
      { input: design, left: 0, top: 0 },
      {
        input: await sharp(main1).resize(790, mainHeight).png().toBuffer(),
        left: 0,
        top: 502,
      },
    ]),
    width: 790,
    height: 502 + mainHeight,
  };
  yield {
    name: "images/详情2_06.jpg",
    bytes: await page(1243, [
      { input: fabric, left: 0, top: 0 },
      { input: crop, left: 0, top: 502 },
    ]),
    width: 790,
    height: 1243,
  };
  for (const [index, item] of plan.sources.displays.entries()) {
    const dimensions = sizes.get(item.id)!,
      height = Math.round((dimensions.height * 790) / dimensions.width),
      offset = index === 0 ? 261 : 22;
    const image = await sharp(
      await photo((await read(source, item.id, "展示照片", "jpeg")).bytes),
    )
      .resize(790, height)
      .png()
      .toBuffer();
    yield {
      name: `images/详情2_${String(index + 7).padStart(2, "0")}.jpg`,
      bytes: await page(offset + height + 20, [
        ...(index === 0 ? [await label("产品展示", 70, 100, 28, true)] : []),
        { input: await watermark(image, logo, 315), left: 0, top: offset },
      ]),
      width: 790,
      height: offset + height + 20,
    };
  }
}
