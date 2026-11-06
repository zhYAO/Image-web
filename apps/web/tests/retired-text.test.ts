import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {recoverRetiredText} from '@/server/credits/retired-text';
describe('retired paid recovery',()=>{
 it('does not claim cancellation released funds after a concurrent provider claim',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({data:{status:'reserved'},error:null}).mockResolvedValueOnce({data:{id:crypto.randomUUID(),status:'processing',result:null,started:null,session_id:null},error:null});
  await expect(recoverRetiredText({rpc} as unknown as SupabaseClient,'owner',{requestId:crypto.randomUUID()})).rejects.toMatchObject({code:'billing_pending'});
 });
 it('rejects new requests without reserving or calling a provider',async()=>{const rpc=vi.fn().mockResolvedValue({data:null,error:null});await expect(recoverRetiredText({rpc} as unknown as SupabaseClient,'owner',{requestId:'old'})).rejects.toThrow('MiniMax');expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0]?.[0]).toBe('recover_retired_text_operation');});
 it('returns stored successful results without another operation',async()=>{const op={status:'succeeded',result:{text:'原结果'}};const rpc=vi.fn().mockResolvedValue({data:op,error:null});expect(await recoverRetiredText({rpc} as unknown as SupabaseClient,'owner',{requestId:'old'})).toEqual(op);expect(rpc).toHaveBeenCalledTimes(1);});
 it('keeps unknown outcomes pending without a retry or refund',async()=>{const rpc=vi.fn().mockResolvedValue({data:{status:'needs_review'},error:null});await expect(recoverRetiredText({rpc} as unknown as SupabaseClient,'owner',{requestId:'old'})).rejects.toThrow('核对');expect(rpc).toHaveBeenCalledTimes(1);});
});
