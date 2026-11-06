import type { RelayDatabase } from '../_shared/relay-database.ts';
import { withSupabase } from '@supabase/server';
import { handleProviderDiagnostic } from '../_shared/provider-diagnostics.ts';

export default { fetch: withSupabase<RelayDatabase>({ auth: ['secret'] }, async (request, context) => handleProviderDiagnostic(request, { authorized: true, admin: context.supabaseAdmin, env: name => Deno.env.get(name), fetcher: fetch })) };
