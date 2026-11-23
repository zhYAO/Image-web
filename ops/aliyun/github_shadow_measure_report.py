"""Trusted supervisor report handoff. No approval, signing or artifact upload."""
import json
import re

from github_hosted_stage_shadow import _require, _unique
from github_shadow_stage_build import ARTIFACTS, CHECKS, IDS, REPORT_KIND

BASELINE = '7a811b326aa4b344cee08bc5a33c04e44a780fd4'
LEDGER = 'c6951d2b41ae6f52d7f1b7fd1e5d7c11a4be9c77b9729d86230a353de2724857'
NETWORK = 'Pinned TLS and restricted route verified; sampled direct routes unavailable'
SCOPE = 'unattested-protected-browser-observation'


def report(result, *, argv, context):
    """Caller starts ONLY the independently pinned supervisor with its vetted argv.

    result is that actual subprocess completion, not input received from CI
    artifacts. context contains separately verified/downloaded outer digests.
    Runtime already suppresses candidate container output; no parsing browser logs.
    """
    _require(type(result.returncode) is int and result.returncode == 0 and result.args == argv)
    _require(type(argv) in (list, tuple) and len(argv) >= 5 and argv[-4] == '--prepared-protected-shadow'
             and argv[-1] == 'c65ee2fd2aa81bf474db37497366c58733a627fb')
    _require(type(context) is dict and set(context) == IDS | ARTIFACTS)
    _require(context['repository'] == 'zhYAO/Image-web' and context['repositoryId'] == 1329578390
             and context['sourceRef'] == 'refs/heads/main' and context['event'] == 'push'
             and context['workflow'] == '.github/workflows/rehearsal-candidates.yml'
             and context['baselineSHA'] == BASELINE and context['migrationLedgerSha256'] == LEDGER)
    _require(all(type(context[k]) is int and context[k] > 0 for k in ('runId', 'attempt'))
             and all(type(context[k]) is str and re.fullmatch(r'[a-f0-9]{64}', context[k]) for k in ARTIFACTS)
             and type(context['sourceSHA']) is str and re.fullmatch(r'[a-f0-9]{40}', context['sourceSHA']))
    _require(argv[-2] == context['sourceSHA'])
    _require(type(result.stdout) is bytes and 0 < len(result.stdout) <= 1_000_000)
    lines = result.stdout.decode().splitlines()
    _require(lines.count(NETWORK) == 1 and bool(lines) and len(lines[-1]) <= 4096)
    data = json.loads(lines[-1], object_pairs_hook=_unique)
    expected = dict(commit=context['sourceSHA'], dbProfile='m6-diagnostics-no-m7',
                    migrationCount=43, migrationLedgerSha256=LEDGER, scope=SCOPE,
                    browserUiTested=True, productionReady=False, credentialMode='synthetic',
                    reconstructedIsolatedPairRecovery=True, reconstructedCommit=BASELINE,
                    checks=['candidate-health', 'browser-home-login-workspace-logout'])
    _require(type(data) is dict and set(data) == set(expected)
             and all(type(data[k]) is type(v) and data[k] == v for k, v in expected.items()))
    value = dict(context, schemaVersion=1, kind=REPORT_KIND, productionReady=False,
                 checks=dict.fromkeys(CHECKS, True))
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
