import { MODEL_REGISTRY_VERSION, PHASE1_SKILLS, skillsResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';

import { executeRoute } from '@/server/route-context';

export async function GET() {
  return executeRoute(async () => {
    return NextResponse.json(skillsResponseSchema.parse({
      registryVersion: MODEL_REGISTRY_VERSION,
      skills: PHASE1_SKILLS,
    }));
  });
}
