"""Host-measurement comparison only; not an approval or controller."""
import hashlib
import json
import re

BOOTSTRAP='7a811b326aa4b344cee08bc5a33c04e44a780fd4'
PAIR={'backend','frontend','backendManifestSha256','frontendArtifactSha256',
      'frontendConfigFingerprint','databaseSha256'}
RECEIPT={'schemaVersion','kind','status','operationId','commit','runId','attempt',
         'backendRelease','frontendRelease','backendManifestSha256','frontendSubjectSha256',
         'stageSha256','rootApprovalSha256','rollbackPair','rollbackAcceptanceSha256'}


def need(ok):
    if not ok:
        raise ValueError('Invalid rolling incumbent evidence')


def hex_value(value,n):
    return type(value) is str and re.fullmatch('[a-f0-9]{%d}' % n,value)


def pair(live):
    need(type(live) is dict and set(live)==PAIR and hex_value(live['backend'],40)
         and live['frontend']=='release-'+live['backend'][:12])
    need(all(hex_value(live[k],64) for k in PAIR-{'backend','frontend'}))


def compare(live,candidate,*,ancestry,journal,evidence,receipt,bootstrap=None):
    """Host must measure all inputs independently and hold the existing shared lock."""
    pair(live)
    previous=live['backend']
    need(hex_value(candidate,40) and candidate!=previous)
    need(ancestry==dict(ancestor=previous,descendant=candidate,verified=True)
         and ancestry['verified'] is True)
    if receipt is None:
        need(journal is None and evidence is None and bootstrap is not None)
        pair(bootstrap)
        need(previous==BOOTSTRAP and live==bootstrap)
    else:
        need(bootstrap is None and type(receipt) is bytes and 0<len(receipt)<=16384)
        def unique(pairs):
            value=dict(pairs);need(len(value)==len(pairs));return value
        v=json.loads(receipt,object_pairs_hook=unique)
        need(type(v) is dict and set(v)==RECEIPT and type(v['schemaVersion']) is int
             and v['schemaVersion']==1 and v['kind']=='zimage-ordinary-pair-v1' and v['status']=='opened')
        need(v['commit']==v['backendRelease']==previous and v['frontendRelease']==live['frontend']
             and v['backendManifestSha256']==live['backendManifestSha256'])
        need(all(type(v[k]) is int and v[k]>0 for k in ('runId','attempt'))
             and all(hex_value(v[k],64) for k in ('frontendSubjectSha256','stageSha256',
                                                 'rootApprovalSha256','rollbackAcceptanceSha256')))
        old=v['rollbackPair']
        need(type(old) is dict and set(old)=={'backend','frontend'} and hex_value(old['backend'],40)
             and old['backend']!=previous and old['frontend']=='release-'+old['backend'][:12])
        op=v['operationId']
        need(type(op) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{6,79}',op))
        need(journal==dict(operationId=op,rootApprovalSha256=v['rootApprovalSha256'],phase='opened'))
        need(evidence==dict(operationId=op,pair=live,receiptSha256=hashlib.sha256(receipt).hexdigest()))
    return {'incumbentVerified':True,'productionReady':False,'rollbackPair':dict(live)}
