import{afterEach,expect,it,vi}from'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:async()=>({data:'11111111-1111-4111-8111-111111111111',error:null})})}));
vi.mock('@/lib/supabase/admin',()=>({createSupabaseAdminClient:m.admin}));
vi.mock('@/server/observability',()=>({reportServerError:vi.fn()}));
import{POST as chat}from'@/app/api/chat/route';
import{POST as optimize}from'@/app/api/creative-text/optimize/route';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
it.each(['chat','optimize'])('actual unfunded %s cannot create a relay, session or quota write',async kind=>{
 vi.stubEnv('ZIMAGE_CREDITS_ENABLED','false');vi.stubEnv('ZIMAGE_DOUBAO_EDGE_ENABLED','true');vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_synthetic');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('ARK_API_KEY','');
 m.admin.mockReturnValue({rpc:m.rpc});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const response=await(kind==='chat'?chat:optimize)(new Request('http://localhost/api/'+kind,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(kind==='chat'?{message:'x',chatModel:'doubao'}:{field:'title',text:'x',chatModel:'doubao'})}));
 expect(response.status).toBe(503);expect(m.rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
