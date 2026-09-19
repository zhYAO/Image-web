import { commerceRoute } from "@/server/commerce/route";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return commerceRoute(request, "cancel", (await context.params).id);
}
