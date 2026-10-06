import { apparelPlanSchema } from "@zimage/domain";
import { ApiRouteError } from "@/server/api-error";
import { executeRoute, assertTrustedOrigin } from "@/server/route-context";
import { renderApparelPages } from "@/server/apparel/apparel-renderer";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    if (
      (process.env.NEXT_PUBLIC_DATA_MODE ?? "mock") !== "mock" ||
      (process.env.VERCEL_ENV ?? process.env.ZIMAGE_DEPLOYMENT_ENV) ===
        "production"
    )
      throw new ApiRouteError({
        code: "not_found",
        status: 404,
        retryable: false,
        message: "接口不存在。",
      });
    if (Number(request.headers.get("content-length") ?? 0) > 261 * 1024 * 1024)
      throw new ApiRouteError({
        code: "bad_request",
        status: 413,
        retryable: false,
        message: "素材总量过大。",
      });
    const form = await request.formData(),
      plan = apparelPlanSchema.parse(JSON.parse(String(form.get("plan"))));
    const pages = [];
    try {
      for await (const page of renderApparelPages(plan, async (id) => {
        const file = form.get(id);
        if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
          throw new Error("请重新上传原始素材。");
        return new Uint8Array(await file.arrayBuffer());
      }))
        pages.push({
          name: page.name,
          width: page.width,
          height: page.height,
          base64: Buffer.from(page.bytes).toString("base64"),
        });
    } catch (error) {
      throw new ApiRouteError({
        code: "bad_request",
        status: 400,
        retryable: false,
        message: error instanceof Error ? error.message : "排版失败。",
      });
    }
    return Response.json(
      { pages },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
