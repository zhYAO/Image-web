import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { symlink, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const check = (value, label) => { if (!value) throw new Error(label); };
export function playwrightPath(project) {
  const app = createRequire(path.join(project, 'apps/web/package.json'));
  const next = createRequire(app.resolve('next/package.json'));
  const pkg = next.resolve('@playwright/test/package.json');
  check(createRequire(pkg)(pkg).version === '1.62.1', 'Pinned Chromium driver mismatch');
  return next.resolve('@playwright/test');
}

export async function browserAuth({ project, frontend, scratch, namespace, backendPort, ingressPort, email, password, userId, commit, retained, shadow = false, isolatedUpstream = false }) {
  const { chromium } = createRequire(import.meta.url)(playwrightPath(project));
  check((shadow ? /^[a-f0-9]{40}$/.test(commit) && namespace === 'release-' + commit.slice(0, 12) : /^rehearsal-[a-f0-9]{40}-[0-9]+-[0-9]+$/.test(namespace)) && /^[\w/.\-]+$/.test(scratch), 'Invalid disposable ingress paths');
  check(typeof isolatedUpstream === 'boolean' && Number.isInteger(backendPort) && backendPort >= 1024 && backendPort <= 65535,
    'Invalid fixture upstream port');
  check(!isolatedUpstream || (shadow && !retained && backendPort === 3100 && process.platform === 'linux' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN),
    'Container upstream requires isolated trusted host supervisor');
  const host = isolatedUpstream ? '172.31.219.2' : '127.0.0.1';
  const site = path.join(scratch, 'browser-site');
  await mkdir(path.join(site, 'frontend-assets'), { recursive: true });
  await symlink(frontend, path.join(site, 'frontend-assets', namespace), 'dir');
  const front = target => path.join(site, 'frontend-assets', target);
  const current = path.join(site, 'current');
  const upstream = path.join(scratch, 'upstream.conf');
  if (retained) {
    check(/^rehearsal-7a811b326aa4b344cee08bc5a33c04e44a780fd4-[0-9]+-[0-9]+$/.test(retained.namespace), 'Invalid reconstructed namespace');
    await symlink(retained.frontend, front(retained.namespace), 'dir');
  }
  await symlink(front(namespace), current, 'dir');
  await writeFile(upstream, `proxy_pass http://${host}:${backendPort};\n`, { flag: 'wx', mode: 0o600 });
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
    location = /home { default_type text/html; alias ${current}/home/index.html; }
    location = /login { default_type text/html; alias ${current}/app.html; }
    location = /workspace { default_type text/html; alias ${current}/app.html; }
    location = /account { default_type text/html; alias ${current}/app.html; }
    location /frontend-assets/${namespace}/assets/ { try_files $uri =404; }
    ${retained ? `location /frontend-assets/${retained.namespace}/assets/ { try_files $uri =404; }` : ""}
    location /api/ {
      proxy_set_header Host $http_host;
      proxy_set_header X-Real-IP 127.0.0.1;
      include ${upstream};
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
    {
      const result = await session();
      if (result.status !== 401 && Number.isInteger(result.status) && result.status >= 100 && result.status <= 599) {
        stage += ' (HTTP ' + result.status + ')';
      }
      check(result.status === 401, stage);
    }
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
    if (retained) {
      const candidateScript = scripts[0];
      const selectBackend = async (port, sha) => {
        await writeFile(upstream + '.new', `proxy_pass http://127.0.0.1:${port};\n`, { mode: 0o600, flag: 'wx' });
        await rename(upstream + '.new', upstream);
        check(nginx.kill('SIGHUP'), stage);
        for (let i = 0; i < 60; i++) {
          const observed = await fetch(origin + '/api/meta', {
            headers: { connection: 'close' }, redirect: 'error', signal: AbortSignal.timeout(1000),
          }).then(async r => r.ok ? (await r.json()).backendRelease : null, () => null);
          if (observed === sha) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(stage);
      };
      const selectFrontend = async ns => {
        await symlink(front(ns), current + '.new', 'dir');
        await rename(current + '.new', current);
      };
      const freshWorkspace = async (ns, sha) => {
        const tab = await ctx.newPage();
        try {
          const reads = Promise.all([
            tab.waitForResponse(r => r.url() === origin + '/api/meta' && r.ok()),
            tab.waitForResponse(r => r.ok() && r.url().startsWith(origin + '/frontend-assets/' + ns + '/assets/') &&
              r.request().resourceType() === 'script' && /javascript/.test(r.headers()['content-type'] ?? '')),
            tab.goto(origin + '/workspace'),
          ]);
          const [api, , doc] = await reads;
          check(doc?.ok() && (await api.json()).backendRelease === sha, stage);
          return tab;
        } catch (error) { await tab.close(); throw error; }
      };
      stage = 'Reconstructed backend mismatch was not fenced';
      await selectBackend(retained.port, retained.commit);
      const mixed = await freshWorkspace(namespace, retained.commit);
      await mixed.getByText('当前服务版本不兼容，请稍后再试。', { exact: true }).waitFor();
      await mixed.close();
      stage = 'Reconstructed authenticated pair failed';
      await selectFrontend(retained.namespace);
      const old = await freshWorkspace(retained.namespace, retained.commit);
      await old.locator('textarea').filter({ visible: true }).first().waitFor();
      const status = await old.evaluate(async url => {
        const [session, previous] = await Promise.all([fetch('/api/auth/session'), fetch(url, { cache: 'no-store' })]);
        return { id: session.ok ? (await session.json()).id : null,
          previous: previous.ok && /javascript/.test(previous.headers.get('content-type') ?? '') };
      }, candidateScript);
      check(status.id === userId && status.previous, stage);
      await old.close();
      stage = 'Candidate restore after reconstructed check failed';
      await selectBackend(backendPort, commit);
      await selectFrontend(namespace);
    }
    stage = 'Browser account sign out failed';
    await page.goto(origin + '/account');
    const [logout] = await Promise.all([
      page.waitForResponse(r => r.url() === origin + '/api/auth/logout' && r.request().method() === 'POST'),
      page.getByRole('button', { name: '退出登录', exact: true }).click(),
    ]);
    check(logout.ok(), stage);
    await page.waitForURL(origin + '/home');
    {
      const result = await session();
      if (result.status !== 401 && Number.isInteger(result.status) && result.status >= 100 && result.status <= 599) {
        stage += ' (HTTP ' + result.status + ')';
      }
      check(result.status === 401, stage);
    }
    await cta(guestTarget).waitFor();
  } catch {
    throw new Error(stage);
  } finally {
    try { await browser?.close(); } finally { nginx.kill('SIGTERM'); }
  }
}
