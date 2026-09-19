create function private.record_image_safety_decision(
  p_generation_id uuid,
  p_category text,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision not in ('allow', 'block', 'review') or char_length(btrim(p_category)) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_safety_decision';
  end if;
  insert into private.image_safety_audits (generation_id, provider, category, decision, correlation_id)
  select id, provider, btrim(p_category), p_decision, correlation_id
  from public.generations where id = p_generation_id;
  if not found then raise exception using errcode = 'P0001', message = 'generation_not_found'; end if;
end;
$$;

create function public.record_image_safety_decision(p_generation_id uuid, p_category text, p_decision text)
returns void
language sql
set search_path = ''
as $$ select private.record_image_safety_decision(p_generation_id, p_category, p_decision); $$;

revoke all on function private.record_image_safety_decision(uuid,text,text), public.record_image_safety_decision(uuid,text,text)
from public, anon, authenticated;
grant execute on function private.record_image_safety_decision(uuid,text,text), public.record_image_safety_decision(uuid,text,text)
to service_role;
