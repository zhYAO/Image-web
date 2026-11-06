import { ApiRouteError } from '../api-error';
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { creditItemSchema } from "@zimage/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertMutationAdmission } from "@/server/lifecycle/request-lifecycle";
import {
  assertTrustedOrigin,
  executeRoute,
  readJson,
  requireVerifiedUserId,
} from "@/server/route-context";
import {
  readCredits,
  readLedger,
  readPrices,
  readQuote,
} from "./credit-service";
const quoteRequest = z.union([
  z.object({ items: z.array(creditItemSchema).min(1).max(8) }).strict(),
  z
    .object({
      action: z.enum(["image", "recreate", "commerce"]),
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export function creditRoute(
  request: Request,
  action: "wallet" | "ledger" | "catalog" | "quote",
) {
  return executeRoute(async () => {
    if (request.method === "POST") assertTrustedOrigin(request);
    // Wallet and ledger dispatch can create a wallet and its welcome grant.
    if (action === "wallet" || action === "ledger") assertMutationAdmission();
    const catalogProbe = action === "catalog"
      && request.headers.get("x-zimage-readonly-probe") === "catalog-v1";
    const user = await requireVerifiedUserId(
      await createSupabaseServerClient(),
    );
    const admin: SupabaseClient = createSupabaseAdminClient();
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    if (cursor)
      z.string()
        .regex(/^\d{1,18}$/)
        .parse(cursor);
    const quoteBody = action === 'quote' ? quoteRequest.parse(await readJson(request)) : undefined;
    if (quoteBody && 'items' in quoteBody && quoteBody.items.some(item => item.model === 'minimax' || item.provider === 'minimax'))
      throw new ApiRouteError({code:'bad_request',status:400,retryable:false,message:'MiniMax 已停止新报价，请选择豆包。'});
    const result =
      action === "wallet"
        ? await readCredits(admin, user)
        : action === "ledger"
          ? await readLedger(admin, user, cursor)
          : action === "catalog"
            ? await readPrices(admin, user, { allowUnavailableFallback: !catalogProbe })
            : await readQuote(
                admin,
                user,
                quoteBody!,
              );
    return Response.json(action === "catalog" ? { ...result, prices: (result as { prices: Array<{model:string}> }).prices.filter(p => p.model !== "minimax") } : result, { headers: {
      "cache-control": "no-store",
      ...(catalogProbe ? { "x-zimage-readonly-probe": "catalog-v1" } : {}),
    } });
  });
}
