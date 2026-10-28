import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, openSync, readFileSync,
  realpathSync, statSync, type BigIntStats,
} from "node:fs";
import path from "node:path";

const FONT_SHA256 = {
  "NotoSansCJKsc-Regular.otf": "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b",
  "NotoSansCJKsc-Bold.otf": "b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a",
} as const;
const SHA256 = /^[a-f0-9]{64}$/;
type ManifestFile = { path: string; bytes: number; sha256: string };
const verifiedFiles = new Map<string, { stamp: string; sha256: string }>();
const verifiedManifests = new Map<string, {
  stamp: string;
  sha256: string;
  files: Map<string, ManifestFile>;
}>();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const stamp = (stat: BigIntStats) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

function realFile(file: string, label: string, root?: string) {
  let real: string;
  try { real = realpathSync(file); } catch {
    throw new Error(`${label} 文件缺失或不可读取：${file}`);
  }
  if (root) {
    const relative = path.relative(root, real);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`${label} 路径越界：${file}`);
  }
  const stat = statSync(real, { bigint: true });
  if (!stat.isFile()) throw new Error(`${label} 必须是普通文件：${file}`);
  return { file: real, stat, stamp: stamp(stat) };
}

// Include ctime and inode: restoring mtime or atomically replacing a file must
// invalidate its successful check. Font contents are not retained in memory.
function readStable(file: ReturnType<typeof realFile>, label: string) {
  const fd = openSync(file.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (stamp(fstatSync(fd, { bigint: true })) !== file.stamp)
      throw new Error(`${label} 文件在校验期间变化。`);
    const bytes = readFileSync(fd);
    if (stamp(fstatSync(fd, { bigint: true })) !== file.stamp ||
        stamp(statSync(file.file, { bigint: true })) !== file.stamp)
      throw new Error(`${label} 文件在校验期间变化。`);
    return bytes;
  } finally { closeSync(fd); }
}

function verifyFile(file: string, label: string, sha256: string, root?: string, bytes?: number) {
  const current = realFile(file, label, root);
  if (bytes !== undefined && current.stat.size !== BigInt(bytes))
    throw new Error(`${label} 文件字节数不匹配：${file}`);
  const cached = verifiedFiles.get(current.file);
  if (cached?.stamp !== current.stamp || cached.sha256 !== sha256) {
    if (digest(readStable(current, label)) !== sha256)
      throw new Error(`${label} SHA-256 摘要不匹配：${file}`);
    verifiedFiles.set(current.file, { stamp: current.stamp, sha256 });
  }
  return current.file;
}

function manifestFiles(root: string, sha256: string) {
  const label = "资源清单 asset-manifest.json";
  const current = realFile(path.join(root, "asset-manifest.json"), label, root);
  const cached = verifiedManifests.get(current.file);
  if (cached?.stamp === current.stamp && cached.sha256 === sha256) return cached.files;
  const bytes = readStable(current, label);
  if (digest(bytes) !== sha256) throw new Error(`${label} SHA-256 摘要不匹配。`);
  let manifest: unknown;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch {
    throw new Error(`${label} 不是有效 JSON。`);
  }
  if (!manifest || typeof manifest !== "object" || !("schema" in manifest) ||
      manifest.schema !== 1 || !("files" in manifest) || !Array.isArray(manifest.files))
    throw new Error(`${label} 必须使用 schema 1 和 files 数组。`);
  const files = new Map<string, ManifestFile>();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" ||
        !entry.path || entry.path.includes("\\") || path.posix.isAbsolute(entry.path) ||
        entry.path.split("/").some((part: string) => !part || part === "." || part === ".."))
      throw new Error(`${label} 含有不安全的文件路径。`);
    if (files.has(entry.path)) throw new Error(`${label} 含有重复文件路径：${entry.path}`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256))
      throw new Error(`${label} 的文件字节数或 SHA-256 无效：${entry.path}`);
    files.set(entry.path, entry as ManifestFile);
  }
  verifiedManifests.set(current.file, { stamp: current.stamp, sha256, files });
  return files;
}

function sharedFont(fontDir: string, sha256: string, name: keyof typeof FONT_SHA256) {
  if (!path.isAbsolute(fontDir)) throw new Error("ZIMAGE_SHARED_FONT_DIR 必须为绝对路径。");
  if (!SHA256.test(sha256)) throw new Error("ZIMAGE_STATIC_ASSET_SHA256 必须为 64 位小写十六进制摘要。");
  const directory = path.resolve(fontDir);
  const version = path.dirname(directory);
  if (path.basename(directory) !== "fonts" || path.basename(version) !== sha256)
    throw new Error("共享字体目录必须位于 SHA-256 指纹版本目录的 fonts/ 下。");
  let root: string;
  let fonts: string;
  try {
    root = realpathSync(version);
    fonts = realpathSync(directory);
    if (root !== path.join(realpathSync(path.dirname(version)), sha256) || fonts !== path.join(root, "fonts"))
      throw new Error("路径越界");
  } catch {
    throw new Error("共享字体版本目录缺失或符号链接路径越界。");
  }
  const files = manifestFiles(root, sha256);
  const verified = new Map<string, string>();
  for (const [filename, expected] of Object.entries(FONT_SHA256)) {
    const relative = `fonts/${filename}`;
    const entry = files.get(relative);
    if (!entry) throw new Error(`资源清单缺少中文字体：${relative}`);
    if (entry.sha256 !== expected) throw new Error(`中文字体 SHA-256 摘要不匹配：${relative}`);
    verified.set(filename, verifyFile(path.join(fonts, filename), `中文字体 ${filename}`, expected, fonts, entry.bytes));
  }
  for (const [filename, expected] of Object.entries({
    "LICENSE.txt": "88f117575237307bdd86a17ef15e21790fc9a662fe4dfb103ca1ca077f0d9982",
    "README.md": "f314e6e822b03543d7403eb3f8331208d52356a27fe1391216d23d7599583c58",
  })) {
    const entry = files.get(`fonts/${filename}`);
    if (!entry || entry.sha256 !== expected) throw new Error(`资源清单缺失或更改原始字体许可/来源 ${filename} SHA-256。`);
    verifyFile(path.join(fonts, filename), `字体许可/来源 ${filename}`, expected, fonts, entry.bytes);
  }
  return verified.get(name)!;
}

/** Synchronous, local-only resolver for Sharp; never substitutes system fonts. */
export function resolveApparelFont(bold: boolean) {
  const name = bold ? "NotoSansCJKsc-Bold.otf" : "NotoSansCJKsc-Regular.otf";
  const directory = process.env.ZIMAGE_SHARED_FONT_DIR;
  const sha256 = process.env.ZIMAGE_STATIC_ASSET_SHA256;
  if (directory !== undefined || sha256 !== undefined) {
    if (!directory || !sha256)
      throw new Error("ZIMAGE_SHARED_FONT_DIR 与 ZIMAGE_STATIC_ASSET_SHA256 必须同时配置。");
    return sharedFont(directory, sha256, name);
  }
  throw new Error("服装渲染缺少外部字体资源。请按 ops/aliyun/FONTS.md 准备校验过的资源，成对配置 ZIMAGE_SHARED_FONT_DIR=<manifestSHA>/fonts 与 ZIMAGE_STATIC_ASSET_SHA256；不会下载或替换为系统字体。");
}
