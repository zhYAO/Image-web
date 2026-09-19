import { creditRoute } from "@/server/credits/route";
export function GET(request: Request) {
  return creditRoute(request, "ledger");
}
