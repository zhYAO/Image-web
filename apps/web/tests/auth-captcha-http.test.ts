import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { signUp: vi.fn(), signInWithPassword: vi.fn(), resend: vi.fn(), resetPasswordForEmail: vi.fn() }, rpc: vi.fn() }));
vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../lib/supabase/server', () => ({ createSupabaseServerClient: () => ({ auth: mocks.auth }) }));
vi.mock('../server/observability', () => ({ reportServerError: vi.fn() }));
vi.mock('../server/auth/password-policy', () => ({ validatePassword: async () => ({ ok: true }) }));
import { POST as register } from '../app/api/auth/register/route';
import { POST as login } from '../app/api/auth/login/route';
import { POST as resend } from '../app/api/auth/resend/route';
import { POST as recovery } from '../app/api/auth/recovery/route';

const flows = [
  { name: 'register', post: register, method: 'signUp', options: { captchaToken: 'fresh-challenge', data: { accepted_legal_version: 'approved-test' } } },
  { name: 'login', post: login, method: 'signInWithPassword', options: { captchaToken: 'fresh-challenge' } },
  { name: 'resend', post: resend, method: 'resend', options: { captchaToken: 'fresh-challenge' } },
  { name: 'recovery', post: recovery, method: 'resetPasswordForEmail', options: { captchaToken: 'fresh-challenge', redirectTo: 'http://localhost:3000/auth/reset' } },
] as const;
function request(name: string, captchaToken?: string) {
  return new Request(`http://localhost:3000/api/auth/${name}`, { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'audit@example.com', password: 'Unique-4G!qR8', legalVersion: 'approved-test', captchaToken }) });
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
  vi.stubEnv('APPROVED_LEGAL_VERSION', 'approved-test');
  mocks.rpc.mockResolvedValue({ data: { allowed: true }, error: null });
  Object.values(mocks.auth).forEach((method) => method.mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('CAPTCHA survives the browser → route → Supabase boundary', () => {
  it.each(flows)('$name forwards the challenge instead of discarding it during validation', async ({ name, post, method, options }) => {
    expect((await post(request(name, 'fresh-challenge'))).status).toBe(200);
    if (method === 'resetPasswordForEmail') expect(mocks.auth[method]).toHaveBeenCalledWith('audit@example.com', options);
    else expect(mocks.auth[method]).toHaveBeenCalledWith(expect.objectContaining({ email: 'audit@example.com', options }));
  });
  it.each(flows)('$name rejects missing challenges before consuming attempt limits', async ({ name, post, method }) => {
    const response = await post(request(name));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: expect.stringMatching(/安全验证/) });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.auth[method]).not.toHaveBeenCalled();
  });
  it.each(flows)('$name reports a rejected CAPTCHA as a verification problem', async ({ name, post, method }) => {
    mocks.auth[method].mockResolvedValue({ data: null, error: { code: 'captcha_failed', status: 400 } });
    const response = await post(request(name, 'fresh-challenge'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: expect.stringMatching(/安全验证/) });
  });
});
