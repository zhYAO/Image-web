import { apiMetaResponse } from '../../../server/runtime/api-meta';

export const dynamic = 'force-dynamic';

export function GET() {
  return apiMetaResponse();
}
