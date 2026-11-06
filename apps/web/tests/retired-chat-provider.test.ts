import { describe, it, expect, vi } from 'vitest';
import { resolveChatProvider } from '@/server/chat/chat-providers';
import { CHAT_PROVIDER_MODELS } from '@zimage/domain';
import { loadComposer } from '@/store/composer-storage';
describe('retired chat provider', () => {
 it('offers only Doubao and rejects retired calls even with configured credentials', () => {
  vi.stubEnv('MINIMAX_API_KEY','test'); vi.stubEnv('ZIMAGE_MINIMAX_CHAT_MODEL','MiniMax-M3');
  expect(CHAT_PROVIDER_MODELS.map(m=>m.id)).toEqual(['doubao','gpt-6-astra','gpt-6.1-sol']);
  expect(()=>resolveChatProvider('minimax')).toThrow(); vi.unstubAllEnvs();
 });
 it('retains old unsent text while migrating its retired model selection', () => {
  sessionStorage.setItem('zimage:composer:v1:old',JSON.stringify({savedAt:Date.now(),draft:{draft:'保留资料',explicitImageToolEnabled:false,aspectRatio:'1:1',resolution:'2K',count:1,selectedChatModel:'minimax'}}));
  expect(loadComposer('old')).toMatchObject({draft:'保留资料',selectedChatModel:'doubao'});
 });
});
