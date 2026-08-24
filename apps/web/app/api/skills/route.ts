import { MODEL_REGISTRY_VERSION, PHASE1_SKILLS, skillsResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';

export async function GET() {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    await requireVerifiedUserId(client);
    return NextResponse.json(skillsResponseSchema.parse({
      registryVersion: MODEL_REGISTRY_VERSION,
      skills: PHASE1_SKILLS,
    }));
  });
}
