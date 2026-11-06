export type ImageAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type ImageResolution = '1K' | '2K';

export const SEEDREAM_STANDARD_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
export const SEEDREAM_PLAN_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';

export function normalizeSeedreamPlanEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid_seedream_plan_endpoint');
  }
  const path = url.pathname.replace(/\/$/, '');
  if (url.origin !== 'https://ark.cn-beijing.volces.com'
    || url.username || url.password || url.search || url.hash
    || !['/api/plan/v3', '/api/plan/v3/images/generations'].includes(path)) {
    throw new Error('invalid_seedream_plan_endpoint');
  }
  return SEEDREAM_PLAN_IMAGE_ENDPOINT;
}

export interface ProviderReference {
  bytesBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface ProviderImageInput {
  aspectRatio: ImageAspectRatio;
  model: string;
  prompt: string;
  references: ProviderReference[];
  resolution: ImageResolution;
  targetWidth?: number;
  targetHeight?: number;
  legacySeedream?: boolean;
}

export interface ProviderImageMetering {
  source:'provider_response';model:string;resolvedModel:string;providerRequestId:string;generatedImages:number;inputReferences:number;outputWidth:number;outputHeight:number;
}
/** Private checkpoint telemetry; directory-rate estimates require a separate reviewed tariff. */
export interface OpenAiImageUsageReceipt {
 provider:'openai';source:'provider_response';requestedModel:string;resolvedModel?:string;providerRequestId?:string;
 size:'1024x1024';quality:'medium';serviceTier?:string;usage?:Record<string,unknown>;reviewReason?:'usage_unverified';
}
export interface ProviderImageResult {
  providerUsage?:OpenAiImageUsageReceipt;
  metering?:ProviderImageMetering;
  meteringIssue?:'provider_usage_unverified';
  bytesBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  providerRequestId?: string;
}

export class ImageProviderError extends Error {
  constructor(
    readonly code: 'moderation' | 'provider_error' | 'provider_unavailable',
    message: string,
    readonly retryable: boolean,
    readonly outcome: 'rejected' | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

const seedreamSizes: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  // Keep the published logical 2K geometry across the five supported aspect ratios.
  '1K': {
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '4:3': '2304x1728',
    '9:16': '1600x2848',
    '16:9': '2848x1600',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '4:3': '2304x1728',
    '9:16': '1600x2848',
    '16:9': '2848x1600',
  },
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function imageMimeType(value: unknown): ProviderImageResult['mimeType'] | undefined {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp' ? value : undefined;
}

function base64ImageMimeType(value: string): ProviderImageResult['mimeType'] {
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('iVBORw0KGgo')) return 'image/png';
  if (value.startsWith('UklGR')) return 'image/webp';
  throw new ImageProviderError('provider_error', 'provider_response_unsupported_image', false);
}

export function buildGeminiRequest(input: ProviderImageInput) {
  return {
    contents: [{
      parts: [
        ...input.references.map((reference) => ({
          inlineData: { data: reference.bytesBase64, mimeType: reference.mimeType },
        })),
        { text: input.prompt },
      ],
    }],
    generationConfig: {
      imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.resolution },
      responseModalities: ['IMAGE'],
    },
  };
}

export function decodeGeminiResponse(value: unknown): ProviderImageResult {
  const response = object(value);
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  let result: ProviderImageResult | undefined;
  for (const candidateValue of candidates) {
    const candidate = object(candidateValue);
    const parts = Array.isArray(object(candidate?.content)?.parts) ? object(candidate?.content)?.parts as unknown[] : [];
    for (const partValue of parts) {
      const part = object(partValue);
      if (part?.thought === true) continue;
      const inlineData = object(part?.inlineData ?? part?.inline_data);
      const bytesBase64 = string(inlineData?.data);
      const mimeType = imageMimeType(inlineData?.mimeType ?? inlineData?.mime_type);
      if (bytesBase64 && mimeType) {
        result = {
          bytesBase64,
          mimeType,
          providerRequestId: string(response?.responseId ?? response?.response_id),
        };
      }
    }
  }
  if (!result) throw new ImageProviderError('provider_error', 'provider_response_missing_image', false);
  return result;
}

export function buildSeedreamRequest(input: ProviderImageInput) {
  if (input.references.length > (input.legacySeedream ? 14 : 10)) {
    throw new ImageProviderError('provider_error', 'Seedream 5.0 最多支持 10 张参考图。', false, 'rejected');
  }
  const targetSize = input.targetWidth && input.targetHeight ? (() => {
    const scale = Math.max(1, Math.sqrt(3_686_400 / (input.targetWidth * input.targetHeight)));
    const width = Math.ceil(input.targetWidth * scale / 16) * 16;
    const height = Math.ceil(input.targetHeight * scale / 16) * 16;
    if (width * height > (input.legacySeedream ? 16_777_216 : 4_624_220) || width / height < 1 / 16 || width / height > 16) {
      throw new ImageProviderError('provider_error', 'seedream_invalid_target_size', false, 'rejected');
    }
    return `${width}x${height}`;
  })() : undefined;
  return {
    ...(input.references.length ? {
      image: input.references.map((reference) =>
        `data:${reference.mimeType};base64,${reference.bytesBase64}`),
    } : {}),
    model: input.model,
    prompt: input.prompt,
    response_format: 'b64_json',
    ...(input.legacySeedream ? { sequential_image_generation: 'disabled', stream: false } : {}),
    size: targetSize ?? seedreamSizes[input.resolution][input.aspectRatio],
    watermark: false,
  };
}

export function decodeSeedreamResponse(value: unknown): ProviderImageResult {
  const response = object(value);
  const data = Array.isArray(response?.data) ? response.data : [];
  const first = object(data[0]);
  const bytesBase64 = string(first?.b64_json);
  if (!bytesBase64) throw new ImageProviderError('provider_error', 'provider_response_missing_image', false);
  return {
    bytesBase64,
    mimeType: base64ImageMimeType(bytesBase64),
    providerRequestId: string(response?.id ?? response?.request_id),
  };
}

async function responseJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new ImageProviderError('provider_error', 'provider_response_invalid_json', false);
  }
}

function providerHttpError(status: number, body: unknown) {
  // Transport/server/decoding failures do not prove that generation was rejected.
  // Only explicit client-rejection HTTP statuses may enter ordinary failed retry.
  const outcome = [400, 401, 403, 404, 422, 429].includes(status) ? 'rejected' : 'unknown';
  const error = object(object(body)?.error);
  const reason = String(error?.code ?? error?.type ?? error?.status ?? '').toLowerCase();
  if (outcome === 'rejected' && /safety|moderation|sensitive/.test(reason)) {
    return new ImageProviderError('moderation', 'provider_content_blocked', false, outcome);
  }
  return new ImageProviderError(
    status === 429 || status >= 500 ? 'provider_unavailable' : 'provider_error',
    `provider_http_${status}`,
    status === 429 || status >= 500,
    outcome,
  );
}

export async function generateGeminiImage(
  input: ProviderImageInput,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      body: JSON.stringify(buildGeminiRequest(input)),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      method: 'POST',
      signal,
    },
  );
  const body = await responseJson(response);
  if (!response.ok) throw providerHttpError(response.status, body);
  return decodeGeminiResponse(body);
}

export async function generateSeedreamImage(
  input: ProviderImageInput,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  endpoint?: string,
) {
  const targetEndpoint = input.model === 'doubao-seedream-5.0-pro'
    ? normalizeSeedreamPlanEndpoint(endpoint ?? SEEDREAM_PLAN_IMAGE_ENDPOINT)
    : endpoint ?? SEEDREAM_STANDARD_IMAGE_ENDPOINT;
  const response = await fetcher(targetEndpoint, {
    body: JSON.stringify(buildSeedreamRequest(input)),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });
  const body = await responseJson(response);
  if (!response.ok) throw providerHttpError(response.status, body);
  const result=decodeSeedreamResponse(body);
  const root=object(body),items=Array.isArray(root?.data)?root.data:[],first=object(items[0]),usage=object(root?.usage);
  const size=typeof first?.size==='string'?/^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/.exec(first.size):null;
  const requestId=result.providerRequestId ?? response.headers.get('x-request-id') ?? undefined;
  if(typeof root?.model==='string' && root.model.length>0 && root.model.length<=100 && items.length===1 && usage?.generated_images===1 && usage.input_images===input.references.length
    && Number.isInteger(usage.input_images) && size && requestId && requestId.length<=200
    && Number(size[1])<=8192 && Number(size[2])<=8192) {
    result.metering={source:'provider_response',model:input.model,resolvedModel:root!.model as string,providerRequestId:requestId,generatedImages:1,
      inputReferences:input.references.length,outputWidth:Number(size[1]),outputHeight:Number(size[2])};
  } else result.meteringIssue='provider_usage_unverified';
  return result;
}

function openAiUsageReceipt(root:Record<string,unknown>|undefined,model:string,requestId:string|undefined):OpenAiImageUsageReceipt {
 const receipt:OpenAiImageUsageReceipt={provider:'openai',source:'provider_response',requestedModel:model,size:'1024x1024',quality:'medium'};
 if(requestId&&requestId.length<=200&&!/[\r\n]/.test(requestId))receipt.providerRequestId=requestId;
 if(typeof root?.model==='string'&&root.model.length<=100)receipt.resolvedModel=root.model;
 if(['default','flex','priority','scale'].includes(String(root?.service_tier)))receipt.serviceTier=String(root?.service_tier);
 const raw=object(root?.usage);let invalid=false;
 const counters=(value:unknown,keys:string[])=>{const input=object(value),out:Record<string,number>={};if(!input)return out;for(const key of keys){if(input[key]===undefined)continue;const n=input[key];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>1000000000){invalid=true;continue;}out[key]=n;}return out;};
 const totals=counters(raw,['input_tokens','output_tokens','total_tokens']),detail=object(raw?.input_tokens_details);
 const input=counters(detail,['text_tokens','image_tokens','cached_tokens']),cached=counters(detail?.cached_tokens_details,['text_tokens','image_tokens']),output=counters(raw?.output_tokens_details,['text_tokens','image_tokens']);
 const knownSum=(values:Record<string,number>,a:string,b:string,n:number|undefined)=>{if(n!==undefined&&values[a]!==undefined&&values[b]!==undefined&&values[a]+values[b]!==n)invalid=true;};
 knownSum(totals,'input_tokens','output_tokens',totals.total_tokens);knownSum(input,'text_tokens','image_tokens',totals.input_tokens);knownSum(cached,'text_tokens','image_tokens',input.cached_tokens);knownSum(output,'text_tokens','image_tokens',totals.output_tokens);
 if(input.cached_tokens!==undefined&&totals.input_tokens!==undefined&&input.cached_tokens>totals.input_tokens)invalid=true;
 if(!invalid&&totals.input_tokens!==undefined&&totals.output_tokens!==undefined&&totals.total_tokens!==undefined){
  receipt.usage={...totals,...(Object.keys(input).length?{input_tokens_details:{...input,...(Object.keys(cached).length?{cached_tokens_details:cached}:{})}}:{}),...(Object.keys(output).length?{output_tokens_details:output}:{})};
 }
 // Missing fields remain unknown, including zero-cache and output modality; never assume them.
 if(!receipt.usage||!receipt.providerRequestId||!receipt.resolvedModel||!receipt.serviceTier||input.cached_tokens===undefined||input.text_tokens===undefined||input.image_tokens===undefined||output.text_tokens===undefined||output.image_tokens===undefined||input.cached_tokens>0&&(cached.text_tokens===undefined||cached.image_tokens===undefined))receipt.reviewReason='usage_unverified';
 return receipt;
}

/** Official Images API; one upstream attempt. Private references stay binary. */
export async function generateOpenAiImage(input:ProviderImageInput,apiKey:string,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<ProviderImageResult> {
 if(!apiKey.trim()||/^replace_/i.test(apiKey)||!['gpt-image-2.6-sunburst','gpt-image-2.6-flare'].includes(input.model)||input.aspectRatio!=='1:1'||input.resolution!=='1K'||input.targetWidth!==undefined||input.targetHeight!==undefined||input.references.length>4)throw new ImageProviderError('provider_error','openai_configuration_or_geometry_invalid',false,'rejected');
 const fields={model:input.model,prompt:input.prompt,n:1,size:'1024x1024',quality:'medium',output_format:'png'};
 let body:BodyInit;const headers:Record<string,string>={authorization:`Bearer ${apiKey}`};
 if(input.references.length){const form=new FormData();for(const[k,v]of Object.entries(fields))form.set(k,String(v));
  for(const[r,reference]of input.references.entries()) {let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(reference.bytesBase64),c=>c.charCodeAt(0));}catch{throw new ImageProviderError('provider_error','invalid_private_reference',false,'rejected');}
   if(!bytes.length||bytes.length>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(reference.mimeType))throw new ImageProviderError('provider_error','invalid_private_reference',false,'rejected');
   form.append('image[]',new Blob([bytes as BlobPart],{type:reference.mimeType}),`reference-${r}.${reference.mimeType==='image/jpeg'?'jpg':reference.mimeType.split('/')[1]}`);}
  body=form;
 }else{body=JSON.stringify(fields);headers['content-type']='application/json';}
 const response=await fetcher(`https://api.openai.com/v1/images/${input.references.length?'edits':'generations'}`,{method:'POST',headers,body,signal});
 // Bound JSON before decoding; no supplier URL is fetched or exposed to clients.
 if(!response.body)throw new ImageProviderError('provider_error','provider_response_missing_body',false);
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
 try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>42*1024*1024)throw new ImageProviderError('provider_error','provider_response_too_large',false);text+=decoder.decode(r.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 let value:unknown;try{value=JSON.parse(text);}catch{throw new ImageProviderError('provider_error','provider_response_invalid_json',false);}
 if(!response.ok)throw providerHttpError(response.status,value);
 const root=object(value),data=Array.isArray(root?.data)?root.data:[],first=object(data[0]),image=string(first?.b64_json);
 if(data.length!==1||!image||image.length>42*1024*1024||base64ImageMimeType(image)!=='image/png')throw new ImageProviderError('provider_error','provider_response_invalid_image',false);
 const requestId=response.headers.get('x-request-id')??undefined;
 return{bytesBase64:image,mimeType:'image/png',providerRequestId:requestId,providerUsage:openAiUsageReceipt(root,input.model,requestId)};
}
