import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  copyFileSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync,
  renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { resolveApparelFont } from "@/server/apparel/font-files";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFonts = path.dirname(resolveApparelFont(false));
resolveApparelFont(true);
const filenames = ["NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf", "LICENSE.txt", "README.md"];
const temporary: string[] = [];
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type Entry = { path: string; kind: string; bytes: number; sha256: string; mime: string };

function fixture(change?: (manifest: { schema: number; files: Entry[] }) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "zimage-font-test-"));
  temporary.push(root);
  const manifest = {
    schema: 1,
    files: filenames.map((name) => {
      const bytes = readFileSync(path.join(sourceFonts, name));
      return { path: `fonts/${name}`, kind: "fonts", bytes: bytes.length, sha256: digest(bytes), mime: "application/octet-stream" };
    }),
  };
  change?.(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const sha = digest(manifestBytes);
  const versionRoot = path.join(root, sha);
  const fontDir = path.join(versionRoot, "fonts");
  mkdirSync(fontDir, { recursive: true });
  for (const name of filenames) copyFileSync(path.join(sourceFonts, name), path.join(fontDir, name));
  const manifestFile = path.join(versionRoot, "asset-manifest.json");
  writeFileSync(manifestFile, manifestBytes);
  return { root, versionRoot, fontDir, sha, manifestFile };
}
function configure(f: ReturnType<typeof fixture>) {
  vi.stubEnv("ZIMAGE_SHARED_FONT_DIR", f.fontDir);
  vi.stubEnv("ZIMAGE_STATIC_ASSET_SHA256", f.sha);
}
function noSharedFonts() {
  vi.stubEnv("ZIMAGE_SHARED_FONT_DIR", undefined);
  vi.stubEnv("ZIMAGE_STATIC_ASSET_SHA256", undefined);
}
function corruptFirstByte(file: string) {
  const value = readFileSync(file).subarray(0, 1);
  value[0] = value[0]! ^ 1;
  const fd = openSync(file, "r+");
  try { writeSync(fd, value, 0, 1, 0); } finally { closeSync(fd); }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("apparel local font files", () => {
  it("does not force repository font files into the application tracing graph", () => {
    const config = readFileSync(path.join(appRoot, "next.config.ts"), "utf8");
    expect(config).not.toMatch(/server\/apparel\/fonts/);
  });
  it("requires explicit external configuration even when cwd contains bundled fonts", () => {
    noSharedFonts();
    vi.spyOn(process, "cwd").mockReturnValue(appRoot);
    expect(() => resolveApparelFont(false)).toThrow(/ZIMAGE_SHARED_FONT_DIR/);
  });

  it.each([false, true])("renders identical real Sharp Chinese pixels with the shared font (bold=%s)", async (bold) => {
    noSharedFonts();
    const local = path.join(sourceFonts, bold ? filenames[1]! : filenames[0]!);
    const f = fixture();
    configure(f);
    const shared = resolveApparelFont(bold);
    expect(shared).toBe(path.join(f.fontDir, bold ? filenames[1]! : filenames[0]!));
    const render = (fontfile: string) => sharp({ text: {
      text: "服装面料 洗涤方式 龘 體 裏 cotton 80%",
      font: `Noto Sans CJK SC ${bold ? "Bold " : ""}24`, fontfile, dpi: 72, rgba: true,
    } }).png().toBuffer({ resolveWithObject: true });
    const [a, b] = await Promise.all([render(local), render(shared)]);
    expect(b.info).toEqual(a.info);
    expect(b.data).toEqual(a.data);
  });

  it.each(["directory", "fingerprint"])("rejects a partially configured shared asset %s", (missing) => {
    const f = fixture();
    configure(f);
    vi.stubEnv(missing === "directory" ? "ZIMAGE_SHARED_FONT_DIR" : "ZIMAGE_STATIC_ASSET_SHA256", undefined);
    expect(() => resolveApparelFont(false)).toThrow(/ZIMAGE_/);
  });

  it.each(["relative/fonts", ""])("rejects a non-absolute shared path %j", (fontDir) => {
    const f = fixture();
    configure(f);
    vi.stubEnv("ZIMAGE_SHARED_FONT_DIR", fontDir);
    expect(() => resolveApparelFont(false)).toThrow(/绝对|absolute|ZIMAGE_SHARED_FONT_DIR/);
  });

  it.each(["a".repeat(63), "A".repeat(64), ""])("rejects an invalid manifest fingerprint %j", (sha) => {
    const f = fixture();
    configure(f);
    vi.stubEnv("ZIMAGE_STATIC_ASSET_SHA256", sha);
    expect(() => resolveApparelFont(false)).toThrow(/ZIMAGE_STATIC_ASSET_SHA256/);
  });

  it("binds the configured fonts directory to its fingerprint-named parent", () => {
    const f = fixture();
    const renamed = path.join(f.root, "unversioned");
    renameSync(f.versionRoot, renamed);
    configure({ ...f, fontDir: path.join(renamed, "fonts") });
    expect(() => resolveApparelFont(false)).toThrow(/版本|指纹|SHA/);
  });

  it("checks the actual manifest bytes before accepting its file entries", () => {
    const f = fixture();
    writeFileSync(f.manifestFile, `${readFileSync(f.manifestFile, "utf8")} `);
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/manifest.*(?:SHA|摘要)|清单.*(?:SHA|摘要)/i);
  });

  it("requires manifest schema 1", () => {
    const f = fixture((m) => { m.schema = 2; });
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/schema/);
  });

  it("rejects manifest traversal entries even when their manifest digest is valid", () => {
    const f = fixture((m) => { m.files[0]!.path = "fonts/../NotoSansCJKsc-Regular.otf"; });
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/路径|path/);
  });

  it("rejects duplicate manifest paths", () => {
    const f = fixture((m) => { m.files.push({ ...m.files[0]! }); });
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/重复|duplicate/);
  });

  it("rejects a different font digest even if approved by the supplied manifest", () => {
    const f = fixture((m) => { m.files[0]!.sha256 = "a".repeat(64); });
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/字体.*(?:SHA|摘要)/);
  });

  it("checks both shared font files before returning either one and never falls back", () => {
    const f = fixture();
    unlinkSync(path.join(f.fontDir, filenames[1]!));
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/Bold|字体/);
  });

  it.each(["entry", "file", "bytes"])("requires the retained license %s and digest", (problem) => {
    const f = fixture(problem === "entry" ? (m) => { m.files = m.files.filter((e) => e.path !== "fonts/LICENSE.txt"); } : undefined);
    if (problem === "file") unlinkSync(path.join(f.fontDir, "LICENSE.txt"));
    if (problem === "bytes") corruptFirstByte(path.join(f.fontDir, "LICENSE.txt"));
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/LICENSE|许可/);
  });

  it.each(["LICENSE.txt", "README.md"])("rejects a manifest that approves changed original %s", (name) => {
    const f = fixture((m) => { m.files.find((e) => e.path === `fonts/${name}`)!.sha256 = "a".repeat(64); });
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/SHA-256/);
  });

  it.each(["entry", "file", "bytes"])("requires retained font provenance %s", (problem) => {
    const f = fixture(problem === "entry" ? (m) => { m.files = m.files.filter((e) => e.path !== "fonts/README.md"); } : undefined);
    if (problem === "file") unlinkSync(path.join(f.fontDir, "README.md"));
    if (problem === "bytes") corruptFirstByte(path.join(f.fontDir, "README.md"));
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/README/);
  });

  it.each(["font", "directory", "manifest"])("rejects a %s symlink escaping the version directory", (target) => {
    const f = fixture();
    const origin = target === "font" ? path.join(f.fontDir, filenames[0]!) : target === "directory" ? f.fontDir : f.manifestFile;
    const outside = path.join(f.root, "outside");
    renameSync(origin, outside);
    symlinkSync(outside, origin, target === "directory" ? "dir" : "file");
    configure(f);
    expect(() => resolveApparelFont(false)).toThrow(/越界|路径|symlink/);
  });

  it("invalidates a verified font after same-size mutation even when mtime is restored", () => {
    const f = fixture();
    configure(f);
    const file = resolveApparelFont(false);
    expect(resolveApparelFont(false)).toBe(file);
    const before = statSync(file);
    corruptFirstByte(file);
    utimesSync(file, before.atime, before.mtime);
    expect(() => resolveApparelFont(false)).toThrow(/字体.*(?:SHA|摘要)/);
  });

  it("invalidates cached verification when the font inode is replaced", () => {
    const f = fixture();
    configure(f);
    const file = resolveApparelFont(false);
    const replacement = path.join(f.fontDir, "replacement.otf");
    copyFileSync(file, replacement);
    corruptFirstByte(replacement);
    renameSync(replacement, file);
    expect(() => resolveApparelFont(false)).toThrow(/字体.*(?:SHA|摘要)/);
  });

  it("rechecks the cached license and manifest after changes", () => {
    const f = fixture();
    configure(f);
    resolveApparelFont(false);
    corruptFirstByte(path.join(f.fontDir, "LICENSE.txt"));
    expect(() => resolveApparelFont(false)).toThrow(/LICENSE|许可/);
    copyFileSync(path.join(sourceFonts, "LICENSE.txt"), path.join(f.fontDir, "LICENSE.txt"));
    resolveApparelFont(false);
    writeFileSync(f.manifestFile, `${readFileSync(f.manifestFile, "utf8")} `);
    expect(() => resolveApparelFont(false)).toThrow(/manifest.*(?:SHA|摘要)|清单.*(?:SHA|摘要)/i);
  });

  it("never uses cwd font files without explicit external configuration", () => {
    noSharedFonts();
    const root = mkdtempSync(path.join(tmpdir(), "zimage-local-font-test-"));
    temporary.push(root);
    const fonts = path.join(root, "server/apparel/fonts");
    mkdirSync(fonts, { recursive: true });
    const file = path.join(fonts, filenames[0]!);
    copyFileSync(path.join(sourceFonts, filenames[0]!), file);
    corruptFirstByte(file);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    expect(() => resolveApparelFont(false)).toThrow(/字体.*(?:SHA|摘要)/);
  });
});
