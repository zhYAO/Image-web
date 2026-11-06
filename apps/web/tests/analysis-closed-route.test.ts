import {it,expect,vi} from 'vitest';
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:vi.fn().mockResolvedValue({})}));
vi.mock('@/server/route-context',()=>({executeRoute:async(fn:()=>Promise<Response>)=>{try{return await fn()}catch(e){return new Response(JSON.stringify({message:(e as Error).message}),{status:503})}},assertTrustedOrigin:vi.fn(),requireVerifiedUserId:vi.fn().mockResolvedValue('user')}));
import {POST} from '@/app/api/commerce-analysis/route';
it('cannot enable unpriced analysis via request payload or environment',async()=>{vi.stubEnv('ZIMAGE_ANALYSIS_ENABLED','true');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);try{const response=await POST(new Request('http://app.test/api/commerce-analysis',{method:'POST',body:JSON.stringify({enabled:true,price:0})}));expect(response.status).toBe(503);expect(await response.text()).toContain('计费尚未确定');expect(fetcher).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}});
