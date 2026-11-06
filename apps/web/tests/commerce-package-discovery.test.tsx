import{expect,it,vi}from'vitest';
import{render,screen}from'@testing-library/react';
import{CommercePackageRecoveryList}from'@/features/commerce/CommercePackageRecoveryList';
it('finds an owned unsettled order after browser recovery storage is gone, without another purchase',async()=>{
 sessionStorage.clear();
 const client={list:vi.fn().mockResolvedValue(['11111111-1111-4111-8111-111111111111']),read:vi.fn().mockRejectedValue(Error('temporary read failure')),available:async()=>false,post:vi.fn()};
 render(<CommercePackageRecoveryList client={client}/>);
 expect(await screen.findByText(/整套订单 11111111/)).toBeInTheDocument();
 expect(client.list).toHaveBeenCalledOnce();expect(client.post).not.toHaveBeenCalled();
});