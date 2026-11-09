const fullSha = /^[a-f0-9]{40}$/;
const flowId = /^[1-9][0-9]*$/;
const pendingRuns = new Set(['INIT', 'PENDING', 'RUNNING', 'QUEUED', 'WAITING', 'CANCELLING']);

function qualityPassed(run, sha) {
  return run?.status === 'SUCCESS' && run.sha === sha && run.quality === 'SUCCESS' && run.database === 'SUCCESS';
}

// Run only from a protected Flow job with concurrency set to one. The
// reservation must be durable before Flow is asked to start a run.
export async function reconcileRef(target, services, { mirrorPolls = 12, succeeded = qualityPassed, beforeStart } = {}) {
  const { branch, sha } = target;
  if (typeof branch !== 'string' || !branch || !fullSha.test(sha ?? '')) {
    throw new Error('Reconciliation requires a GitHub branch and full commit SHA');
  }
  const current = () => services.readPrimary(branch);
  if (await current() !== sha) return 'superseded';

  const check = await services.readCheck(target);
  if (check?.state === 'success') return 'success';
  if (check) {
    if (!check.runId) return check.state === 'pending' ? 'submission-uncertain' : check.state;
    const run = await services.readRun(check.runId);
    if (!run || pendingRuns.has(run.status)) return 'pending';
    if (await current() !== sha) return 'superseded';
    const state = succeeded(run, sha) ? 'success' : 'failure';
    if (state !== check.state) await services.writeCheck(target, { state, runId: check.runId });
    return state;
  }

  const blocked = await beforeStart?.();
  if (blocked) return blocked;

  if (await services.readMirror(branch) !== sha) {
    await services.syncMirror();
    let matched = false;
    for (let attempt = 0; attempt < mirrorPolls; attempt += 1) {
      if (await current() !== sha) return 'superseded';
      if (await services.readMirror(branch) === sha) { matched = true; break; }
      await services.wait();
    }
    if (!matched) throw new Error('Codeup did not reach the expected GitHub commit');
  }

  if (await current() !== sha) return 'superseded';
  await services.writeCheck(target, { state: 'pending' });
  const runId = await services.start(target);
  if (!flowId.test(runId ?? '')) throw new Error('Flow did not return a valid run ID');
  await services.writeCheck(target, { state: 'pending', runId });
  return 'submitted';
}

export async function reconcileFrontend(target, services) {
  if (target.branch !== 'main' || !services.frontend) return 'disabled';
  return reconcileRef(target, { ...services, ...services.frontend }, {
    succeeded: (run, sha) => run.sha === sha && run.status === 'SUCCESS' && run.candidate === 'SUCCESS',
    beforeStart: async () => {
      const quality = await services.readCheck(target);
      if (quality?.state !== 'success' || !flowId.test(quality.runId ?? '') ||
          !qualityPassed(await services.readRun(quality.runId), target.sha)) return 'quality-unverified';
    },
  });
}
import { execFileSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repository = 'zhYAO/Image-web';
const organization = '33197a87-7b90-431a-bd2c-2c9f012e6c90';
const codeupId = '5027582';
const site = 'https://zimage-cn-shanghai.devops.aliyuncs.com';
const cloneUrl = `${site}/codeup/zhYAO/Image-web.git`;
const context = 'yunxiao/quality';
const frontendContext = 'yunxiao/frontend-candidate';

async function request(url, headers, { body, missing = false } = {}) {
  const response = await fetch(url, {
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).hostname} request failed with HTTP ${response.status}`);
  return response.json();
}

async function installationToken({ clientId, installationId, privateKey }, send) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = encode({ iss: clientId, iat: now - 60, exp: now + 540 });
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + claims;
  const jwt = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  const result = await send(`https://api.github.com/app/installations/${installationId}/access_tokens`,
    { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' }, { body: {
      repositories: ['Image-web'],
      permissions: { contents: 'read', pull_requests: 'read', statuses: 'write' },
    } });
  if (typeof result?.token !== 'string' || !result.token) throw new Error('GitHub App did not return an installation token');
  return result.token;
}

export function createController(env, execute = execFileSync, send = request) {
  const { ZIMAGE_GITHUB_APP_TOKEN: githubToken, ZIMAGE_GITHUB_APP_BOT_ID: botId,
    ZIMAGE_GITHUB_APP_CLIENT_ID: clientId, ZIMAGE_GITHUB_APP_INSTALLATION_ID: installationId,
    ZIMAGE_GITHUB_APP_PRIVATE_KEY: privateKey,
    ZIMAGE_FLOW_PAT: flowToken, ZIMAGE_FLOW_QUALITY_PIPELINE_ID: pipelineId,
    ZIMAGE_FLOW_FRONTEND_CANDIDATE_PIPELINE_ID: frontendId, ZIMAGE_FRONTEND_BACKEND_RELEASES: backends } = env;
  const appConfigured = clientId && privateKey && flowId.test(installationId ?? '');
  if ((!githubToken && !appConfigured) || !flowToken || !flowId.test(botId ?? '') || !flowId.test(pipelineId ?? '')) {
    throw new Error('Protected controller requires a GitHub App, its bot ID, a Flow PAT and the quality pipeline ID');
  }
  if (frontendId && (!flowId.test(frontendId) || frontendId === pipelineId ||
      !/^[a-f0-9]{40}(,[a-f0-9]{40})*$/.test(backends ?? ''))) {
    throw new Error('Frontend reconciliation needs a separate candidate pipeline and exact backend SHAs');
  }
  let token;
  const github = async (path, options) => {
    token ??= githubToken || installationToken({ clientId, installationId, privateKey }, send);
    return send(`https://api.github.com/repos/${repository}/${path}`,
      { Authorization: `Bearer ${await token}`, Accept: 'application/vnd.github+json' }, options);
  };
  const yunxiao = (path, options) => send(`${site}/oapi/v1/${path}`, { 'x-yunxiao-token': flowToken }, options);
  const readPrimary = async (branch) => (await github(`git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { missing: true }))?.object?.sha;

  function pipelineChecks(id, statusContext, names, inputs) {
    const runs = `flow/pipelines/${id}/runs`;
    return {
      async readCheck({ sha }) {
        for (let page = 1; ; page += 1) {
          const statuses = await github(`commits/${sha}/statuses?per_page=100&page=${page}`);
          const status = statuses.find(item => item.context === statusContext && String(item.creator?.id) === botId);
          if (status) return { state: status.state, runId: /^Flow run ([1-9][0-9]*)$/.exec(status.description ?? '')?.[1] };
          if (statuses.length < 100) return null;
        }
      },
      async writeCheck({ sha }, { state, runId }) {
        const result = await github(`statuses/${sha}`, { body: {
          context: statusContext, state, description: runId ? `Flow run ${runId}` : 'Flow submission reserved',
          ...(runId ? { target_url: `${site}/flow/pipelines/${id}/runs/${runId}` } : {}),
        } });
        if (String(result.creator?.id) !== botId) throw new Error('GitHub status was not written by the configured App bot');
      },
      async start({ branch, sha }) {
        const runId = await yunxiao(runs, { body: { params: JSON.stringify({
          envs: { EXPECTED_COMMIT: sha, ...inputs }, runningBranchs: { [cloneUrl]: branch },
        }) } });
        return String(runId);
      },
      async readRun(runId) {
        const run = await yunxiao(`${runs}/${runId}`);
        if (String(run.pipelineRunId) !== runId || String(run.pipelineId) !== id) throw new Error('Unexpected Flow run identity');
        const jobs = (run.stages ?? []).flatMap(stage => stage.stageInfo?.jobs ?? []);
        const result = { sha: run.globalParams?.find(param => param.key === 'EXPECTED_COMMIT')?.value, status: run.status };
        for (const [key, name] of Object.entries(names)) {
          const matching = jobs.filter(job => job.name === name);
          result[key] = matching.length === 1 ? matching[0].status : undefined;
        }
        return result;
      },
    };
  }

  return {
    readPrimary,
    async targets() {
      const refs = new Map([['main', await readPrimary('main')]]);
      for (let page = 1; ; page += 1) {
        const prs = await github(`pulls?state=open&base=main&per_page=100&page=${page}`);
        for (const { head } of prs) if (head.repo?.full_name === repository) refs.set(head.ref, head.sha);
        if (prs.length < 100) break;
      }
      return Array.from(refs, ([branch, sha]) => ({ branch, sha }));
    },
    async readMirror(branch) {
      return (await yunxiao(`codeup/repositories/${codeupId}/branches/${encodeURIComponent(branch)}`, { missing: true }))?.commit?.id;
    },
    syncMirror() {
      let result;
      try {
        result = JSON.parse(execute('aliyun', ['devops', 'POST', `/repository/${codeupId}/mirror`,
          '--version', '2021-06-25', '--region', 'cn-shanghai', '--organizationId', organization],
        { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }));
      } catch {
        throw new Error('Codeup mirror sync could not be submitted by the official Aliyun CLI');
      }
      if (result.success !== true || result.result?.result !== true) throw new Error('Codeup mirror sync request was rejected');
    },
    ...pipelineChecks(pipelineId, context, { quality: 'quality', database: 'database' }),
    frontend: frontendId ? pipelineChecks(frontendId, frontendContext, { candidate: 'Build frontend candidate' }, {
      ZIMAGE_FRONTEND_BACKEND_RELEASES: backends, ZIMAGE_GITHUB_APP_BOT_ID: botId,
    }) : null,
    wait: () => sleep(5_000),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const services = createController(process.env);
    for (const target of await services.targets()) {
      try {
        const quality = await reconcileRef(target, services);
        console.log(`${target.branch}: ${quality}`);
        if (target.branch === 'main' && services.frontend) {
          console.log(`main frontend candidate: ${await reconcileFrontend(target, services)}`);
        }
      }
      catch (error) { console.error(`${target.branch}: ${error.message}`); process.exitCode = 1; }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
