import { deleteSessionResponseSchema, renameSessionRequestSchema, sessionResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { createSessionService } from '@/server/sessions/session-service';
import { SupabaseSessionStore } from '@/server/sessions/supabase-session-store';

interface SessionRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: SessionRouteContext) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const { id } = await context.params;
    const input = renameSessionRequestSchema.parse(await readJson(request));
    const body = await createSessionService(new SupabaseSessionStore(client)).rename(userId, id, input);
    return NextResponse.json(sessionResponseSchema.parse(body));
  });
}

export async function DELETE(request: Request, context: SessionRouteContext) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const { id } = await context.params;
    const store = new SupabaseSessionStore(client, createSupabaseAdminClient());
    const body = await createSessionService(store).remove(userId, id);
    return NextResponse.json(deleteSessionResponseSchema.parse(body), { status: 202 });
  });
}
