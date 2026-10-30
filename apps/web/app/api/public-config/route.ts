import { publicConfigResponse } from '../../../server/runtime/public-config';

export const dynamic = 'force-dynamic';

export function GET() {
  return publicConfigResponse();
}
