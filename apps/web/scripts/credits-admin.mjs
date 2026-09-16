/** Controlled operator entry point. No mutation without --apply. */
import fs from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    env: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (!values.file)
  throw new Error(
    "Usage: node scripts/credits-admin.mjs --file operation.json [--env .env.local] [--apply]",
  );
const input = JSON.parse(fs.readFileSync(values.file, "utf8"));
if (
  !["grant", "price", "reconcile", "activate", "audit"].includes(
    input.action,
  ) ||
  !input.requestId ||
  !input.actor ||
  !input.reason
)
  throw new Error(
    "Require action, UUID requestId, actor and reason in operation JSON.",
  );
const env = {
  ...(values.env ? parseEnv(fs.readFileSync(values.env, "utf8")) : {}),
  ...process.env,
};
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key)
  throw new Error("Missing Supabase URL/server-only credentials (SUPABASE_SECRET_KEY).");
const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await client.rpc("credit_admin", {
  p_input: { ...input, apply: values.apply },
});
if (error) throw new Error(`Credit operation rejected: ${error.message}`);
console.log(
  JSON.stringify(
    {
      mode: values.apply ? "apply" : "preview",
      requestId: input.requestId,
      result: data,
    },
    null,
    2,
  ),
);
