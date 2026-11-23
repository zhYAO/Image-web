"""Root-only GitHub reads for the exact maintainer merge and its required check."""
import base64
from datetime import datetime
import hashlib
import http.client
import json
import re
import ssl

BASE = '/repos/zhYAO/Image-web'
REPO_ID = 1329578390
CHECK_NAME = 'zimage-release-pr-required'
CHECK_APP_ID = 15368
RULESET_ID = 27873546
MAIN_REF = 'refs/heads/main'
CHECK_WORKFLOW = '.github/workflows/release-pr-required.yml'
WORKFLOW = '.github/workflows/rehearsal-candidates.yml'
SUITES = '/rulesets/rule-suites?ref=refs%2Fheads%2Fmain&per_page=100'
CHECK_QUERY = f'/check-runs?check_name={CHECK_NAME}&filter=latest&per_page=100'
N = r'[1-9][0-9]{0,18}'
SHA = r'[a-f0-9]{40}'
CAP = 1_000_000


def require(condition):
    if not condition:
        raise ValueError('Protected merge lacks independently verifiable evidence')


def numeric(value):
    require(type(value) is int and 0 < value < 10**19)
    return value


def safe_path(path):
    if type(path) is not str or not path.startswith(BASE + '/'):
        return False
    tail = path[len(BASE):]
    return tail == SUITES or re.fullmatch(
        rf'/(?:branches/main|rules/branches/main|rulesets/{RULESET_ID}|rulesets/rule-suites/{N}|'
        rf'pulls/{N}|commits/{SHA}(?:/pulls\?per_page=100|{re.escape(CHECK_QUERY)})?|check-runs/{N}|'
        rf'actions/runs/{N}(?:/attempts/{N}(?:/jobs\?per_page=100)?)?|'
        rf'actions/workflows/{N}/runs\?event=pull_request&check_suite_id={N}&per_page=100|'
        rf'contents/{re.escape(CHECK_WORKFLOW)}\?ref={SHA})', tail) is not None


def read_only(token, connect=http.client.HTTPSConnection):
    require(type(token) is str and re.fullmatch(r'[A-Za-z0-9_.-]{8,1024}', token))
    tls = ssl.create_default_context()

    def get(path):
        require(safe_path(path))
        connection = connect('api.github.com', timeout=5, context=tls)
        try:
            connection.request('GET', path, headers={'Authorization': 'Bearer ' + token,
                               'User-Agent': 'zimage-ordinary-observer/1', 'Accept': 'application/vnd.github+json',
                               'X-GitHub-Api-Version': '2022-11-28', 'Accept-Encoding': 'identity'})
            response = connection.getresponse()
            require(response.status == 200 and response.getheader('Content-Encoding', 'identity') == 'identity'
                    and 'rel="next"' not in response.getheader('Link', ''))
            body = response.read(CAP + 1)
            require(0 < len(body) <= CAP)
            def unique(pairs):
                value = dict(pairs)
                require(len(value) == len(pairs))
                return value
            return json.loads(body, object_pairs_hook=unique)
        except (OSError, ValueError, http.client.HTTPException):
            raise ValueError('Independent GitHub evidence read refused') from None
        finally:
            connection.close()
    return get


def timestamp(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(stamp.tzinfo is not None)
    return stamp


def single(collection, key):
    values = collection[key]
    require(type(values) is list and collection['total_count'] == len(values) == 1)
    return values[0]


def check_workflow_digest(get, commit):
    require(type(commit) is str and re.fullmatch(SHA, commit))
    file = get(f'{BASE}/contents/{CHECK_WORKFLOW}?ref={commit}')
    require(file['type'] == 'file' and file['path'] == CHECK_WORKFLOW and file['encoding'] == 'base64'
            and type(file['size']) is int and 0 < file['size'] <= 65536)
    workflow = base64.b64decode(''.join(file['content'].splitlines()), validate=True)
    require(len(workflow) == file['size'])
    return hashlib.sha256(workflow).hexdigest()


def observe(packet, *, get, policy, verify_check):
    """Discover GitHub identities from the admitted commit. The SSH caller selects none."""
    require(packet['repository'] == policy['repository'] == 'zhYAO/Image-web' and packet['workflow'] == WORKFLOW
            and policy['repository_id'] == REPO_ID and policy['required_check'] == CHECK_NAME
            and policy['check_app_id'] == CHECK_APP_ID)
    commit = packet['commit']
    require(type(commit) is str and re.fullmatch(SHA, commit))
    workflow_id = numeric(policy['check_workflow_id'])
    expected_workflow = policy['required_workflow_sha256']
    require(type(expected_workflow) is str and re.fullmatch('[a-f0-9]{64}', expected_workflow))

    def read(tail):
        return get(BASE + tail)

    linked = read(f'/commits/{commit}/pulls?per_page=100')
    require(type(linked) is list and len(linked) == 1)
    pr_number = numeric(linked[0]['number'])
    pr = read(f'/pulls/{pr_number}')
    merger = numeric(pr['merged_by']['id']) if pr['merged'] is True else None
    require(pr['number'] == pr_number and pr['merged'] is True and pr['merge_commit_sha'] == commit
            and pr['base']['ref'] == 'main' and pr['base']['repo']['id'] == REPO_ID
            and pr['merged_by']['type'] == 'User' and merger in policy['allowed_human_merger_ids'])
    head = pr['head']['sha']
    require(type(head) is str and re.fullmatch(SHA, head))

    check = single(read(f'/commits/{head}{CHECK_QUERY}'), 'check_runs')
    require(check['head_sha'] == head and check['name'] == CHECK_NAME and check['app']['id'] == CHECK_APP_ID
            and check['status'] == 'completed' and check['conclusion'] == 'success'
            and timestamp(check['completed_at']) <= timestamp(pr['merged_at']))
    check_id, suite_id = numeric(check['id']), numeric(check['check_suite']['id'])
    run = single(read(f'/actions/workflows/{workflow_id}/runs?event=pull_request&check_suite_id={suite_id}&per_page=100'),
                 'workflow_runs')
    require(run['head_sha'] == head and run['check_suite_id'] == suite_id)
    run_id = numeric(run['id'])

    require(check_workflow_digest(get, commit) == expected_workflow)

    rules = read(f'/rulesets/{RULESET_ID}')
    require(rules['id'] == RULESET_ID and rules['enforcement'] == 'active' and rules['bypass_actors'] == [])
    suites = read(SUITES)
    require(type(suites) is list and len(suites) <= 100)
    matching = [row for row in suites if row['after_sha'] == commit and row['ref'] == MAIN_REF]
    require(len(matching) == 1)
    rule_id = numeric(matching[0]['id'])
    execution = read(f'/rulesets/rule-suites/{rule_id}')
    require(execution['id'] == rule_id and execution['repository_id'] == REPO_ID and execution['actor_id'] == merger
            and execution['ref'] == MAIN_REF and execution['after_sha'] == commit and execution['result'] == 'pass'
            and execution['evaluation_result'] == 'pass' and execution['before_sha'] != commit
            and re.fullmatch(SHA, execution['before_sha'])
            and timestamp(rules['updated_at']) <= timestamp(execution['pushed_at'])
            and timestamp(pr['merged_at']) <= timestamp(execution['pushed_at']))
    evaluations = execution['rule_evaluations']
    require(type(evaluations) is list and len(evaluations) <= 100)
    for rule_type in ('pull_request', 'required_status_checks'):
        expected = [item for item in evaluations if item['rule_type'] == rule_type
                    and item['rule_source']['type'] == 'ruleset' and item['rule_source']['id'] == RULESET_ID]
        require(len(expected) == 1 and expected[0]['enforcement'] == 'active' and expected[0]['result'] == 'pass')

    # The existing reviewed observer ties the selected check to the GitHub
    # Actions job, PR, tested tree, effective rules and current main.
    report = verify_check(get, policy=policy, candidate_sha=commit, pr_number=pr_number,
                          check_id=check_id, pr_run_id=run_id)
    require(report == {'protectedMergeVerified': True, 'productionReady': False}
            and read(f'/rulesets/{RULESET_ID}') == rules)
    return {'commit': commit, 'pullRequest': pr_number, 'checkRunId': check_id,
            'workflowRunId': run_id, 'ruleSuiteId': rule_id, 'workflowSha256': expected_workflow}
