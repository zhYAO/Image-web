import { commerceRoute } from '@/server/commerce/route';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return commerceRoute(request,'submit',(await context.params).id);}

export const runtime = 'nodejs';
export const maxDuration = 300;
