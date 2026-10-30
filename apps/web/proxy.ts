import type { NextRequest } from 'next/server';

import { updateSupabaseSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    // The upload route owns streaming ingestion and refreshes its own session.
    // Matching it here would make Next buffer the body before its byte/time/
    // concurrency budgets can run. Keep this exclusion exact, including slash.
    '/((?!api/uploads/?$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
