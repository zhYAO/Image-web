import {expect,it,vi}from'vitest';
import {render,screen,fireEvent}from'@testing-library/react';
import {CommercePackageStatus}from'@/features/commerce/CommercePackageStatus';
const orderId='11111111-1111-4111-8111-111111111111';
it('only reads a saved financial order and never resubmits model work',async()=>{
 const value={id:orderId,sessionId:orderId,revision:2,status:'completed',settled:true,quote:{imageModel:'doubao-seedream-5.0-pro',minimumMinor:50,totalMinor:250,settlementMode:'actual_capped',outputCount:2,selection:{modules:['品牌首屏'],advanced:true,referenceCount:1},imagePrices:[],rule:'fixture'},referenceSignature:'saved',references:[],taskId:orderId,stages:[],settlement:{captureMinor:130,releaseMinor:120,pendingMinor:0}};
 const client={available:async()=>false,read:vi.fn().mockResolvedValue(value),post:vi.fn()};
 render(<CommercePackageStatus orderId={orderId} client={client}/>);
 expect(await screen.findByText(/已收 1.30/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'刷新整套订单'}));
 expect(await screen.findByText(/已退 1.20/)).toBeInTheDocument();
 expect(client.read).toHaveBeenCalledWith({orderId});expect(client.post).not.toHaveBeenCalled();
});