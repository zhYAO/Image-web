import { assertTrustedOrigin, executeRoute } from "@/server/route-context";
import { apparelRenderRetired } from "@/server/apparel/apparel-render-retired";
import { assertLocalApparelMock } from "@/server/apparel/local-mock";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    assertLocalApparelMock(request);
    throw apparelRenderRetired();
  });
}
