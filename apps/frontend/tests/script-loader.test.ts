import { afterEach, describe, expect, it } from 'vitest';
import { loadTurnstileScript } from '../src/platform/script-loader';

afterEach(() => { document.querySelectorAll('script[data-zimage-turnstile]').forEach(node => node.remove()); delete window.turnstile; });
describe('single Turnstile script lifecycle', () => {
  it('shares one pending script and does not remove it when a widget unmounts', async () => {
    const first = loadTurnstileScript();
    const second = loadTurnstileScript();
    expect(first).toBe(second);
    expect(document.querySelectorAll('script[data-zimage-turnstile]')).toHaveLength(1);
    const script = document.querySelector('script[data-zimage-turnstile]')!;
    script.dispatchEvent(new Event('load'));
    await Promise.all([first, second]);
    expect(document.contains(script)).toBe(true);
  });
  it('can retry after a failed script without duplicating a successful one', async () => {
    const failed = loadTurnstileScript();
    const rejected = expect(failed).rejects.toThrow('Security verification script unavailable');
    document.querySelector('script[data-zimage-turnstile]')!.dispatchEvent(new Event('error'));
    await rejected;
    const retry = loadTurnstileScript();
    expect(document.querySelectorAll('script[data-zimage-turnstile]')).toHaveLength(1);
    document.querySelector('script[data-zimage-turnstile]')!.dispatchEvent(new Event('load'));
    await retry;
  });
});
