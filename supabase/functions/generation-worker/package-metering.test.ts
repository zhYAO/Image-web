import {expect,it} from 'vitest';
import {generateSeedreamImage} from '../_shared/image-providers';
const ref={mimeType:'image/png' as const,bytesBase64:'iVBORw0KGgo='};
const input={model:'doubao-seedream-5.0-pro',aspectRatio:'1:1' as const,resolution:'2K' as const,prompt:'test',references:[ref,ref]};
const receipt=()=>({request_id:'receipt-1',model:input.model,data:[{b64_json:'iVBORw0KGgo=',size:'2048x2048'}],usage:{generated_images:1,input_images:2,output_tokens:16384}});
it('preserves supplier image usage in the same durable result checkpoint',async()=>{
 const result=await generateSeedreamImage(input,'test-only',async()=>Response.json(receipt()));
 expect(result.metering).toEqual({source:'provider_response',model:input.model,resolvedModel:input.model,providerRequestId:'receipt-1',generatedImages:1,inputReferences:2,outputWidth:2048,outputHeight:2048});
});
it('keeps a delivered image while marking missing usage unverified',async()=>{
 const result=await generateSeedreamImage(input,'test-only',async()=>Response.json({data:receipt().data,request_id:'receipt-1'}));
 expect(result.bytesBase64).toBe('iVBORw0KGgo=');expect(result.metering).toBeUndefined();expect(result.meteringIssue).toBe('provider_usage_unverified');
});
it.each([{generated_images:2,input_images:2},{generated_images:1,input_images:1},{generated_images:1,input_images:2.5}])('never guesses inconsistent supplier usage %#',async usage=>{
 const result=await generateSeedreamImage(input,'test-only',async()=>Response.json({...receipt(),usage}));expect(result.metering).toBeUndefined();
});
it('rejects malformed returned size as billing evidence without buying another image',async()=>{
 let calls=0;const result=await generateSeedreamImage(input,'test-only',async()=>{calls++;return Response.json({...receipt(),data:[{b64_json:'iVBORw0KGgo=',size:'auto'}]});});
 expect(calls).toBe(1);expect(result.metering).toBeUndefined();
});

it('retains the actual returned model for independent tariff validation',async()=>{
 const result=await generateSeedreamImage(input,'test-only',async()=>Response.json({...receipt(),model:'unexpected-model'}));
 expect(result.metering?.resolvedModel).toBe('unexpected-model');
});
