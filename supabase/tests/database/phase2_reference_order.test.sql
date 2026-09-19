begin;
set local timezone='UTC';
create extension if not exists pgtap with schema extensions;
select plan(1);
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';

delete from pgmq.q_image_generation;
update private.runtime_flags set enabled=true where flag='generation_enabled';
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
values('b1000000-0000-4000-8000-000000000001','reference-order@example.invalid',now(),false);
insert into public.sessions(id,user_id)
values('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001');

-- Insert in ascending UUID order; the requested product/style order is reversed.
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
values
  ('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000001/style.png','style.png','image/png',5,1,1),
  ('b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000001/product.png','product.png','image/png',5,1,1);
insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash)
values('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
  'direct','reference order','gemini','test-model','{"count":1,"aspectRatio":"1:1","resolution":"1K"}','reference-order','reference-order');
insert into public.generations(id,batch_id,provider,model,prompt,params)
values('b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','gemini','test-model','reference order',
  '{"aspectRatio":"1:1","resolution":"1K","referenceIds":["b3000000-0000-4000-8000-000000000002","b3000000-0000-4000-8000-000000000001"]}');
select pgmq.send('image_generation','{"generationId":"b5000000-0000-4000-8000-000000000001"}'::jsonb);

select is(
  jsonb_path_query_array(public.claim_image_generation(),'$.references[*].id'),
  '["b3000000-0000-4000-8000-000000000002","b3000000-0000-4000-8000-000000000001"]'::jsonb,
  'claim preserves requested product-first/style-second reference order, not row or UUID order'
);
select * from finish();
rollback;
