"""Bounded GitHub protected-main evidence query; shadow-only."""
import http.client
import json
import re
import ssl

from github_protected_merge_shadow import verify

BASE = '/repos/zhYAO/Image-web'
WF = '.github/workflows/release-pr-required.yml'
RULESET = 27873546
CAP = 1_000_000


def need(value):
    if not value:
        raise ValueError('Independent protected-main evidence rejected')


def https_reader(token):
    """Trusted observer-only credential; never pass to candidate steps."""
    need(type(token) is str and re.fullmatch(r'[A-Za-z0-9_.-]{8,1024}', token))
    tls = ssl.create_default_context()
    def get(path):
        tail = path.removeprefix(BASE)
        need(path.startswith(BASE+'/') and re.fullmatch(
            r'/(?:branches/main|rules/branches/main|rulesets/27873546|pulls/[1-9]\d{0,18}|'
            r'commits/[a-f0-9]{40}(?:/pulls\?per_page=100)?|check-runs/[1-9]\d{0,18}|'
            r'actions/runs/[1-9]\d{0,18}(?:/attempts/[1-9]\d{0,18}/jobs\?per_page=100)?)', tail))
        conn = http.client.HTTPSConnection('api.github.com',timeout=5,context=tls)
        try:
            conn.request('GET',path,headers={'Authorization':'Bearer '+token,
                'User-Agent':'zimage-merge-shadow/1','Accept':'application/vnd.github+json',
                'X-GitHub-Api-Version':'2022-11-28','Accept-Encoding':'identity'})
            res=conn.getresponse()
            need(res.status==200 and res.getheader('Content-Encoding','identity')=='identity')
            body=res.read(CAP+1)
            need(0<len(body)<=CAP)
            def unique(pairs):
                result=dict(pairs)
                need(len(result)==len(pairs))
                return result
            return json.loads(body,object_pairs_hook=unique)
        except Exception:
            raise ValueError('Independent GitHub read failed') from None
        finally:
            conn.close()
    return get


def observe(get, *, policy, candidate_sha, pr_number, check_id, pr_run_id):
    """IDs are selectors only; bind every result to the independently reviewed policy."""
    need(re.fullmatch('[a-f0-9]{40}',candidate_sha)
         and all(type(i) is int and 0<i<10**19 for i in (pr_number,check_id,pr_run_id)))
    def read(tail):
        return get(BASE+tail)
    def main():
        b=read('/branches/main')
        need(b['name']=='main' and b['protected'] is True and b['commit']['sha']==candidate_sha)
    main()
    rs=read(f'/rulesets/{RULESET}')
    need(rs['id']==RULESET and rs['target']=='branch' and rs['enforcement']=='active'
         and rs['bypass_actors']==[] and rs['conditions']['ref_name']==dict(include=['refs/heads/main'],exclude=[]))
    wanted={'pull_request','deletion','non_fast_forward','required_status_checks'}
    configured={r['type']:r for r in rs['rules'] if r['type'] in wanted}
    need(len([r for r in rs['rules'] if r['type'] in wanted])==len(configured)==len(wanted))
    effective=read('/rules/branches/main')
    need(type(effective) is list and len(effective)<100)
    for typ,rule in configured.items():
        hits=[r for r in effective if r['type']==typ and r.get('ruleset_id')==RULESET]
        need(len(hits)==1 and hits[0].get('parameters')==rule.get('parameters'))
    cfg=configured['required_status_checks']['parameters']
    need(cfg['strict_required_status_checks_policy'] is True
         and {'context':policy['required_check'],'integration_id':policy['check_app_id']} in cfg['required_status_checks'])
    linked=read(f'/commits/{candidate_sha}/pulls?per_page=100')
    need(type(linked) is list and len(linked)==1 and linked[0]['number']==pr_number)
    pr=read(f'/pulls/{pr_number}')
    need(pr['number']==pr_number and pr['merged'] is True and pr['merge_commit_sha']==candidate_sha)
    run=read(f'/actions/runs/{pr_run_id}')
    need(run['id']==pr_run_id and run['path']==WF and run['workflow_id']==policy['check_workflow_id']
         and run['event']=='pull_request' and run['repository']['id']==policy['repository_id']
         and run['status']=='completed' and run['conclusion']=='success'
         and any(p['number']==pr_number and p['base']['ref']=='main' for p in run['pull_requests']))
    attempt=run['run_attempt']
    need(type(attempt) is int and 0<attempt<10**19)
    jobs=read(f'/actions/runs/{pr_run_id}/attempts/{attempt}/jobs?per_page=100')
    need(type(jobs['jobs']) is list and jobs['total_count']==len(jobs['jobs'])<=100)
    matching=[j for j in jobs['jobs'] if j['name']==policy['required_check']]
    need(len(matching)==1)
    job=matching[0]
    need(job['run_id']==pr_run_id and job['run_attempt']==attempt and job['status']=='completed'
         and job['conclusion']=='success' and job['check_run_url']==f'https://api.github.com{BASE}/check-runs/{check_id}')
    check=read(f'/check-runs/{check_id}')
    tested=check['head_sha']
    need(check['id']==check_id and re.fullmatch('[a-f0-9]{40}',tested)
         and check['check_suite']['id']==run['check_suite_id'] and job['head_sha']==tested)
    def tree(sha):
        obj=read('/commits/'+sha)
        value=obj['commit']['tree']['sha']
        need(obj['sha']==sha and re.fullmatch('[a-f0-9]{40}',value))
        return value
    need(tree(tested)==tree(candidate_sha))
    main()
    return verify(policy,dict(repository=policy['repository'],repository_id=policy['repository_id'],
        candidate_sha=candidate_sha,main_sha=candidate_sha,source_ref='refs/heads/main',event='push',
        effective_rule=dict(branch='main',enforcing=True,require_pull_request=True,restrict_direct_push=True,
            require_up_to_date=True,bypass_actors=[],enforce_admins=True,allow_force_push=False,
            allow_deletion=False,required_check=policy['required_check'],check_app_id=policy['check_app_id']),
        pull_request=dict(number=pr_number,merged=True,merge_commit_sha=candidate_sha,base_ref=pr['base']['ref'],
            base_repository_id=pr['base']['repo']['id'],merger_type=pr['merged_by']['type'],
            merger_id=pr['merged_by']['id'],required_check_sha=tested),
        check=dict(name=check['name'],app_id=check['app']['id'],status=check['status'],
            conclusion=check['conclusion'],tested_sha=tested)))
