import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {CommerceAnalysisPanel} from '@/features/commerce/CommerceAnalysisPanel';
const result={observations:[{sourceId:'11111111-1111-4111-8111-111111111111',text:'白色外观',kind:'visible'}],styleSummary:'',missing:['容量'],conflicts:[]};
describe('analysis review',()=>{
 it('requires explicit confirmation and rejects results after images change',async()=>{
 const confirm=vi.fn();const analyze=vi.fn().mockResolvedValue(result);
 const view=render(<CommerceAnalysisPanel signature="a" onAnalyze={analyze} onConfirm={confirm}/>);
 fireEvent.click(screen.getByRole('button',{name:'分析图片'}));
 await screen.findByText(/以下内容是待核实/);expect(confirm).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('检查并修改商品事实'),{target:{value:'用户核实后的外观'}});
 fireEvent.click(screen.getByRole('button',{name:'确认商品资料，继续策划'}));
 expect(confirm).toHaveBeenCalledWith('用户核实后的外观','','a');
 view.rerender(<CommerceAnalysisPanel signature="b" onAnalyze={analyze} onConfirm={confirm}/>);
 expect(screen.getByRole('button',{name:'确认商品资料，继续策划'})).toBeDisabled();
 });
 it('keeps failures separate from confirmed facts',async()=>{
 const confirm=vi.fn();render(<CommerceAnalysisPanel signature="a" onAnalyze={async()=>{throw Error('计费未批准')}} onConfirm={confirm}/>);
 fireEvent.click(screen.getByRole('button',{name:'分析图片'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('计费未批准'));expect(confirm).not.toHaveBeenCalled();
 });
});
