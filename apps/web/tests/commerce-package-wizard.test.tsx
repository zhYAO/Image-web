import{CommercePlanFields}from'@/features/commerce/CommercePlanFields';
import {afterEach,beforeEach,expect,it,vi}from'vitest';
import {render,screen,fireEvent,waitFor}from'@testing-library/react';
import {CommerceWizard}from'@/features/commerce/CommerceWizard';
import {IMAGE_PROVIDER_CAPABILITIES,type CommerceGateway,type CommerceTask,type CommercePlan}from'@zimage/domain';
import {loadCommerceDraft}from'@/features/commerce/commerce-draft-storage';
const sid='33333333-3333-4333-8333-333333333333',rid='44444444-4444-4444-8444-444444444444',oid='11111111-1111-4111-8111-111111111111',qid='55555555-5555-4555-8555-555555555555';
const settings={provider:'seedream',model:'doubao-seedream-5.0-pro',aspectRatio:'16:9'as const,resolution:'2K'as const};
const brief={name:'Cup',facts:'White body',sellingPoints:'',platform:'amazon'as const,placement:'A+',productReferenceIds:[rid],styleReferenceIds:[]};
const modules=['品牌首屏','核心卖点']as const;
const plan:CommercePlan={scene:'detail',templateId:'detail-hero',brief,slots:modules.map((module,i)=>({...settings,id:'66666666-6666-4666-8666-66666666666'+i,role:module,module,outputSpec:'standard',targetWidth:970,targetHeight:600,referenceIds:[rid],instruction:'',exactText:''}))};
function setup(){
 const posts:Array<Record<string,unknown>>=[];let current:Record<string,unknown>|undefined;let task:CommerceTask|undefined;
 const quote={id:qid,expiresAt:'2099-01-01',imageModel:settings.model,totalMinor:250,minimumMinor:50,settlementMode:'actual_capped',outputCount:2,selection:{modules:[...modules],advanced:false,referenceCount:1},imagePrices:[],rule:'fixture'};
 const base=()=>({id:oid,sessionId:sid,revision:1,status:'active',settled:false,quote,references:[{id:rid,role:'product'}],referenceSignature:'frozen',stages:[{key:'analysis',kind:'analysis',status:'pending',amountMinor:0},{key:'planning',kind:'planning',status:'pending',amountMinor:0},{key:'image:0',kind:'image',status:'pending',amountMinor:125},{key:'image:1',kind:'image',status:'pending',amountMinor:125}],settlement:{captureMinor:0,releaseMinor:0,pendingMinor:250}});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(!url.startsWith('/api/commerce-packages'))throw Error('Unexpected separately billed endpoint: '+url);
  if(!init?.method)return Response.json(url.includes('?')?current:{enabled:true});
  const body=JSON.parse(String(init.body));posts.push(body);
  if(body.action==='quote')return Response.json(quote);
  if(body.action==='accept'){expect(loadCommerceDraft('package-wizard')?.packageRecovery?.acceptRequestId).toBe(body.requestId);current=base();}
  if(body.action==='analyze')current={...current,revision:3,analysis:{observations:[{sourceId:rid,text:'White body',kind:'visible'}],styleSummary:'',missing:[],conflicts:[]}};
  if(body.action==='confirm')current={...current,revision:4,review:{name:body.name,facts:body.facts,styleSummary:body.styleSummary,referenceSignature:'frozen',platform:body.platform}};
  if(body.action==='plan')current={...current,revision:6,planning:{strategy:'Clean product layout',modules:modules.map(name=>({name,copy:'White body'}))}};
  if(body.action==='submit')current={...current,revision:7,taskId:body.taskId};
  return Response.json(current);
 }));
 const notExpected=async()=>{throw Error('Unexpected legacy mutation');};
 const legacySubmit=vi.fn(notExpected);
 const gateway={create:vi.fn(async(input:{plan:CommercePlan;sessionId:string})=>{task={...input.plan,id:'77777777-7777-4777-8777-777777777777',sessionId:input.sessionId,revision:1,createdAt:'2026-11-05',updatedAt:'2026-11-05',runs:[],selections:[],slotHashes:{},archived:false};return task;}),get:vi.fn(async()=>({...task!,packageOrderId:oid})),submit:legacySubmit,upload:notExpected,list:notExpected,save:notExpected,select:notExpected,export:notExpected,promote:notExpected,archive:notExpected,cancel:notExpected}as unknown as CommerceGateway;
 const saved=vi.fn();
 const props={scene:'detail'as const,sessionId:sid,draftKey:'package-wizard',gateway,seedPlan:plan,references:[{id:rid,name:'cup.png',size:1,mimeType:'image/png'as const,status:'ready'as const}],capabilities:IMAGE_PROVIDER_CAPABILITIES,settings,onReferenceAdd:vi.fn(),onReferenceRemove:vi.fn(),onReferenceUploaded:vi.fn(),onSaved:saved,onClose:vi.fn()};
 return{props,posts,saved,legacySubmit,gateway};
}
beforeEach(()=>{sessionStorage.clear();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();sessionStorage.clear();});
it('keeps separately billed field optimization out of the package flow',async()=>{
 const t=setup();render(<CommerceWizard {...t.props}/>);await screen.findByRole('button',{name:'查看整套最高费用'});
 expect(screen.queryByRole('button',{name:'AI 优化当前内容'})).toBeNull();
});
it('uses one package from analysis to output without the legacy text or image billing path',async()=>{
 const t=setup();render(<CommerceWizard {...t.props}/>);const quoteButton=await screen.findByRole('button',{name:'查看整套最高费用'});await waitFor(()=>expect(quoteButton).toBeEnabled());fireEvent.click(quoteButton);await screen.findByText(/最高冻结 2.50/);fireEvent.click(screen.getByRole('button',{name:'确认预算并分析'}));
 await screen.findByLabelText('检查并修改商品事实');fireEvent.click(screen.getByRole('button',{name:'确认商品资料，继续策划'}));await waitFor(()=>expect(t.posts.some(p=>p.action==='confirm')).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:/下一步：确认模块内容/}));
 fireEvent.click(screen.getByRole('button',{name:'AI 生成视觉策略与模块文案'}));await waitFor(()=>expect(t.posts.some(p=>p.action==='plan')).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'一键生成 2 张'}));await waitFor(()=>expect(t.saved).toHaveBeenCalled(),{timeout:10000});
 expect(t.posts.map(p=>p.action)).toEqual(['quote','accept','analyze','confirm','plan','submit']);expect(t.legacySubmit).not.toHaveBeenCalled();
 expect(t.saved.mock.calls[0]?.[0].packageOrderId).toBe(oid);
});

it('keeps ordinary-only OpenAI models out of unsupported commerce model selectors',()=>{
 const t=setup();const view=render(<CommerceWizard {...t.props} scene="xhs-poster" seedPlan={undefined}/>);
 fireEvent.click(screen.getByLabelText('电商生成模型'));expect(screen.getByRole('listbox')).toBeInTheDocument();expect(screen.queryAllByRole('option',{name:/GPT Image/})).toHaveLength(0);view.unmount();
 render(<CommercePlanFields plan={plan} capabilities={IMAGE_PROVIDER_CAPABILITIES} onChange={vi.fn()}/>);
 fireEvent.click(screen.getByLabelText('第 1 张模型'));expect(screen.getByRole('listbox')).toBeInTheDocument();expect(screen.queryAllByRole('option',{name:/GPT Image/})).toHaveLength(0);
 expect(IMAGE_PROVIDER_CAPABILITIES.find(p=>p.provider==='openai')?.models).toHaveLength(2);
});
