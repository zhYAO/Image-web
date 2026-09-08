import { commerceRoute } from '@/server/commerce/route';
export const GET=(request:Request)=>commerceRoute(request,'list');
export const POST=(request:Request)=>commerceRoute(request,'create');
