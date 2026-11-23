"""Offline normalized protected-merge evidence gate; not a production authority."""
import re


def verify(policy, observation):
    """Caller must independently authenticate GitHub observations and effective rules.

    Do not replace a host/controller approval with the return of this helper.
    It does not authenticate the observation, or prove historical enforcement.
    """
    def need(ok):
        if not ok:
            raise ValueError('Protected merge evidence rejected')
    need(policy['repository_id'] == 1329578390 and policy['repository'] == 'zhYAO/Image-web')
    need(observation['repository_id'] == policy['repository_id']
         and observation['repository'] == policy['repository'])
    sha = observation['candidate_sha']
    need(type(sha) is str and re.fullmatch('[a-f0-9]{40}', sha)
         and observation['main_sha'] == sha and observation['source_ref'] == 'refs/heads/main'
         and observation['event'] == 'push')
    rule = observation['effective_rule']
    need(rule == dict(branch='main', enforcing=True, require_pull_request=True,
                      restrict_direct_push=True, require_up_to_date=True, bypass_actors=[],
                      enforce_admins=True, allow_force_push=False, allow_deletion=False,
                      required_check=policy['required_check'], check_app_id=policy['check_app_id']))
    pr = observation['pull_request']
    need(pr['merged'] is True and pr['merge_commit_sha'] == sha
         and pr['base_ref'] == 'main' and pr['base_repository_id'] == policy['repository_id']
         and type(pr['number']) is int and pr['number'] > 0
         and pr['merger_type'] == 'User' and pr['merger_id'] in policy['allowed_human_merger_ids'])
    check = observation['check']
    need(check['name'] == policy['required_check'] and check['app_id'] == policy['check_app_id']
         and check['status'] == 'completed' and check['conclusion'] == 'success'
         and check['tested_sha'] == pr['required_check_sha'])
    need(re.fullmatch('[a-f0-9]{40}', check['tested_sha']))
    return {'protectedMergeVerified': True, 'productionReady': False}
