import type{RelayDatabase}from'../_shared/relay-database.ts';
import{withSupabase}from'@supabase/server';
import{handleDoubaoText}from'../_shared/doubao-text-relay.ts';
export default{fetch:withSupabase<RelayDatabase>({auth:['secret']},async(request,context)=>handleDoubaoText(request,{authorized:true,admin:context.supabaseAdmin,env:name=>Deno.env.get(name),fetcher:fetch}))};
