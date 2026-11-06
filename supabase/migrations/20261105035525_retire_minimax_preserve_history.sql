-- Additive retirement. Preserve all historical operations, prices and provider samples.
create function public.recover_retired_text_operation(p_user_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.credit_operations%rowtype;
begin
 if p_input->>'model'<>'minimax' or p_input->>'operation' not in ('chat','optimize') then raise exception 'invalid_retired_operation'; end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||(p_input->>'requestId');
 if not found then return null; end if;
 if op.request_hash<>md5((p_input-'billing'-'correlationId')::text) then raise exception 'idempotency_conflict'; end if;
 return to_jsonb(op);
end; $$;
revoke all on function public.recover_retired_text_operation(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recover_retired_text_operation(uuid,jsonb) to service_role;
select private.set_provider_runtime_enabled('minimax',false,'retired_by_user_20261105_preserve_history');
