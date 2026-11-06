import {afterEach,expect,it,vi} from 'vitest';
import {resolveChatProvider,streamOpenAiCompatibleChat}from '@/server/chat/chat-providers';
import {requestDoubaoStage}from '@/server/commerce-package/package-providers';
afterEach(()=>vi.unstubAllEnvs());
function configure(){vi.stubEnv('ARK_API_KEY','');vi.stubEnv('ZIMAGE_DOUBAO_EDGE_ENABLED','true');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_synthetic');}
it('resolves Doubao to Supabase without any Web Ark credential',()=>{configure();expect(resolveChatProvider('doubao')).toMatchObject({edgeRelay:true,model:'doubao',endpoint:'https://project.supabase.co/functions/v1/doubao-chat'});});
it('posts stage identity to secret-authenticated Supabase and cannot choose upstream model or endpoint',async()=>{configure();const fetcher=vi.fn(async(_u,init)=>{expect(new Headers(init.headers).get('apikey')).toBe('sb_secret_synthetic');expect(JSON.parse(init.body)).toEqual({userId:'u',requestId:'r',operation:'analysis',claimId:'c',prompt:'compiled',images:[]});return Response.json({text:'{}',model:'frozen',usage:{inputTokens:1,outputTokens:2,cachedInputTokens:0}});});const r=await requestDoubaoStage({userId:'u',requestId:'r',operation:'analysis',claimId:'c',prompt:'compiled',images:[]},fetcher);expect(r.model).toBe('frozen');expect(fetcher).toHaveBeenCalledOnce();});
it('does not retry ambiguous relay responses',async()=>{configure();const f=vi.fn(async()=>new Response('{}',{status:409}));await expect(requestDoubaoStage({userId:'u',requestId:'r',operation:'planning',claimId:'c',recoverOnly:true},f)).rejects.toThrow('package_provider_outcome_unknown');expect(f).toHaveBeenCalledOnce();});

it('can read a receipt with future paid calls disabled',async()=>{configure();vi.stubEnv('ZIMAGE_DOUBAO_EDGE_ENABLED','false');const f=vi.fn(async()=>Response.json({text:'{}',model:'saved',usage:{inputTokens:1,outputTokens:1,cachedInputTokens:0}}));expect((await requestDoubaoStage({userId:'u',requestId:'r',operation:'analysis',claimId:'c',recoverOnly:true},f)).model).toBe('saved');});

it('refund classification requires the dedicated persisted no-attempt proof',async()=>{configure();await expect(requestDoubaoStage({userId:'u',requestId:'r',operation:'optimize',prompt:'x',input:{}},async()=>Response.json({error:'relay_not_started'},{status:503}))).rejects.toMatchObject({outcome:'rejected'});});

it('only atomically proven no-attempt chat failure can be classified as rejected',async()=>{
 const run=async(error:string)=>{for await(const chunk of streamOpenAiCompatibleChat({edgeRelay:true,model:'doubao',billingAuthorization:{userId:'u',requestId:'r'},apiKey:'synthetic',endpoint:'https://project.supabase.co/functions/v1/doubao-chat',message:'x',fetcher:async()=>Response.json({error},{status:503})})){void chunk;}};
 await expect(run('relay_not_started')).rejects.toMatchObject({outcome:'rejected'});
 await expect(run('relay_pending')).rejects.toMatchObject({outcome:'unknown'});
});
