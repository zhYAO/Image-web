import type{RelayDatabase}from'../_shared/relay-database.ts';
import {withSupabase} from '@supabase/server';
import {handleOpenAIChat} from '../_shared/openai-chat-relay.ts';
export default {fetch:withSupabase<RelayDatabase>({auth:['secret']},async(request,context)=>
 handleOpenAIChat(request,{provider:'doubao',authorized:true,admin:context.supabaseAdmin,
 env:name=>Deno.env.get(name),fetcher:fetch}))};
