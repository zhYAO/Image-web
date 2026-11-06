import {afterEach,expect,it,vi}from'vitest';
import {CHAT_PROVIDER_MODELS,resolveImageModel}from'@zimage/domain';
import {resolveChatProvider}from'@/server/chat/chat-providers';
import {useWorkspaceStore}from'@/store/workspace-store';
import {saveComposer,loadComposer}from'@/store/composer-storage';
afterEach(()=>{vi.unstubAllEnvs();useWorkspaceStore.getState().reset();});
it('registers the two explicit chat IDs and preserves a session draft selection',()=>{
 expect(CHAT_PROVIDER_MODELS.map(v=>v.id)).toEqual(['doubao','gpt-6-astra','gpt-6.1-sol']);
 useWorkspaceStore.getState().setSelectedChatModel('gpt-6.1-sol');expect(useWorkspaceStore.getState().selectedChatModel).toBe('gpt-6.1-sol');
 saveComposer('openai-test',useWorkspaceStore.getState());expect(loadComposer('openai-test')?.selectedChatModel).toBe('gpt-6.1-sol');
});
it.each(['gpt-6-astra','gpt-6.1-sol'])('pins %s to the official endpoint and an independent server credential',model=>{
 vi.stubEnv('ZIMAGE_OPENAI_ENABLED','true');vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_test_only');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');
 expect(resolveChatProvider(model)).toMatchObject({model,endpoint:'https://project.supabase.co/functions/v1/openai-chat',provider:model});
});
it('rejects OpenAI before transport when disabled or missing its key',()=>{
 vi.stubEnv('ZIMAGE_OPENAI_ENABLED','false');vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_test_only');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');expect(()=>resolveChatProvider('gpt-6-astra')).toThrow();
 vi.stubEnv('ZIMAGE_OPENAI_ENABLED','true');vi.stubEnv('SUPABASE_SECRET_KEY','');expect(()=>resolveChatProvider('gpt-6-astra')).toThrow();
});
it.each(['gpt-image-2.6-sunburst','gpt-image-2.6-flare'])('registers %s without aliasing Seedream',model=>{
 expect(resolveImageModel({provider:'openai',model})).toMatchObject({provider:'openai',model,capability:{resolutions:['1K'],aspectRatios:['1:1']}});
});
