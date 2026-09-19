create or replace function private.claim_image_generation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_message record;
  generation_record record;
  generation_uuid uuid;
  reference_paths jsonb;
begin
  if not coalesce((
    select enabled from private.runtime_flags where flag = 'generation_enabled'
  ), false) then
    return null;
  end if;

  select * into queue_message from pgmq.read('image_generation', 120, 1) limit 1;
  if queue_message.msg_id is null then
    return null;
  end if;

  generation_uuid := (queue_message.message ->> 'generationId')::uuid;
  select
    generations.id,
    generations.status,
    generations.provider_submission_state,
    generations.prompt,
    generations.params,
    generations.provider,
    generations.model,
    generations.batch_id,
    generation_batches.user_id,
    generation_batches.session_id
  into generation_record
  from public.generations
  join public.generation_batches on generation_batches.id = generations.batch_id
  where generations.id = generation_uuid;

  if generation_record.id is null then
    return jsonb_build_object('action', 'archive', 'messageId', queue_message.msg_id, 'reason', 'missing_generation');
  end if;
  if generation_record.status in ('succeeded', 'failed') then
    return jsonb_build_object('action', 'archive', 'messageId', queue_message.msg_id, 'reason', 'terminal_generation');
  end if;
  if generation_record.status = 'processing' and generation_record.provider_submission_state <> 'not_submitted' then
    return jsonb_build_object(
      'action', 'fail_unknown',
      'generationId', generation_uuid,
      'messageId', queue_message.msg_id,
      'reason', 'previous_submission_may_have_been_accepted'
    );
  end if;

  update public.generations
  set status = 'processing', attempt_count = attempt_count + 1
  where id = generation_uuid
    and (status = 'pending' or (status = 'processing' and provider_submission_state = 'not_submitted'));
  perform private.refresh_generation_batch(generation_record.batch_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reference_uploads.id,
    'bucket', reference_uploads.storage_bucket,
    'path', reference_uploads.storage_path,
    'mimeType', reference_uploads.mime_type
  )), '[]'::jsonb)
  into reference_paths
  from public.reference_uploads
  where reference_uploads.id in (
    select value::uuid
    from jsonb_array_elements_text(coalesce(generation_record.params -> 'referenceIds', '[]'::jsonb))
  )
    and reference_uploads.user_id = generation_record.user_id
    and reference_uploads.session_id = generation_record.session_id
    and reference_uploads.status = 'active'
    and reference_uploads.upload_expires_at > timezone('utc', now());

  return jsonb_build_object(
    'action', 'process',
    'messageId', queue_message.msg_id,
    'readCount', queue_message.read_ct,
    'generationId', generation_uuid,
    'batchId', generation_record.batch_id,
    'sessionId', generation_record.session_id,
    'userId', generation_record.user_id,
    'provider', generation_record.provider,
    'model', generation_record.model,
    'prompt', generation_record.prompt,
    'params', generation_record.params,
    'references', reference_paths,
    'correlationId', queue_message.message ->> 'correlationId'
  );
end;
$$;
