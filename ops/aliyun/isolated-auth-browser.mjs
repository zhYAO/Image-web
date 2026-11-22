import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { symlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const check = (value, label) => { if (!value) throw new Error(label); };
export function playwrightPath(project) {
  const app = createRequire(path.join(project, 'apps/web/package.json'));
  const next = createRequire(app.resolve('next/package.json'));
  const pkg = next.resolve('@playwright/test/package.json');
  check(createRequire(pkg)(pkg).version === '1.62.1', 'Pinned Chromium driver mismatch');
  return next.resolve('@playwright/test');
}

export async function browserAuth({ project, frontend, scratch, namespace, backendPort, ingressPort, email, password, userId, commit }) {
  const { chromium } = createRequire(import.meta.url)(playwrightPath(project));
  check(/^rehearsal-[a-f0-9]{40}-[0-9]+-[0-9]+$/.test(namespace) && /^[\w/.\-]+$/.test(scratch), 'Invalid disposable ingress paths');
  const site = path.join(scratch, 'browser-site');
  await mkdir(path.join(site, 'frontend-assets'), { recursive: true });
  await symlink(frontend, path.join(site, 'frontend-assets', namespace), 'dir');
  const config = path.join(scratch, 'nginx.conf');
  await writeFile(config, `pid ${scratch}/nginx.pid;
error_log stderr crit;
events {}
http {
  include /etc/nginx/mime.types;
  access_log off;
  client_body_temp_path ${scratch}/body;
  proxy_temp_path ${scratch}/proxy;
  fastcgi_temp_path ${scratch}/fastcgi;
  uwsgi_temp_path ${scratch}/uwsgi;
  scgi_temp_path ${scratch}/scgi;
  server {
    listen 127.0.0.1:${ingressPort};
    root ${site};
    location = /home { default_type text/html; alias ${site}/frontend-assets/${namespace}/home/index.html; }
    location = /login { default_type text/html; alias ${site}/frontend-assets/${namespace}/app.html; }
    location = /workspace { default_type text/html; alias ${site}/frontend-assets/${namespace}/app.html; }
    location = /account { default_type text/html; alias ${site}/frontend-assets/${namespace}/app.html; }
    location /frontend-assets/${namespace}/assets/ { try_files $uri =404; }
    location /api/ {
      proxy_set_header Host $http_host;
      proxy_set_header X-Real-IP 127.0.0.1;
      proxy_pass http://127.0.0.1:${backendPort};
    }
    location / { return 404; }
  }
}
`, { mode: 0o600, flag: 'wx' });
  const origin = 'http://127.0.0.1:' + ingressPort;
  const nginx = spawn('nginx', ['-c', config, '-p', scratch, '-g', 'daemon off;'], { stdio: 'ignore' });
  let browser, stage = 'Disposable Nginx readiness failed';
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (nginx.exitCode !== null) break;
      if (await fetch(origin + '/home', { signal: AbortSignal.timeout(1000), redirect: 'error' }).then(x => x.ok && /text\/html/.test(x.headers.get('content-type') ?? ''), () => false)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    check(ready && nginx.exitCode === null, stage);
    stage = 'Disposable browser startup failed';
    browser = await chromium.launch({ args: ['--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'] });
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      return url.origin === origin && (['GET', 'HEAD'].includes(req.method()) ||
        (req.method() === 'POST' && ['/api/auth/login','/api/auth/logout'].includes(url.pathname)))
        ? route.continue() : route.abort();
    });
    await ctx.routeWebSocket('**/*', socket => socket.close());
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const cta = target => page.locator('a[href="' + target + '"]').filter({ hasText: '开始创作', visible: true }).first();
    const session = () => page.evaluate(async () => { const r = await fetch('/api/auth/session'); return { status: r.status, body: r.ok ? await r.json() : null }; });
    const scriptPrefix = origin + '/frontend-assets/' + namespace + '/assets/';
    stage = 'Browser Home document failed';
    const script = page.waitForResponse(r => r.url().startsWith(scriptPrefix) && r.request().resourceType() === 'script', { timeout: 15000 }).catch(() => null);
    const document = await page.goto(origin + '/home', { waitUntil: 'domcontentloaded' });
    check(document?.ok() && /text\/html/.test(document.headers()['content-type'] ?? ''), stage);
    stage = 'Browser Home namespace JavaScript failed';
    const module = await script;
    check(module?.ok() && /javascript/.test(module.headers()['content-type'] ?? ''), stage);
    const readJson = pathname => page.evaluate(async url => {
      const r = await fetch(url, { cache: 'no-store', redirect: 'error' });
      return { ok: r.ok, body: r.ok && /^application\/json/i.test(r.headers.get('content-type') ?? '') ? await r.json() : null };
    }, pathname);
    stage = 'Browser public config failed';
    const config = await readJson('/api/public-config');
    check(config.ok && config.body?.formalAuth === true && config.body?.dataMode === 'http', stage);
    stage = 'Browser backend identity failed';
    const homeMeta = await readJson('/api/meta');
    check(homeMeta.ok && homeMeta.body?.backendRelease === commit, stage);
    stage = 'Browser guest session failed';
    check((await session()).status === 401, stage);
    stage = 'Browser guest workspace link not visible';
    const guestTarget = '/login?returnTo=%2Fworkspace';
    const guest = cta(guestTarget);
    await guest.waitFor({ state: 'visible' });
    stage = 'Browser guest workspace link click failed';
    await guest.click();
    stage = 'Browser login route failed';
    const isLogin = url => url.origin === origin && url.pathname === '/login' && url.searchParams.get('returnTo') === '/workspace';
    await page.waitForURL(isLogin);
    stage = 'Browser login form email field missing';
    const loginForm = page.locator('form').filter({ has: page.locator('input[name=email]') });
    await loginForm.locator('input[name=email][type=email]').fill(email);
    stage = 'Browser login form password field missing';
    await loginForm.locator('input[name=password][type=password]').fill(password);
    stage = 'Browser login or exact session failed';
    const [login] = await Promise.all([
      page.waitForResponse(r => r.url() === origin + '/api/auth/login' && r.request().method() === 'POST'),
      loginForm.locator('button[type=submit]').click(),
    ]);
    check(login.ok(), stage);
    await page.waitForURL(origin + '/workspace');
    check((await session()).body?.id === userId, stage);
    stage = 'Signed in Home and Vite workspace failed';
    await page.goto(origin + '/home');
    await cta('/workspace').click();
    await page.waitForURL(origin + '/workspace');
    const scripts = [];
    page.on('response', r => {
      if (r.ok() && r.url().startsWith(origin + '/frontend-assets/' + namespace + '/') &&
          r.request().resourceType() === 'script' && /javascript/.test(r.headers()['content-type'] ?? '')) scripts.push(r.url());
    });
    const meta = page.waitForResponse(r => r.url() === origin + '/api/meta' && r.ok());
    await page.goto(origin + '/workspace');
    check((await (await meta).json()).backendRelease === commit, stage);
    await page.locator('textarea').filter({ visible: true }).first().waitFor();
    check(scripts.length > 0 && (await session()).body?.id === userId, stage);
    stage = 'Browser account sign out failed';
    await page.goto(origin + '/account');
    const [logout] = await Promise.all([
      page.waitForResponse(r => r.url() === origin + '/api/auth/logout' && r.request().method() === 'POST'),
      page.getByRole('button', { name: '退出登录', exact: true }).click(),
    ]);
    check(logout.ok(), stage);
    await page.waitForURL(origin + '/home');
    check((await session()).status === 401, stage);
    await cta(guestTarget).waitFor();
  } catch {
    throw new Error(stage);
  } finally {
    try { await browser?.close(); } finally { nginx.kill('SIGTERM'); }
  }
}
