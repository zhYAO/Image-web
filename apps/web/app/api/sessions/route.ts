import { createSessionRequestSchema, listSessionsResponseSchema, sessionResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { createSessionService } from '@/server/sessions/session-service';
import { SupabaseSessionStore } from '@/server/sessions/supabase-session-store';

export async function GET() {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const body = await createSessionService(new SupabaseSessionStore(client)).list(userId);
    return NextResponse.json(listSessionsResponseSchema.parse(body));
  });
}

export async function POST(request: Request) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const input = createSessionRequestSchema.parse(await readJson(request));
    const body = await createSessionService(new SupabaseSessionStore(client)).create(userId, input);
    return NextResponse.json(sessionResponseSchema.parse(body), { status: 201 });
  });
}
