import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { assertActiveBusinessSession } from '../session-access';
import { commerceAnalysisRequestSchema } from '@zimage/domain';
export async function loadOwnedAnalysisReferences(admin:SupabaseClient,userId:string,request:ReturnType<typeof commerceAnalysisRequestSchema.parse>) {
 await assertActiveBusinessSession(admin,userId,request.sessionId);
 const {data,error}=await admin.from('reference_uploads').select('id,user_id,session_id,status,write_state,upload_expires_at,storage_bucket,storage_path,size_bytes,mime_type').eq('user_id',userId).eq('session_id',request.sessionId).in('id',request.references.map(r=>r.id));
 if(error || data?.length!==request.references.length) throw Error('reference_forbidden');
 const results=[]; let total=0,normalized=0;
 for(const ref of request.references) {
  const row=data.find(r=>r.id===ref.id);
  if(!row || row.status!=='active' || row.write_state!=='ready' || Date.parse(row.upload_expires_at)<=Date.now() || row.storage_bucket!=='uploads' || !row.storage_path.startsWith(`${userId}/${request.sessionId}/references/`) || row.size_bytes>10*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(row.mime_type)) throw Error('reference_expired_or_forbidden');
  const source=await admin.storage.from('uploads').download(row.storage_path);
  if(source.error || !source.data || source.data.size>10*1024*1024) throw Error('reference_unavailable');
  total+=source.data.size; if(total>30*1024*1024) throw Error('analysis_input_too_large');
  const bytes=await sharp(new Uint8Array(await source.data.arrayBuffer()),{limitInputPixels:36_000_000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  normalized+=bytes.length;
  if(normalized>16*1024*1024)throw Error('analysis_input_too_large');
  if(bytes.length>4*1024*1024) throw Error('analysis_image_too_large');
  results.push({...ref,dataUrl:`data:image/png;base64,${bytes.toString('base64')}`});
 }
 return results;
}
