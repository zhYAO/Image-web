import { useState } from 'react';
import { commerceAnalysisResultSchema, type CommerceAnalysisResult } from '@zimage/domain';
export function CommerceAnalysisPanel({signature,onAnalyze,onConfirm,onManual,initialResult,initialSignature,initialFacts,initialStyle,confirmed=false,disabled=false,notice}:{signature:string;initialResult?:CommerceAnalysisResult;initialSignature?:string;initialFacts?:string;initialStyle?:string;confirmed?:boolean;disabled?:boolean;notice?:string;onManual?:()=>void;onAnalyze:()=>Promise<unknown>;onConfirm:(facts:string,style:string,signature:string)=>void|Promise<void>}) {
 const [result,setResult]=useState<{signature:string;data:CommerceAnalysisResult}|undefined>(()=>initialResult?{signature:initialSignature??signature,data:initialResult}:undefined);
 const [facts,setFacts]=useState(initialFacts??initialResult?.observations.filter(o=>o.kind!=='inferred').map(o=>o.text).join('\n')??''); const [style,setStyle]=useState(initialStyle??initialResult?.styleSummary??''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const current=result?.signature===signature;
 return <section aria-label="图片分析与资料确认">
  <h3>分析商品与参考风格</h3><p>{notice??<>先分析，再检查并确认商品资料，最后生成策划。图片分析费用尚未确定，真实分析暂不可用；可手动填写商品描述继续。</>}</p>
  <button type="button" disabled={busy||disabled||confirmed} onClick={async()=>{const snapshot=signature;setBusy(true);setError('');try{const data=commerceAnalysisResultSchema.parse(await onAnalyze());setResult({signature:snapshot,data});setFacts(data.observations.filter(o=>o.kind!=='inferred').map(o=>o.text).join('\n'));setStyle(data.styleSummary);}catch(e){setError(e instanceof Error?e.message:'图片分析失败，原资料已保留。');}finally{setBusy(false);}}}>{busy?'分析中…':'分析图片'}</button>
  {onManual&&<button type="button" onClick={onManual}>使用手动填写的资料</button>}
  {error&&<p role="alert">{error}</p>}
  {result&&<><p>{current?'以下内容是待核实的图片观察，尚未作为商品事实。':'图片或用途已变化，旧分析不能确认；手动资料仍保留。'}</p>
   <ul>{result.data.observations.map((o,i)=><li key={i}>{o.text} · {o.kind==='inferred'?'推断，勿直接采用':o.kind==='printed'?'图中文字，需核实':'可见外观'} · 商品图片观察</li>)}</ul>
   <p>未提取到：{result.data.missing.join('、')||'无明确缺项'}</p><p>冲突：{result.data.conflicts.join('；')||'无'}</p>
   <label>检查并修改商品事实<textarea disabled={busy||disabled||confirmed} value={facts} maxLength={4000} onChange={e=>setFacts(e.target.value)}/></label>
   <label>风格摘要<textarea disabled={busy||disabled||confirmed} value={style} maxLength={2000} onChange={e=>setStyle(e.target.value)}/></label>
   <button type="button" disabled={!current||busy||disabled||confirmed||!facts.trim()} onClick={async()=>{setBusy(true);setError('');try{await onConfirm(facts,style,result.signature);}catch(e){setError(e instanceof Error?e.message:'Confirmation failed');}finally{setBusy(false);}}}>确认商品资料，继续策划</button>
  </>}
 </section>;
}
