import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as renderPOST } from "@/app/api/creative-tasks/mock-apparel-render/route";
import { POST as downloadPOST } from "@/app/api/creative-tasks/mock-apparel-render/download/route";
import { apparelFixture } from "./apparel-fixtures";
import { apparelOutputNames } from "@zimage/domain";
import { File as NodeFile } from "node:buffer";
vi.mock("@/server/apparel/apparel-renderer", () => ({
  renderApparelPages: async function* () {
    for (const name of apparelOutputNames(apparelFixture))
      yield {
        name,
        width: 790,
        height: 1000,
        bytes: new Uint8Array([255, 216, 7, 255, 217]),
      };
  },
}));
function request(kind: "render" | "download", hostname = "localhost") {
  const url = `http://${hostname}/api/creative-tasks/mock-apparel-render${kind === "download" ? "/download" : ""}`;
  const files = apparelOutputNames(apparelFixture).map(
    (name) =>
      new NodeFile([new Uint8Array([255, 216, 7, 255, 217])], name, {
        type: "image/jpeg",
      }),
  );
  const req = new Request(url, {
    method: "POST",
    headers: { origin: new URL(url).origin },
  });
  // jsdom FormData is a browser object; expose the parsed multipart boundary
  // directly while retaining native Request/Response and real ZIP encoding.
  req.formData = async () =>
    ({
      get: () => JSON.stringify(apparelFixture),
      getAll: () => files,
    }) as unknown as FormData;
  return req;
}
describe("explicitly local mock apparel endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("File", NodeFile);
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("ZIMAGE_LOCAL_MOCK_RENDER_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("ZIMAGE_DEPLOYMENT_ENV", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    ["preview", ""],
    ["", "preview"],
    ["production", ""],
    ["", "production"],
  ])(
    "rejects deployed environments Vercel=%s deployment=%s",
    async (vercel, deployment) => {
      vi.stubEnv("VERCEL_ENV", vercel);
      vi.stubEnv("ZIMAGE_DEPLOYMENT_ENV", deployment);
      expect((await renderPOST(request("render"))).status).toBe(404);
      expect((await downloadPOST(request("download"))).status).toBe(404);
    },
  );
  it("rejects missing opt-in, HTTP mode and non-loopback hosts", async () => {
    vi.stubEnv("ZIMAGE_LOCAL_MOCK_RENDER_ENABLED", "");
    expect((await renderPOST(request("render"))).status).toBe(404);
    expect((await downloadPOST(request("download"))).status).toBe(404);
    vi.stubEnv("ZIMAGE_LOCAL_MOCK_RENDER_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "http");
    expect((await renderPOST(request("render"))).status).toBe(404);
    expect((await downloadPOST(request("download"))).status).toBe(404);
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    expect((await renderPOST(request("render", "example.com"))).status).toBe(
      404,
    );
    expect(
      (await downloadPOST(request("download", "example.com"))).status,
    ).toBe(404);
  });
  it("allows opted-in localhost rendering and keeps original JPEG bytes and directory names in ZIP", async () => {
    const rendered = await renderPOST(request("render"));
    expect(rendered.status).toBe(200);
    expect((await rendered.json()).pages).toHaveLength(11);
    const downloaded = await downloadPOST(request("download"));
    expect(downloaded.status).toBe(200);
    const zip = new Uint8Array(await downloaded.arrayBuffer()),
      length = new DataView(zip.buffer).getUint16(26, true);
    expect(new TextDecoder().decode(zip.slice(30, 30 + length))).toBe(
      "主图/1.jpg",
    );
    expect(zip.slice(30 + length, 35 + length)).toEqual(
      new Uint8Array([255, 216, 7, 255, 217]),
    );
  });
});
