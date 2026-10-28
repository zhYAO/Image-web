import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideSelect } from '@/features/controls/GlideSelect';

const options = [
  { value:'a', label:'Alpha', textValue:'Alpha' },
  { value:'b', label:'Beta unavailable', textValue:'Beta unavailable', disabled:true },
  { value:'c', label:'Charlie', textValue:'Charlie' },
];
function Control({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('a');
  return <GlideSelect ariaLabel="选择模型" includeValueInLabel options={options} value={value} onChange={setValue} disabled={disabled}/>;
}
afterEach(() => vi.restoreAllMocks());
describe('shared accessible selection', () => {
  it('skips unavailable choices with keyboard and ignores a click on a disabled row', () => {
    render(<Control/>);
    fireEvent.click(screen.getByRole('combobox'));
    const disabled = screen.getByRole('option', { name:'Beta unavailable' });
    expect(disabled).toHaveAttribute('aria-disabled','true');
    fireEvent.click(disabled);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-label','选择模型 Alpha');
    fireEvent.keyDown(screen.getByRole('listbox'), { key:'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key:'Enter' });
    expect(screen.getByRole('combobox', { name:'选择模型 Charlie' })).toHaveFocus();
  });
  it('keeps its portal in a native dialog and restores focus on Escape', () => {
    render(<dialog open><Control/></dialog>);
    fireEvent.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox');
    expect(list.closest('dialog')).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(list, { key:'c' });
    fireEvent.keyDown(list, { key:'Enter' });
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-label','选择模型 Charlie');
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.keyDown(screen.getByRole('listbox'), { key:'Escape' });
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('invalidates an open menu when externally disabled', () => {
    const view = render(<Control/>);
    fireEvent.click(screen.getByRole('combobox'));
    view.rerender(<Control disabled/>);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox')).toBeDisabled();
    view.rerender(<Control/>);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('bounds a menu on a narrow viewport and dismisses it after outside scrolling', () => {
    vi.spyOn(window,'innerWidth','get').mockReturnValue(390);
    vi.spyOn(window,'innerHeight','get').mockReturnValue(844);
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({ x:350,y:760,left:350,right:450,top:760,bottom:800,width:100,height:40,toJSON(){} });
    render(<Control/>);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox').parentElement).toHaveStyle({ width:'280px',left:'98px' });
    fireEvent.scroll(window);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });
});
