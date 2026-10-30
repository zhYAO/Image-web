import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Application, prefetchWorkspace } from '../src/application';
import { NavigationProvider } from '../src/platform/navigation';
import { RuntimeProvider } from '../src/platform/runtime-provider';
import { notifyAuthChange } from '../src/platform/auth-status';
import { useWorkspaceStore } from '../../web/store/workspace-store';
import { clearWorkspaceAssetCaches } from '../src/platform/gateways';
import { TRIAL_CREDIT_CATALOG } from '@zimage/domain';
const ownerA='11111111-1111-4111-8111-111111111111';
const ownerB='22222222-2222-4222-8222-222222222222';
const config={schemaVersion:1,formalAuth:true,dataMode:'http',captchaSiteKey:null,approvedLegalVersion:null,registrationEnabled:false};
const meta={schemaVersion:1,backendRelease:'a'.repeat(40),api:{major:1,minor:0},capabilities:['runtime.meta.v1']};
const descriptor={apiRequirements:{major:1,minMinor:0,capabilities:['runtime.meta.v1']},allowedBackendReleases:[meta.backendRelease]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('discards a late previous-owner create-session rejection',async()=>{
 clearWorkspaceAssetCaches(); window.history.replaceState(null,'','/workspace'); window.sessionStorage.clear(); useWorkspaceStore.getState().reset();
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}); vi.stubGlobal('scrollTo',()=>{});
 let currentOwner=ownerA; let failCreate:((error:Error)=>void)|undefined;
 const methods:string[]=[];
 const request=vi.fn(async(path:RequestInfo|URL,init?:RequestInit)=>{
  const method=init?.method??'GET'; methods.push(method+' '+path);
  if(method==='POST'&&path==='/api/sessions')return new Promise<Response>((_,reject)=>{failCreate=reject;});
  if(method!=='GET')throw new Error('UNEXPECTED BUSINESS POST BLOCKED '+path);
  const data:Record<string,unknown>={
   '/api/public-config':config,'/api/meta':meta,'/api/auth/session':{id:currentOwner},
   '/api/credits/pricing':TRIAL_CREDIT_CATALOG,'/api/credits':{availableMinor:1000,frozenMinor:0,spentMinor:0},
   '/api/sessions':{sessions:[]},'/api/skills':{registryVersion:'fixture-v1',skills:[]},
   '/api/quotas':{limit:10,used:0,resetsAt:new Date().toISOString()},
   '/api/health/providers':{registryVersion:'fixture-v1',capabilities:[],health:[]}};
  if(!(String(path) in data))throw new Error('Unexpected HTTP path '+path);
  return Response.json(data[String(path)]);
 });
 vi.stubGlobal('fetch',request);
 render(<StrictMode><NavigationProvider prefetchWorkspace={prefetchWorkspace}><RuntimeProvider descriptor={descriptor}><Application/></RuntimeProvider></NavigationProvider></StrictMode>);
 const input=await screen.findByLabelText('创作输入',{}, {timeout:20000});
 await waitFor(()=>expect(methods).toContain('GET /api/credits'));
 fireEvent.change(input,{target:{value:'A confidential delayed draft'}});
 fireEvent.keyDown(input,{key:'Enter',code:'Enter',shiftKey:false});
 await waitFor(()=>expect(failCreate).toBeDefined());
 act(()=>notifyAuthChange(false));
 await waitFor(()=>expect(screen.queryByLabelText('创作输入')).toBeNull());
 currentOwner=ownerB;
 act(()=>{notifyAuthChange(true);window.history.pushState(null,'','/workspace');window.dispatchEvent(new PopStateEvent('popstate'));});
 const bInput=await screen.findByLabelText('创作输入',{}, {timeout:20000});
 expect((bInput as HTMLTextAreaElement).value).toBe('');
 await act(async()=>{failCreate?.(new Error('late create-session connection failure'));await Promise.resolve();});
 expect((screen.getByLabelText('创作输入') as HTMLTextAreaElement).value).toBe('');
 expect(useWorkspaceStore.getState().composers).toEqual({});
},30000);

it('does not continue previous-owner creation with a business POST',async()=>{
 clearWorkspaceAssetCaches(); window.history.replaceState(null,'','/workspace'); window.sessionStorage.clear(); useWorkspaceStore.getState().reset();
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}); vi.stubGlobal('scrollTo',()=>{});
 let currentOwner=ownerA; let finishCreate:((response:Response)=>void)|undefined; let postedChat:unknown;
 const methods:string[]=[];
 const request=vi.fn(async(path:RequestInfo|URL,init?:RequestInit)=>{
  const method=init?.method??'GET'; methods.push(method+' '+path);
  if(method==='POST'&&path==='/api/sessions')return new Promise<Response>((resolve)=>{finishCreate=resolve;});
  if(method==='POST'&&path==='/api/chat'){postedChat={currentOwner,body:JSON.parse(String(init?.body))};return Response.json({code:'not_found',message:'stub rejects old owner',retryable:false},{status:403});}
  if(method!=='GET')throw new Error('UNEXPECTED BUSINESS POST BLOCKED '+path);
  const data:Record<string,unknown>={
   '/api/public-config':config,'/api/meta':meta,'/api/auth/session':{id:currentOwner},
   '/api/credits/pricing':TRIAL_CREDIT_CATALOG,'/api/credits':{availableMinor:1000,frozenMinor:0,spentMinor:0},
   '/api/sessions':{sessions:[]},'/api/skills':{registryVersion:'fixture-v1',skills:[]},
   '/api/quotas':{limit:10,used:0,resetsAt:new Date().toISOString()},
   '/api/health/providers':{registryVersion:'fixture-v1',capabilities:[],health:[]}};
  if(!(String(path) in data))throw new Error('Unexpected HTTP path '+path);
  return Response.json(data[String(path)]);
 });
 vi.stubGlobal('fetch',request);
 render(<StrictMode><NavigationProvider prefetchWorkspace={prefetchWorkspace}><RuntimeProvider descriptor={descriptor}><Application/></RuntimeProvider></NavigationProvider></StrictMode>);
 const input=await screen.findByLabelText('创作输入',{}, {timeout:20000});
 await waitFor(()=>expect(methods).toContain('GET /api/credits'));
 fireEvent.change(input,{target:{value:'A confidential delayed draft'}});
 fireEvent.keyDown(input,{key:'Enter',code:'Enter',shiftKey:false});
 await waitFor(()=>expect(finishCreate).toBeDefined());
 act(()=>notifyAuthChange(false));
 await waitFor(()=>expect(screen.queryByLabelText('创作输入')).toBeNull());
 currentOwner=ownerB;
 act(()=>{notifyAuthChange(true);window.history.pushState(null,'','/workspace');window.dispatchEvent(new PopStateEvent('popstate'));});
 const bInput=await screen.findByLabelText('创作输入',{}, {timeout:20000});
 expect((bInput as HTMLTextAreaElement).value).toBe('');
 await act(async()=>{finishCreate?.(Response.json({session:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'active',title:'A session',createdAt:'2026-10-30T00:00:00.000Z',updatedAt:'2026-10-30T00:00:00.000Z'}}));await Promise.resolve();});
 expect(methods).not.toContain('POST /api/chat');
 expect(postedChat).toBeUndefined();
 expect(useWorkspaceStore.getState().composers).toEqual({});
},30000);
