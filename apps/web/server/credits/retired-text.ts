import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiRouteError } from '../api-error';
import { textStep, pendingCreditError, type TextOperation } from './credit-service';
export async function recoverRetiredText(admin: SupabaseClient, userId: string, input: unknown): Promise<TextOperation> {
 const { data, error } = await admin.rpc('recover_retired_text_operation', { p_user_id: userId, p_input: input });
 if (error) throw new ApiRouteError({code:'service_not_ready',status:503,retryable:false,message:'历史模型恢复服务尚未升级，请保留原请求。'});
 if (!data) throw new ApiRouteError({code:'bad_request',status:400,retryable:false,message:'MiniMax 已停止新调用，请选择豆包并重新确认费用。'});
 let op = data as TextOperation;
 const requestId = (input as { requestId: string }).requestId;
 if (op.status === 'result') op = await textStep(admin,userId,requestId,'complete');
 if (op.status === 'reserved') {
   const cancelled = await textStep(admin,userId,requestId,'cancel',{reason:'停用模型尚未调用，释放原预占'});
   if(cancelled.status !== 'refunded') throw pendingCreditError();
   throw new ApiRouteError({code:'bad_request',status:409,retryable:false,message:'旧模型已停用，原未调用预占已释放，请重新确认豆包费用。'});
 }
 if (op.status !== 'succeeded') throw pendingCreditError();
 return op;
}
