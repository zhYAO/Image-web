import { act, render, screen, waitFor } from "@testing-library/react";
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
  it.each(['/?scene=product-set', '/create/product-set?platform=taobao', '/sessions/abc?task=xyz&view=results'])("preserves %s when an expired account redirects to login", async (path) => {
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
      expect(replace).toHaveBeenCalledWith(
        `/login?returnTo=${encodeURIComponent(path)}`,
      ),
    );
    expect(screen.queryByText("private workspace")).toBeNull();
    window.history.replaceState({}, "", "/");
  });
});
