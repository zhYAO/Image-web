import { timelineResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { SupabaseTimelineStore } from '@/server/timeline/supabase-timeline-store';

const querySchema = z.object({
  after: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

interface TimelineRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: TimelineRouteContext) {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const { id } = await context.params;
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const body = await new SupabaseTimelineStore(client).list({
      after: query.after,
      limit: query.limit,
      sessionId: z.uuid().parse(id),
      userId,
    });
    return NextResponse.json(timelineResponseSchema.parse(body));
  });
}
