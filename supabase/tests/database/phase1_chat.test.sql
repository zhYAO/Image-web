begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_schema('langgraph', 'LangGraph checkpoint schema exists');
select ok(not has_schema_privilege('authenticated', 'langgraph', 'usage'), 'authenticated cannot read checkpoints');
select has_function('public', 'start_chat_turn', array['uuid', 'uuid', 'text'], 'atomic chat start exists');
select has_function('public', 'complete_chat_turn', array['uuid', 'uuid', 'text'], 'assistant persistence function exists');
select ok(
  not has_function_privilege('authenticated', 'public.start_chat_turn(uuid,uuid,text)', 'execute'),
  'authenticated cannot call privileged chat start'
);
select ok(
  has_function_privilege('service_role', 'public.start_chat_turn(uuid,uuid,text)', 'execute'),
  'service role can call chat start after server authorization'
);
select ok(
  has_function_privilege('service_role', 'public.record_chat_provider_result(text,boolean)', 'execute'),
  'service role can record shared provider health'
);

select * from finish();
rollback;
