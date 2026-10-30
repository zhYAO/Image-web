import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationProvider, useNavigation } from '../src/platform/navigation';
import Link from '../src/platform/link';
import { IntentLink } from '../src/platform/intent-link';
import { WorkspaceHost } from '../src/platform/workspace-host';
import { useState } from 'react';

function Location() {
  const navigation = useNavigation();
  return <><output data-testid="href">{navigation.href}</output><button onClick={() => navigation.replace('/workspace?scene=product-main', { scroll: false })}>replace</button></>;
}
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('browser navigation adapter', () => {
  it('keeps query/hash and honors click interception without a hard reload', () => {
    render(<NavigationProvider><Location /><Link href="/sessions/abc?task=t&batch=b&view=results#output" scroll={false}>session</Link></NavigationProvider>);
    fireEvent.click(screen.getByText('session'));
    expect(screen.getByTestId('href').textContent).toBe('/sessions/abc?task=t&batch=b&view=results#output');
    fireEvent.click(screen.getByText('replace'));
    expect(screen.getByTestId('href').textContent).toBe('/workspace?scene=product-main');
  });
  it('updates on history traversal and preserves home navigation state', () => {
    render(<NavigationProvider><Location /></NavigationProvider>);
    act(() => { window.history.pushState(null, '', '/workspace?x=1'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByTestId('href').textContent).toBe('/workspace?x=1');
    act(() => { window.history.replaceState(null, '', '/home'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByTestId('href').textContent).toBe('/home');
  });
  it('does not intercept modified, download, target or API links', () => {
    const push = vi.spyOn(window.history, 'pushState');
    // Let the component handler run, then suppress jsdom's unsupported native
    // document navigation. Native navigation itself belongs to browser checks.
    const suppressNative = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('click', suppressNative);
    render(<NavigationProvider><Link href="/workspace" target="_blank">new tab</Link><Link href="/workspace" download>download</Link><Link href="/api/meta">api</Link><Link href="/workspace">modified</Link></NavigationProvider>);
    fireEvent.click(screen.getByText('new tab'));
    fireEvent.click(screen.getByText('download'));
    fireEvent.click(screen.getByText('api'));
    fireEvent.click(screen.getByText('modified'), { ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
    document.removeEventListener('click', suppressNative);
    push.mockRestore();
  });
  it('warms an injected workspace loader only on user intent', () => {
    const preload = vi.fn();
    render(<NavigationProvider prefetchWorkspace={preload}><Link href="/workspace" prefetch={null}>workspace</Link></NavigationProvider>);
    expect(preload).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByText('workspace'));
    expect(preload).toHaveBeenCalledOnce();
  });
  it('warms the existing IntentLink on its first pointer or touch intent', () => {
    const preload = vi.fn();
    render(<NavigationProvider prefetchWorkspace={preload}><IntentLink href="/create/product-main">create</IntentLink></NavigationProvider>);
    expect(preload).not.toHaveBeenCalled();
    fireEvent.mouseEnter(screen.getByText('create'));
    expect(preload).toHaveBeenCalledOnce();
    fireEvent.touchStart(screen.getByText('create'));
    expect(preload).toHaveBeenCalledTimes(2);
  });
});

function Draft() {
  const [draft, setDraft] = useState('');
  return <input aria-label="draft" value={draft} onChange={event => setDraft(event.target.value)} />;
}
describe('single workspace host', () => {
  it('retains drafts while navigating home and back; owner changes reset', () => {
    const content = (active: boolean, ownerId: string | null, status: 'authorized' | 'guest' = 'authorized') => <WorkspaceHost active={active} ownerId={ownerId} status={status} renderWorkspace={() => <Draft />}>public</WorkspaceHost>;
    const view = render(content(true, 'owner-a'));
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'unresolved draft' } });
    view.rerender(content(false, 'owner-a'));
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('unresolved draft');
    expect(screen.getByLabelText('draft').closest('[hidden]')).not.toBeNull();
    view.rerender(content(true, 'owner-a'));
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('unresolved draft');
    view.rerender(content(true, 'owner-b'));
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
    view.rerender(content(true, null, 'guest'));
    expect(screen.queryByLabelText('draft')).toBeNull();
  });
  it('does not create an editor for a first public visit', () => {
    const load = vi.fn(() => <Draft />);
    render(<WorkspaceHost active={false} ownerId="owner-a" status="authorized" renderWorkspace={load}>public</WorkspaceHost>);
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps public form state when the identity check resolves to guest', () => {
    const view = render(<WorkspaceHost active={false} ownerId={null} status="checking" renderWorkspace={() => null}><Draft /></WorkspaceHost>);
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'typed email' } });
    view.rerender(<WorkspaceHost active={false} ownerId={null} status="guest" renderWorkspace={() => null}><Draft /></WorkspaceHost>);
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('typed email');
  });
});
