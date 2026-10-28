import { describe, expect, it, vi } from 'vitest';

import { normalizeReturnTo } from '../server/auth/redirects';
import { AuthService } from '../server/auth/auth-service';

describe('normalizeReturnTo', () => {
  it.each(['https://evil.example/x', '//evil.example/x', '/api/account', '/auth/confirm'])('rejects unsafe target %s', (target) => {
    expect(normalizeReturnTo(target)).toBe('/workspace');
  });

  it('preserves an internal skill intent', () => {
    expect(normalizeReturnTo('/?skill=white-background')).toBe('/?skill=white-background');
  });
});

describe('AuthService', () => {
  it('returns the same neutral registration result whether the provider creates a user or not', async () => {
    const signUp = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: 'user_already_exists' } });
    const service = new AuthService({ auth: { signUp } } as never);
    const input = { email: 'person@example.com', password: 'safe 长口令 !', legalVersion: 'draft-2026-09-06' };
    expect(await service.register(input)).toEqual({ accepted: true });
    expect(await service.register(input)).toEqual({ accepted: true });
  });

  it('verifies an email only after an explicit OTP submission', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ data: { user: { id: 'd9428888-122b-11e1-b85c-61cd3cbb3210' } }, error: null });
    const service = new AuthService({ auth: { verifyOtp } } as never);
    await service.verifyEmailOtp({ email: 'person@example.com', token: '123456', returnTo: '/' });
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'person@example.com', token: '123456', type: 'signup' });
  });

  it('maps every credential failure to the same public error', async () => {
    const service = new AuthService({ auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: { message: 'User not found' } }) } } as never);
    await expect(service.signIn({ email: 'nobody@example.com', password: 'wrong' })).rejects.toMatchObject({ code: 'unauthorized', reason: 'invalid_credentials', status: 401 });
  });
});
