/** Public liveness/version only. Does not disclose configuration or call paid providers. */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { status: 'ok', version: process.env.ZIMAGE_BUILD_SHA ?? 'development' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
