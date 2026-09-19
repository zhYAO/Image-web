import { deleteSessionResponseSchema, renameSessionRequestSchema, sessionResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { createPreviewUsageGuard, withPreviewUsageReservation } from '@/server/preview/preview-usage-guard';
import { createSessionService } from '@/server/sessions/session-service';
import { SupabaseSessionStore } from '@/server/sessions/supabase-session-store';

interface SessionRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: SessionRouteContext) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const id = z.uuid().parse((await context.params).id);
    const input = renameSessionRequestSchema.parse(await readJson(request));
    const admin = createSupabaseAdminClient();
    return withPreviewUsageReservation(createPreviewUsageGuard(admin), {
      businessKey: `session-update:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'session_update',
      userId,
    }, async () => {
      const body = await createSessionService(new SupabaseSessionStore(client, admin)).rename(userId, id, input);
      return NextResponse.json(sessionResponseSchema.parse(body));
    });
  });
}

export async function DELETE(request: Request, context: SessionRouteContext) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const id = z.uuid().parse((await context.params).id);
    const admin = createSupabaseAdminClient();
    const store = new SupabaseSessionStore(client, admin);
    return withPreviewUsageReservation(createPreviewUsageGuard(admin), {
      businessKey: `session-delete:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'session_delete',
      userId,
    }, async () => {
      const body = await createSessionService(store).remove(userId, id);
      return NextResponse.json(deleteSessionResponseSchema.parse(body), { status: 202 });
    });
  });
}
