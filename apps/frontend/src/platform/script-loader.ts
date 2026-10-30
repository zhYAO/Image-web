const turnstileUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let active: { script: HTMLScriptElement; promise: Promise<void> } | undefined;

/** One allowlisted script, retained across widgets; failed loads can be retried. */
export function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (active?.script.isConnected) return active.promise;
  const script = document.createElement('script');
  script.src = turnstileUrl;
  script.async = true;
  script.dataset.zimageTurnstile = 'true';
  const promise = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      script.remove();
      if (active?.script === script) active = undefined;
      reject(new Error('Security verification script unavailable'));
    }, { once: true });
  });
  active = { script, promise };
  document.head.append(script);
  return promise;
}
