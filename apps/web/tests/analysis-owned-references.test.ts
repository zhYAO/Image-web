import {it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadOwnedAnalysisReferences} from '@/server/commerce-analysis/owned-references';
const id=crypto.randomUUID(),sessionId=crypto.randomUUID(),user=crypto.randomUUID();
const request={requestId:crypto.randomUUID(),sessionId,references:[{id,role:'product' as const}]};
function client(rows:unknown[]) {
 const download=vi.fn();
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),in:vi.fn().mockResolvedValue({data:rows,error:null}),maybeSingle:vi.fn().mockResolvedValue({data:{id:sessionId},error:null})};
 return {admin:{from:()=>query,storage:{from:()=>({download})}} as unknown as SupabaseClient,download,query};
}
it('requires the full owned reference set before downloading',async()=>{const c=client([]);await expect(loadOwnedAnalysisReferences(c.admin,user,request)).rejects.toThrow('forbidden');expect(c.download).not.toHaveBeenCalled();expect(c.query.eq).toHaveBeenCalledWith('user_id',user);expect(c.query.eq).toHaveBeenCalledWith('session_id',sessionId);});
it.each(['pending','expired'])('refuses %s material before downloading',async state=>{const c=client([{id,status:state==='expired'?'expired':'active',write_state:state,upload_expires_at:new Date(Date.now()+10000).toISOString(),storage_bucket:'uploads',storage_path:`${user}/${sessionId}/references/x`,size_bytes:100,mime_type:'image/png'}]);await expect(loadOwnedAnalysisReferences(c.admin,user,request)).rejects.toThrow('forbidden');expect(c.download).not.toHaveBeenCalled();});
