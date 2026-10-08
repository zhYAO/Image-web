import { ApiRouteError } from "@/server/api-error";

/** The unauthenticated renderer is only for an explicitly enabled local demo. */
export function assertLocalApparelMock(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (
    process.env.ZIMAGE_LOCAL_MOCK_RENDER_ENABLED !== "true" ||
    process.env.NEXT_PUBLIC_DATA_MODE !== "mock" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    Boolean(process.env.VERCEL || process.env.VERCEL_ENV) ||
    Boolean(
      process.env.ZIMAGE_DEPLOYMENT_ENV &&
      process.env.ZIMAGE_DEPLOYMENT_ENV !== "local",
    )
  )
    throw new ApiRouteError({
      code: "not_found",
      status: 404,
      retryable: false,
      message: "接口不存在。",
    });
}
