import { NextResponse } from 'next/server';

import { buildOpenApiDocument } from '@/server/openapi';

export function GET() {
  return NextResponse.json(buildOpenApiDocument(), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
