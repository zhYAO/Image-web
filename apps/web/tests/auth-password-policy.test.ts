import { describe, expect, it, vi } from 'vitest';

import { validatePassword } from '../server/auth/password-policy';

describe('validatePassword', () => {
  it.each([
    ['counts Unicode code points', '图图图图图图图', 'too_short'],
    ['rejects more than 72 UTF-8 bytes', '图'.repeat(25), 'too_long'],
    ['rejects a local common password', 'password', 'common'],
  ])('%s', async (_name, password, reason) => {
    await expect(validatePassword(password)).resolves.toEqual({ ok: false, reason });
  });

  it('accepts spaces, Chinese and symbols inside the byte limit', async () => {
    await expect(validatePassword('山 海! 安全口令')).resolves.toEqual({ ok: true });
    await expect(validatePassword('1234567 ')).resolves.toEqual({ ok: true });
  });

  it('rejects a password found by HIBP k-anonymity without sending the password', async () => {
    let requestedUrl = '';
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response('BCA625F87F5F201C6996DA23D00BC56E11D:42\n');
    });
    await expect(validatePassword('uniquepassword123!', { fetcher })).resolves.toEqual({ ok: false, reason: 'breached' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(requestedUrl).not.toContain('uniquepassword123!');
  });

  it('fails open when HIBP is unavailable and reports only a safe reason', async () => {
    const report = vi.fn();
    await expect(validatePassword('safe 长口令 !', {
      fetcher: async () => { throw new Error('request leaked password?'); },
      report,
    })).resolves.toEqual({ ok: true });
    expect(report).toHaveBeenCalledWith('hibp_unavailable');
  });
});
