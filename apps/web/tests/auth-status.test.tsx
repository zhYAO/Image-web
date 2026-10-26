import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthStatusProvider,
  notifyAuthChange,
  useAuthStatus,
} from "@/features/auth/AuthStatusProvider";
import { PublicCommerceCatalogue } from "@/features/commerce/PublicCommerceCatalogue";
import { catalogueRuntimeAllowed } from "@/features/workspace/catalogue-runtime";
import { AnonymousAuthGate } from "@/app/anonymous-auth-gate";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

function Identity() {
  const { status, ownerId } = useAuthStatus();
  return <span>{status}:{ownerId ?? 'none'}</span>;
}

describe("shared authentication presentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    replace.mockReset();
  });
  it("shares one verified request across catalogue and workspace, including StrictMode", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: '10000000-0000-4000-8000-000000000001' }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(
      <StrictMode>
        <AuthStatusProvider>
          <PublicCommerceCatalogue /><Identity />
        </AuthStatusProvider>
      </StrictMode>,
    );
    expect(screen.queryByRole("link", { name: "登录" })).toBeNull();
    await screen.findByText('authorized:10000000-0000-4000-8000-000000000001');
    view.rerender(
      <StrictMode>
        <AuthStatusProvider>
          <AnonymousAuthGate>
            <span>创作已准备</span>
          </AnonymousAuthGate>
        </AuthStatusProvider>
      </StrictMode>,
    );
    expect(screen.getByText("创作已准备")).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/auth/session');
    expect(replace).not.toHaveBeenCalled();
  });
  it('never authorizes a malformed successful identity response', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    render(<AuthStatusProvider><Identity /></AuthStatusProvider>);
    await screen.findByText('error:none');
  });
  it('coalesces focus and visibility refresh and ignores superseded login requests', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    const pending: Array<(value: Response) => void> = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => pending.push(resolve)));
    vi.stubGlobal('fetch', fetcher);
    render(<AuthStatusProvider><Identity /></AuthStatusProvider>);
    act(() => notifyAuthChange(true));
    await act(async () => pending[0]!(new Response(JSON.stringify({ id: '10000000-0000-4000-8000-000000000001' }))));
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => pending[1]!(new Response(JSON.stringify({ id: '20000000-0000-4000-8000-000000000002' }))));
    expect(screen.getByText('authorized:20000000-0000-4000-8000-000000000002')).toBeVisible();
  });
  it("does not let an old in-flight account response undo a successful logout", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    let complete!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
    );
    render(
      <AuthStatusProvider>
        <PublicCommerceCatalogue />
      </AuthStatusProvider>,
    );
    act(() => {
      notifyAuthChange(false);
    });
    expect(screen.getByRole("link", { name: "登录" })).toBeVisible();
    await act(async () => complete(new Response("{}", { status: 200 })));
    expect(screen.getByRole("link", { name: "登录" })).toBeVisible();
  });
  it('keeps the guest catalogue public without requesting private sessions', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    render(<AuthStatusProvider><PublicCommerceCatalogue /></AuthStatusProvider>);
    await screen.findByRole('link', { name: '登录' });
    expect(screen.getAllByRole('link', { name: /^开始/ })).toHaveLength(5);
    expect(screen.queryByRole('link', { name: '开始批量生成' })).toBeNull();
    expect(screen.getByRole('button', { name: '新对话' })).toBeVisible();
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/auth/session']);
    expect(replace).not.toHaveBeenCalled();
  });
  it('never treats synthetic legacy HTTP authorization as catalogue runtime access', () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'false');
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    expect(catalogueRuntimeAllowed('authorized')).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
    expect(catalogueRuntimeAllowed('authorized')).toBe(true);
    expect(catalogueRuntimeAllowed('guest')).toBe(false);
  });
  it.each(['/?scene=product-set', '/create/product-set?platform=taobao', '/sessions/abc?task=xyz&view=results'])("returns an unauthenticated visitor from %s to the public homepage", async (path) => {
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    window.history.replaceState({}, "", path);
    render(
      <AuthStatusProvider>
        <AnonymousAuthGate>
          <span>private workspace</span>
        </AnonymousAuthGate>
      </AuthStatusProvider>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/home'),
    );
    expect(screen.queryByText("private workspace")).toBeNull();
    window.history.replaceState({}, "", "/");
  });
  it('keeps authentication failures closed and recovers only after a valid retry', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    render(<AuthStatusProvider><AnonymousAuthGate><p>protected editor</p></AnonymousAuthGate></AuthStatusProvider>);
    await screen.findByText('暂时无法检查登录状态，请重试。');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('protected editor')).toBeNull();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ id: '10000000-0000-4000-8000-000000000001' })));
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByText('protected editor')).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });
  it('treats a 15-second timeout as an error, preserving the option to retry', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms);
      return controller.signal;
    });
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })));
    render(<AuthStatusProvider><AnonymousAuthGate><p>protected editor</p></AnonymousAuthGate></AuthStatusProvider>);
    expect(timeout).toHaveBeenCalledWith(15000);
    await act(() => vi.advanceTimersByTimeAsync(14999));
    expect(screen.queryByText('暂时无法检查登录状态，请重试。')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('暂时无法检查登录状态，请重试。')).toBeVisible();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeVisible();
    expect(screen.queryByText('protected editor')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
  it('returns to the homepage after a confirmed logout without reviving a late identity', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: '10000000-0000-4000-8000-000000000001' })));
    vi.stubGlobal('fetch', fetcher);
    render(<AuthStatusProvider><AnonymousAuthGate><p>protected editor</p></AnonymousAuthGate></AuthStatusProvider>);
    await screen.findByText('protected editor');
    act(() => notifyAuthChange(false));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    expect(screen.queryByText('protected editor')).toBeNull();
  });
  it('does not redirect the public homepage to itself', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    window.history.replaceState({}, '', '/home');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<AuthStatusProvider><AnonymousAuthGate><p>protected editor</p></AnonymousAuthGate></AuthStatusProvider>);
    await screen.findByText(/正在.*首页/);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('protected editor')).toBeNull();
    window.history.replaceState({}, '', '/');
  });
});
