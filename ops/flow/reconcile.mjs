// Run only from a protected Flow job with concurrency set to one. The
// reservation must be durable before Flow is asked to start a run.
export async function reconcileRef(target, services, { mirrorPolls = 12 } = {}) {
  const { branch, sha } = target;
  if (typeof branch !== 'string' || !branch || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
    throw new Error('Reconciliation requires a GitHub branch and full commit SHA');
  }
  const current = () => services.readPrimary(branch);
  if (await current() !== sha) return 'superseded';

  const check = await services.readCheck(target);
  if (check?.state === 'success') return 'success';
  if (check) {
    if (!check.runId) return check.state === 'pending' ? 'submission-uncertain' : check.state;
    const run = await services.readRun(check.runId);
    if (!run || ['RUNNING', 'QUEUED', 'WAITING'].includes(run.status)) return 'pending';
    if (await current() !== sha) return 'superseded';
    const state = run.sha === sha && run.status === 'SUCCESS' &&
      run.quality === 'SUCCESS' && run.database === 'SUCCESS' ? 'success' : 'failure';
    if (state !== check.state) await services.writeCheck(target, { state, runId: check.runId });
    return state;
  }

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
  if (!/^[1-9][0-9]*$/.test(runId ?? '')) throw new Error('Flow did not return a valid run ID');
  await services.writeCheck(target, { state: 'pending', runId });
  return 'submitted';
}
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repository = 'zhYAO/Image-web';
const organization = '33197a87-7b90-431a-bd2c-2c9f012e6c90';
const codeupId = '5027582';
const site = 'https://zimage-cn-shanghai.devops.aliyuncs.com';
const cloneUrl = `${site}/codeup/zhYAO/Image-web.git`;
const context = 'yunxiao/quality';


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

export function createController(env, execute = execFileSync) {
  const { ZIMAGE_GITHUB_APP_TOKEN: githubToken, ZIMAGE_GITHUB_APP_BOT_ID: botId,
    ZIMAGE_FLOW_PAT: flowToken, ZIMAGE_FLOW_QUALITY_PIPELINE_ID: pipelineId } = env;
  if (!githubToken || !flowToken || !/^[1-9][0-9]*$/.test(botId ?? '') || !/^[1-9][0-9]*$/.test(pipelineId ?? '')) {
    throw new Error('Protected controller requires a GitHub App, its bot ID, a Flow PAT and the quality pipeline ID');
  }
  const github = (path, options) => request(`https://api.github.com/repos/${repository}/${path}`,
    { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }, options);
  const yunxiao = (path, options) => request(`${site}/oapi/v1/${path}`, { 'x-yunxiao-token': flowToken }, options);
  const runs = `flow/pipelines/${pipelineId}/runs`;
  const readPrimary = async (branch) => (await github(`git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { missing: true }))?.object?.sha;

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
    async readCheck({ sha }) {
      for (let page = 1; ; page += 1) {
        const statuses = await github(`commits/${sha}/statuses?per_page=100&page=${page}`);
        const status = statuses.find(item => item.context === context && String(item.creator?.id) === botId);
        if (status) return { state: status.state, runId: /^Flow run ([1-9][0-9]*)$/.exec(status.description ?? '')?.[1] };
        if (statuses.length < 100) return null;
      }
    },
    async writeCheck({ sha }, { state, runId }) {
      const result = await github(`statuses/${sha}`, { body: {
        context, state, description: runId ? `Flow run ${runId}` : 'Flow submission reserved',
        ...(runId ? { target_url: `${site}/flow/pipelines/${pipelineId}/runs/${runId}` } : {}),
      } });
      if (String(result.creator?.id) !== botId) throw new Error('GitHub status was not written by the configured App bot');
    },
    async start({ branch, sha }) {
      const runId = await yunxiao(runs, { body: { params: JSON.stringify({
        envs: { EXPECTED_COMMIT: sha }, runningBranchs: { [cloneUrl]: branch },
      }) } });
      return String(runId);
    },
    async readRun(runId) {
      const run = await yunxiao(`${runs}/${runId}`);
      if (String(run.pipelineRunId) !== runId || String(run.pipelineId) !== pipelineId) throw new Error('Unexpected Flow run identity');
      const jobs = (run.stages ?? []).flatMap(stage => stage.stageInfo?.jobs ?? []);
      const jobStatus = (name) => {
        const matching = jobs.filter(job => job.name === name);
        return matching.length === 1 ? matching[0].status : undefined;
      };
      return { sha: run.globalParams?.find(param => param.key === 'EXPECTED_COMMIT')?.value,
        status: run.status, quality: jobStatus('quality'), database: jobStatus('database') };
    },
    wait: () => sleep(5_000),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const services = createController(process.env);
    for (const target of await services.targets()) {
      try { console.log(`${target.branch}: ${await reconcileRef(target, services)}`); }
      catch (error) { console.error(`${target.branch}: ${error.message}`); process.exitCode = 1; }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
