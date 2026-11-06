import {expect,it,vi}from'vitest';
import {generateOpenAiImage, type ProviderImageInput}from'../_shared/image-providers';
const input:ProviderImageInput={model:'gpt-image-2.6-sunburst',prompt:'Test',aspectRatio:'1:1',resolution:'1K',references:[]};
const response=()=>Response.json({data:[{b64_json:'iVBORw0KGgoAAA=='}],usage:{total_tokens:100}},{headers:{'x-request-id':'openai-test'}});
it('uses the Images API with the explicit model and bounded PNG output',async()=>{
 const fetcher=vi.fn(async()=>response());const r=await generateOpenAiImage(input,'test-only',fetcher);
 expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/images/generations');
 expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({model:input.model,n:1,size:'1024x1024',quality:'medium',output_format:'png'});expect(r.providerRequestId).toBe('openai-test');
});
it('sends private reference bytes as multipart edits without a public image URL',async()=>{
 const fetcher=vi.fn(async()=>response());await generateOpenAiImage({...input,references:[{bytesBase64:'iVBORw0KGgoAAA==',mimeType:'image/png'}]},'test-only',fetcher);
 expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/images/edits');const form=fetcher.mock.calls[0]![1]!.body as FormData;expect(form.get('image[]')).toBeInstanceOf(Blob);expect(form.get('model')).toBe(input.model);expect(form.get('image_url')).toBeNull();
});
it('does not retry an ambiguous response or follow a returned image URL',async()=>{
 const fetcher=vi.fn(async()=>Response.json({data:[{url:'https://untrusted.invalid/image'}]}));await expect(generateOpenAiImage(input,'test-only',fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects unconfigured keys, models and unsupported geometry before transport',async()=>{
 const fetcher=vi.fn();for(const [change,key]of[[{},''],[{model:'gpt-image-unknown'},'test'],[{resolution:'2K'},'test']]as const)await expect(generateOpenAiImage({...input,...change},key,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
it('retains server failures as unknown and marks explicit moderation as rejected',async()=>{
 await expect(generateOpenAiImage(input,'test',async()=>Response.json({error:{code:'moderation_blocked'}},{status:400}))).rejects.toMatchObject({code:'moderation',outcome:'rejected'});
 await expect(generateOpenAiImage(input,'test',async()=>Response.json({error:{}},{status:500}))).rejects.toMatchObject({outcome:'unknown'});
});
it('retains only bounded numeric usage dimensions for private cost auditing',async()=>{
 const usage={input_tokens:100,output_tokens:1449,total_tokens:1549,input_tokens_details:{text_tokens:60,image_tokens:40,cached_tokens:20,cached_tokens_details:{text_tokens:10,image_tokens:10}},output_tokens_details:{image_tokens:1449,text_tokens:0},untrusted:'private prompt'};
 const r=await generateOpenAiImage(input,'test',async()=>Response.json({data:[{b64_json:'iVBORw0KGgoAAA=='}],usage,model:input.model,service_tier:'default'},{headers:{'x-request-id':'usage-test'}}));
 expect(r.providerUsage).toMatchObject({provider:'openai',source:'provider_response',requestedModel:input.model,resolvedModel:input.model,providerRequestId:'usage-test',size:'1024x1024',quality:'medium',serviceTier:'default',usage:{input_tokens:100,output_tokens:1449,input_tokens_details:{cached_tokens:20}}});
 expect(JSON.stringify(r.providerUsage)).not.toContain('private prompt');
});
it.each([undefined,{input_tokens:-1},{input_tokens:1.5},{input_tokens:1000000001},{input_tokens:5,output_tokens:10,total_tokens:12}])('keeps delivered images without inventing cost when usage is absent or invalid (%s)',async usage=>{
 const r=await generateOpenAiImage(input,'test',async()=>Response.json({data:[{b64_json:'iVBORw0KGgoAAA=='}],usage}));expect(r.bytesBase64).toBeTruthy();expect(r.providerUsage?.usage).toBeUndefined();expect(r.providerUsage?.reviewReason).toBe('usage_unverified');
});
