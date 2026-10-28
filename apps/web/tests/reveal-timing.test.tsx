import { act, fireEvent, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FadeContent from '@/features/brand/react-bits/FadeContent';
import { Reveal } from '@/features/brand/landing/Reveal';

class Observer {
  static instances: Observer[] = [];
  constructor(private callback: IntersectionObserverCallback) { Observer.instances.push(this); }
  observe() {}
  disconnect() {}
  emit() { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Observer.instances = []; });
const rectAt = (top: number) => ({ top, bottom: top + 100, left:0, right:100, width:100, height:100, x:0, y:top, toJSON() {} });
describe('first-scroll reveal timing', () => {
  it('registers the actual landing Reveal host before the layout animation controller runs', () => {
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(2000));
    const animate = vi.fn().mockReturnValue({ cancel:vi.fn(), pause:vi.fn(), play:vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable:true, value:animate });
    const view = render(<Reveal>真正的首页模块</Reveal>);
    expect(view.container.firstElementChild).toHaveStyle({ opacity:'0' });
    expect(Observer.instances).toHaveLength(1);
    act(() => Observer.instances[0]!.emit());
    expect(animate).toHaveBeenCalledOnce();
  });
  it('prepares offscreen content before entry and clears hidden styles when animation starts', () => {
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(2000));
    const animation = { cancel: vi.fn(), pause: vi.fn(), play: vi.fn(), onfinish: null };
    const animate = vi.fn().mockReturnValue(animation);
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable:true, value:animate });
    const view = render(<FadeContent distance={28}>商品场景</FadeContent>);
    expect(view.container.firstElementChild).toHaveStyle({ opacity: '0' });
    act(() => Observer.instances[0]!.emit());
    expect(animate).toHaveBeenCalledOnce();
    expect((view.container.firstElementChild as HTMLElement).style.opacity).toBe('');
    view.unmount();
    expect(animation.cancel).toHaveBeenCalled();
  });
  it('never fades already-visible content back to zero after late hydration', () => {
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(100));
    const animate = vi.fn().mockReturnValue({ cancel:vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable:true, value:animate });
    const view = render(<FadeContent>已看到的内容</FadeContent>);
    act(() => Observer.instances.forEach(observer => observer.emit()));
    expect(animate).not.toHaveBeenCalled();
    expect((view.container.firstElementChild as HTMLElement).style.opacity).toBe('');
  });
  it('reveals prepared content immediately on keyboard focus', () => {
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(2000));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable:true, value:vi.fn() });
    const view = render(<FadeContent><a href="/workspace">创作</a></FadeContent>);
    expect(view.container.firstElementChild).toHaveStyle({ opacity: '0' });
    fireEvent.focus(view.getByRole('link'));
    expect((view.container.firstElementChild as HTMLElement).style.opacity).toBe('');
  });
  it('does not move a running reveal under the pointer when its link receives focus', () => {
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(2000));
    const animation = { cancel:vi.fn(), pause:vi.fn(), play:vi.fn() };
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable:true, value:vi.fn().mockReturnValue(animation) });
    const view = render(<Reveal><a href="/login">开始创作</a></Reveal>);
    act(() => Observer.instances[0]!.emit());
    const link = view.getByRole('link');
    vi.spyOn(link, 'matches').mockReturnValue(false);
    fireEvent.focus(link);
    expect(animation.cancel).not.toHaveBeenCalled();
    vi.mocked(link.matches).mockReturnValue(true);
    fireEvent.focus(link);
    expect(animation.cancel).toHaveBeenCalledOnce();
  });
  it('keeps server/no-JS content visible', () => {
    const html = renderToString(<FadeContent>无需脚本也可阅读</FadeContent>);
    expect(html).toContain('无需脚本也可阅读');
    expect(html).not.toContain('opacity:0');
  });
});
