import { createHash } from 'node:crypto';

const COMMON_PASSWORDS = new Set([
  '12345678', 'password', 'password1', 'password123', 'password123!',
  'qwerty123', '11111111', 'abcdefgh', 'admin123',
]);

type PasswordResult = { ok: true } | { ok: false; reason: 'too_short' | 'too_long' | 'common' | 'breached' };

export async function validatePassword(password: string, options: {
  fetcher?: typeof fetch;
  report?: (reason: 'hibp_unavailable') => void;
} = {}): Promise<PasswordResult> {
  if ([...password].length < 8) return { ok: false, reason: 'too_short' };
  if (Buffer.byteLength(password, 'utf8') > 72) return { ok: false, reason: 'too_long' };
  if (COMMON_PASSWORDS.has(password.toLocaleLowerCase('en-US'))) return { ok: false, reason: 'common' };

  if (!options.fetcher) return { ok: true };
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  try {
    const response = await options.fetcher(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!response.ok) throw new Error('hibp_status');
    const suffix = digest.slice(5);
    const breached = (await response.text()).split(/\r?\n/u).some((line) => line.split(':', 1)[0] === suffix);
    return breached ? { ok: false, reason: 'breached' } : { ok: true };
  } catch {
    options.report?.('hibp_unavailable');
    return { ok: true };
  }
}
