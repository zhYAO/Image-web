import { expect,it,vi } from 'vitest';
import {requestArkCompletion as requestPackageCompletion}from '../../../supabase/functions/_shared/ark-completion';
const input={model:'frozen-vision-model',maxOutputTokens:4000,prompt:'商品观察',apiKey:'test-only-placeholder',images:[{id:'source-1',role:'product',dataUrl:'data:image/png;base64,AA=='}]};
it('sends the frozen independent model and retains metered usage',async()=>{
 let request:RequestInit|undefined;
 const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');request=init;return Response.json({id:'provider-1',model:input.model,usage:{prompt_tokens:1280,completion_tokens:20,total_tokens:1300,prompt_tokens_details:{cached_tokens:0}},choices:[{finish_reason:'stop',message:{content:'{"observations":[]}'}}]});};
 const r=await requestPackageCompletion(input,fetcher);expect(r.usage).toEqual({cachedInputTokens:0,inputTokens:1280,outputTokens:20});expect(r.providerRequestId).toBe('provider-1');
 const body=JSON.parse(request!.body as string);expect(body.model).toBe('frozen-vision-model');expect(body.max_tokens).toBe(4000);expect(body.messages[1].content[1].image_url.url).toContain('data:image/png');
});
it.each([undefined,{prompt_tokens:1.5,completion_tokens:1},{prompt_tokens:NaN,completion_tokens:1},{prompt_tokens:-1,completion_tokens:2}])('preserves completed text with unknown cost usage rather than inventing a cost',async usage=>{
 const result=await requestPackageCompletion(input,async()=>Response.json({usage,choices:[{finish_reason:'stop',message:{content:'{}'}}]}));expect(result.text).toBe('{}');expect(result.usage).toBeNull();
});
it('never retries an unknown provider outcome',async()=>{
 const fetcher=vi.fn().mockRejectedValue(Error('lost-response'));
 await expect(requestPackageCompletion(input,fetcher)).rejects.toThrow('package_provider_outcome_unknown');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('refuses missing configuration before any transport',async()=>{
 const fetcher=vi.fn();await expect(requestPackageCompletion({...input,apiKey:''},fetcher)).rejects.toThrow('package_provider_configuration_missing');expect(fetcher).not.toHaveBeenCalled();
});
