import { assertTrustedOrigin, executeRoute } from "@/server/route-context";
import { zipCommerceStream } from "@/server/commerce/commerce-export";
import { ApiRouteError } from "@/server/api-error";
import { assertLocalApparelMock } from "@/server/apparel/local-mock";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    assertLocalApparelMock(request);
    const files = (await request.formData()).getAll("images");
    if (
      files.length < 11 ||
      files.length > 30 ||
      files.some(
        (file) =>
          !(file instanceof File) ||
          file.size > 20 * 1024 * 1024 ||
          !file.name.match(
            /^(主图\/[1-5]|images\/详情2_(01|0[3-9]|[12][0-9]))\.jpg$/,
          ),
      )
    )
      throw new ApiRouteError({
        code: "bad_request",
        status: 400,
        retryable: false,
        message: "成品清单无效。",
      });
    async function* images() {
      for (const file of files as File[])
        yield {
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        };
    }
    return new Response(zipCommerceStream(images()), {
      headers: {
        "content-type": "application/zip",
        "cache-control": "private, no-store",
      },
    });
  });
}
