import { commerceRoute } from '@/server/commerce/route';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return commerceRoute(request,'get',(await context.params).id);}
export async function PATCH(request:Request,context:Context){return commerceRoute(request,'save',(await context.params).id);}
