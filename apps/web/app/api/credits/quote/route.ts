import { creditRoute } from "@/server/credits/route";
export function POST(request: Request) {
  return creditRoute(request, "quote");
}
