"""Durable paired release kernel; no network, credentials, shell, or DDL.

Only the fixed privileged adapter supplies operations. A database proof is a
trusted operator's independently checked metadata attestation, not a DB signature.
Every external mutation follows a durable intent. Interrupted intents are never
automatically replayed. In particular dispatch intent is NOT proof of rollback.
"""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
import time


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n').encode()


def digest(value):return hashlib.sha256(canonical(value)).hexdigest()


def parse(body):
    if type(body) is not bytes or not 0 < len(body) <= 262144:raise ValueError('Bounded JSON required')
    def pairs(items):
        out={}
        for key,value in items:
            if key in out:raise ValueError('Duplicate JSON key')
            out[key]=value
        return out
    return json.loads(body,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def exact(value, fields):
    if type(value) is not dict or set(value)!=set(fields):raise ValueError('Exact schema fields required')


def hexid(value,length=64):
    if type(value) is not str or re.fullmatch('[a-f0-9]{'+str(length)+'}',value) is None:raise ValueError('Exact hex identity required')


def number(value):
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=9007199254740991:raise ValueError('Finite timestamp required')
    return value


POLICY_FIELDS={'schemaVersion','operationId','projectRef','expiresAt','oldBackend','newBackend','oldFrontend','newFrontend',
               'oldFrontendArtifact','backendManifestSha256','frontendCandidateSha256','frontendPayloadSha256',
               'migrationSha256','migrationPayloadSha256','databaseBeforeSha256','databaseAfterSha256',
               'workerSha256','configurationSha256','ingressSha256','browserVerifierSha256'}


def validate_policy(value,now):
    exact(value,POLICY_FIELDS)
    if type(value['schemaVersion']) is not int or value['schemaVersion']!=1:raise ValueError('Policy version rejected')
    if type(value['operationId']) is not str or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{6,79}',value['operationId']):raise ValueError('Operation rejected')
    if value['projectRef']!='klmiycyesxnpinxpeqep':raise ValueError('Unexpected production project')
    if not number(now)<number(value['expiresAt'])<=now+86400:raise ValueError('Policy expired or unbounded')
    for key in ('oldBackend','newBackend'):hexid(value[key],40)
    for key in ('oldFrontend','newFrontend'):
        if value[key]!='release-'+value['oldBackend' if key=='oldFrontend' else 'newBackend'][:12]:raise ValueError('Namespace does not bind backend source')
    for key in POLICY_FIELDS-{'schemaVersion','operationId','projectRef','expiresAt','oldBackend','newBackend','oldFrontend','newFrontend'}:hexid(value[key])
    if value['oldBackend']==value['newBackend'] or value['databaseBeforeSha256']==value['databaseAfterSha256']:raise ValueError('Distinct paired application/schema transition required')
    return copy.deepcopy(value)


def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def signature(info):
    # Reading a file may update atime. It is not evidence of replacement.
    return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_mode,info.st_uid,info.st_gid,info.st_nlink)


class Journal:
    """Root-private hash-chained event log. Torn event/state commits fail closed.

    Directory creation/ancestor authentication and the common deploy.lock are
    the CLI's responsibility. Tests inject a private unprivileged directory.
    """
    def __init__(self,root,owner_uid=0):
        self.root=Path(root);self.uid=owner_uid
        self.check(self.root,True)
        eventdir=self.root/'events'
        if os.path.lexists(eventdir):self.check(eventdir,True)

    def check(self,path,directory=False):
        info=path.lstat()
        if info.st_uid!=self.uid or stat.S_IMODE(info.st_mode)!=(0o700 if directory else 0o600) or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink==1):raise ValueError('Untrusted paired journal entry')
        return info

    def read(self,path):
        self.check(path)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            before=os.fstat(fd)
            body=os.read(fd,262145)
            if len(body)!=before.st_size or signature(before)!=signature(os.fstat(fd)) or signature(before)!=signature(path.lstat()):raise ValueError('Journal changed during read')
            return parse(body)
        finally:os.close(fd)

    def events(self):
        if not os.path.lexists(self.root/'events'):
            if os.path.lexists(self.root/'state.json'):raise ValueError('State without event log; reconcile')
            return []
        self.check(self.root/'events',True)
        names=sorted((self.root/'events').iterdir())
        if len(names)>512:raise ValueError('Journal event bound exceeded')
        previous=None;out=[]
        for i,path in enumerate(names,1):
            if path.name!=f'{i:04d}.json':raise ValueError('Journal event gap or foreign file')
            value=self.read(path);exact(value,{'sequence','previousSha256','record'})
            if type(value['sequence']) is not int or value['sequence']!=i or value['previousSha256']!=previous:raise ValueError('Journal hash chain rejected')
            previous=digest(value);out.append(value)
        return out

    def load(self):
        events=self.events();path=self.root/'state.json'
        if not os.path.lexists(path):
            if events:raise ValueError('Interrupted journal commit; reconcile, never replay')
            return None
        value=self.read(path)
        if not events or value!=events[-1]:raise ValueError('Journal state/event mismatch; reconcile, never replay')
        return copy.deepcopy(value['record'])

    def save(self,record):
        events=self.events();current=self.load()
        if current and record['operationId']!=current['operationId']:raise ValueError('Journal operation changed')
        value={'sequence':len(events)+1,'previousSha256':digest(events[-1]) if events else None,'record':copy.deepcopy(record)}
        if not os.path.lexists(self.root/'events'):(self.root/'events').mkdir(mode=0o700);sync(self.root)
        path=self.root/'events'/f'{value["sequence"]:04d}.json'
        self.create(path,canonical(value));sync(path.parent)
        temporary=self.root/('.state-'+secrets.token_hex(16))
        try:
            self.create(temporary,canonical(value));os.replace(temporary,self.root/'state.json');sync(self.root)
        finally:temporary.unlink(missing_ok=True)

    def create(self,path,body):
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchmod(fd,0o600)
            with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(body);stream.flush();os.fsync(fd)
        finally:os.close(fd)


PROOF_FIELDS={'schemaVersion','kind','operationId','policySha256','projectRef','checkedAt','stage','contractSha256',
              'workerSha256','configurationSha256','financialRowsSha256','activeJobs','activeLeases','quotaWithinFree',
              'migrationNonce','migrationSha256','migrationPayloadSha256'}
APPROVAL_FIELDS={'schemaVersion','operationId','policySha256','backendRelease','namespace','artifactId','candidateSha256',
                 'payloadSha256','manifestSha256','archiveSha256','acceptanceSha256'}
FINAL_FIELDS={'schemaVersion','operationId','policySha256','checkedAt','pairStateSha256','acceptanceSha256','chatAvailability','newPaidCallsEnabled'}


class Coordinator:
    def __init__(self,policy,ops,journal,*,clock=time.time,receipt_validator):
        self.clock=clock;self.p=validate_policy(policy,clock());self.ops=ops;self.j=journal;self.receipt_validator=receipt_validator
        self.policy_sha=digest(self.p)

    def state(self,*phases):
        validate_policy(self.p,self.clock())
        r=self.j.load()
        if not r or r['operationId']!=self.p['operationId'] or r['policySha256']!=self.policy_sha:raise ValueError('No exact paired operation')
        if phases and r['phase'] not in phases:raise ValueError('Phase does not allow this command; inspect retained intent')
        return r

    def write(self,r,phase,**fields):
        r.update(fields,phase=phase,updatedAt=self.clock());self.j.save(r);return copy.deepcopy(r)

    def snapshot(self,r,*,backend,frontend,process,sequence=None,sealed=True):
        s=self.ops.snapshot()
        if (s['backend']!=backend or s['frontend']!=frontend or s['process']!=process or
            s['frontendArtifact']!=(self.p['oldFrontendArtifact'] if frontend==self.p['oldFrontend'] else r['frontendApproval']['artifactId']) or
            s['frontendSequence']!=(r.get('pairSequence',r['initial']['frontendSequence']) if sequence is None else sequence) or
            s['configurationSha256']!=self.p['configurationSha256'] or s['ingressSha256']!=self.p['ingressSha256']):raise ValueError('Exact pair/process/sequence/configuration drift')
        if sealed and (s['fence']!=r['operationId'] or s['ingressMode'] not in ('sealed','checking') or s['nodeMode'] not in ('checking','draining')):raise ValueError('Persistent paired seal unavailable')
        if not sealed and s!=r['initial']:raise ValueError('Baseline open control/markers changed')
        return s

    def guarded(self,r,action):
        try:return action()
        except Exception:
            phase=r['phase']
            try:self.ops.hold(r)
            finally:self.write(r,'blocked',blockedFrom=phase)
            raise

    def begin(self):
        if self.j.load() is not None:raise ValueError('Operation already exists; never replay begin')
        self.ops.validate_backend(self.p['newBackend'],self.p['backendManifestSha256'])
        s=self.ops.snapshot()
        if (s['backend']!=self.p['oldBackend'] or s['frontend']!=self.p['oldFrontend'] or s['process'] is None or
            s['frontendArtifact']!=self.p['oldFrontendArtifact'] or
            s['nodeMode']!='open' or s['ingressMode']!='open' or s['fence'] is not None or
            type(s['frontendSequence']) is not int or s['frontendSequence']<1 or
            s['configurationSha256']!=self.p['configurationSha256'] or s['ingressSha256']!=self.p['ingressSha256']):raise ValueError('Existing pair is not exact, open, or unfenced')
        r={'schemaVersion':1,'kind':'zimage-paired-release-v1','operationId':self.p['operationId'],'policySha256':self.policy_sha,
           'initial':copy.deepcopy(s),'writesMayHaveOpened':False,'migrationNonce':None,'createdAt':self.clock()}
        return self.write(r,'baseline_pending')

    def challenge(self):
        r=self.state('baseline_pending','baseline_verified','candidate_auth_pending','recovery_auth_pending','pair_auth_pending','candidate_verified','pair_verified','recovery_verified')
        pending={'baseline_verified':'baseline_pending','candidate_verified':'candidate_auth_pending','pair_verified':'pair_auth_pending','recovery_verified':'recovery_auth_pending'}.get(r['phase'],r['phase'])
        if r.get('challengeCount',0)>=8:raise ValueError('Authorized challenge rounds exhausted')
        r['phase']=pending
        baseline=r['phase']=='baseline_pending'
        release=self.p['newBackend'] if r['phase'] in ('candidate_auth_pending','pair_auth_pending') else self.p['oldBackend']
        process=r['initial']['process'] if baseline else r['candidateProcess']
        frontend=self.p['newFrontend'] if r['phase']=='pair_auth_pending' else self.p['oldFrontend']
        self.snapshot(r,backend=release,frontend=frontend,process=process,sealed=not baseline)
        now=self.clock();request={'schemaVersion':1,'operationId':r['operationId'],'backendRelease':release,'pid':process['pid'],
                                 'nonce':secrets.token_hex(32),'createdAt':now,'expiresAt':now+120}
        self.write(r,r['phase'],challenge=request,challengeCount=r.get('challengeCount',0)+1);return copy.deepcopy(request)

    def accept_auth(self,receipt):
        r=self.state('baseline_pending','candidate_auth_pending','recovery_auth_pending','pair_auth_pending')
        request=r.get('challenge')
        if not request or not request['createdAt']<=self.clock()<=request['expiresAt']:raise ValueError('Fresh challenge missing')
        baseline=r['phase']=='baseline_pending';release=request['backendRelease']
        process=r['initial']['process'] if baseline else r['candidateProcess']
        frontend=self.p['newFrontend'] if r['phase']=='pair_auth_pending' else self.p['oldFrontend']
        self.snapshot(r,backend=release,frontend=frontend,process=process,sealed=not baseline)
        self.receipt_validator(receipt,request,operation=r['operationId'],release=release,pid=process['pid'],now=self.clock())
        phase={'baseline_pending':'baseline_verified','candidate_auth_pending':'candidate_verified','recovery_auth_pending':'recovery_verified','pair_auth_pending':'pair_verified'}[r['phase']]
        return self.write(r,phase,authExpiresAt=request['expiresAt'],authReceiptSha256=digest(receipt))

    def seal(self):
        r=self.state('baseline_verified')
        if self.clock()>r['authExpiresAt']:raise ValueError('Baseline authentication expired')
        self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=r['initial']['process'],sealed=False)
        self.write(r,'seal_intent')
        def action():
            self.ops.seal(r);self.write(r,'draining')
            self.ops.drain(r,r['initial']['process'])
            self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=r['initial']['process'])
            self.write(r,'old_stop_intent');self.ops.stop(r,r['initial']['process'])
            self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=None)
            return self.write(r,'sealed')
        return self.guarded(r,action)

    def proof(self,r,value,stage):
        exact(value,PROOF_FIELDS)
        if (type(value['schemaVersion']) is not int or value['schemaVersion']!=1 or value['kind']!='zimage-paired-database-v1' or
            value['operationId']!=r['operationId'] or value['policySha256']!=self.policy_sha or value['projectRef']!=self.p['projectRef'] or
            value['stage']!=stage or value['contractSha256']!=self.p['databaseBeforeSha256' if stage=='before' else 'databaseAfterSha256'] or
            value['workerSha256']!=self.p['workerSha256'] or value['configurationSha256']!=self.p['configurationSha256'] or
            value['migrationSha256']!=self.p['migrationSha256'] or value['migrationPayloadSha256']!=self.p['migrationPayloadSha256'] or
            value['migrationNonce']!=r['migrationNonce']):raise ValueError('Database attestation is not the approved exact transition')
        if not 0<=number(self.clock())-number(value['checkedAt'])<=120:raise ValueError('Database attestation stale')
        if type(value['activeJobs']) is not int or value['activeJobs']!=0 or type(value['activeLeases']) is not int or value['activeLeases']!=0 or value['quotaWithinFree'] is not True:raise ValueError('Queue/worker/quota gate failed')
        hexid(value['financialRowsSha256'])
        if r.get('financialRowsSha256') is not None and value['financialRowsSha256']!=r['financialRowsSha256']:raise ValueError('Protected financial rows changed while sealed')
        return copy.deepcopy(value)

    def authorize_migration(self,proof):
        r=self.state('sealed');proof=self.proof(r,proof,'before')
        self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=None)
        nonce=secrets.token_hex(32)
        self.write(r,'migration_dispatch_intent',migrationNonce=nonce,financialRowsSha256=proof['financialRowsSha256'],beforeProofSha256=digest(proof))
        return {'operationId':r['operationId'],'policySha256':self.policy_sha,'projectRef':self.p['projectRef'],
                'migrationNonce':nonce,'sourceSha256':self.p['migrationSha256'],'payloadSha256':self.p['migrationPayloadSha256'],
                'dispatchAtMostOnce':True}

    def accept_database(self,proof):
        r=self.state('migration_dispatch_intent');proof=self.proof(r,proof,'after')
        self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=None)
        return self.write(r,'schema_ready',afterProofSha256=digest(proof))

    def start_candidate(self):
        r=self.state('schema_ready')
        self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=None)
        self.ops.validate_backend(self.p['newBackend'],self.p['backendManifestSha256'])
        self.write(r,'backend_select_intent')
        def action():
            self.ops.select_backend(r);self.write(r,'candidate_start_intent')
            s=self.ops.start(r,self.p['newBackend'])
            if s['process'] is None or s['process']==r['initial']['process']:raise ValueError('Candidate is not a new exact process')
            self.snapshot(r,backend=self.p['newBackend'],frontend=self.p['oldFrontend'],process=s['process'])
            return self.write(r,'candidate_auth_pending',candidateProcess=s['process'])
        return self.guarded(r,action)

    def reconcile_candidate(self,proof,expected_snapshot_sha):
        r=self.state('blocked');hexid(expected_snapshot_sha)
        if (r.get('blockedFrom')!='candidate_start_intent' or r['writesMayHaveOpened'] is not False or
            r['migrationNonce'] is None or not r.get('afterProofSha256') or r.get('candidateProcess') is not None):raise ValueError('Only an independently reconciled failed candidate start is permitted')
        self.proof(r,proof,'after')
        s=self.ops.snapshot()
        if digest(s)!=expected_snapshot_sha or s['process'] is None or s['process']==r['initial']['process'] or s['nodeMode']!='draining' or s['ingressMode']!='sealed':raise ValueError('Reconciled exact candidate snapshot differs')
        self.snapshot(r,backend=self.p['newBackend'],frontend=self.p['oldFrontend'],process=s['process'])
        self.write(r,'candidate_reconcile_intent',candidateProcess=copy.deepcopy(s['process']),reconciliationSnapshotSha256=expected_snapshot_sha)
        def action():
            self.ops.resume_checks(r,r['candidateProcess'])
            self.snapshot(r,backend=self.p['newBackend'],frontend=self.p['oldFrontend'],process=r['candidateProcess'])
            self.proof(r,proof,'after')
            return self.write(r,'candidate_auth_pending')
        return self.guarded(r,action)

    def select_frontend(self,approval):
        r=self.state('candidate_verified');exact(approval,APPROVAL_FIELDS)
        if self.clock()>r['authExpiresAt']:raise ValueError('Candidate authentication expired; request another authorized round')
        if (type(approval['schemaVersion']) is not int or approval['schemaVersion']!=1 or approval['operationId']!=r['operationId'] or
            approval['policySha256']!=self.policy_sha or approval['backendRelease']!=self.p['newBackend'] or
            approval['namespace']!=self.p['newFrontend'] or approval['candidateSha256']!=self.p['frontendCandidateSha256'] or
            approval['payloadSha256']!=self.p['frontendPayloadSha256']):raise ValueError('Formal frontend approval is not bound to frozen candidate')
        for key in ('artifactId','manifestSha256','archiveSha256','acceptanceSha256'):hexid(approval[key])
        self.snapshot(r,backend=self.p['newBackend'],frontend=self.p['oldFrontend'],process=r['candidateProcess'])
        self.write(r,'frontend_prepare_intent',frontendApproval=copy.deepcopy(approval))
        def action():
            self.ops.prepare_frontend(r,approval)
            self.write(r,'frontend_select_intent')
            s=self.ops.publish_frontend(r,approval)
            if s['frontendSequence']!=r['initial']['frontendSequence']+1:raise ValueError('Unexpected frontend generation')
            self.write(r,'pair_checking',pairSequence=s['frontendSequence'])
            self.snapshot(r,backend=self.p['newBackend'],frontend=self.p['newFrontend'],process=r['candidateProcess'])
            self.ops.probe(r)
            return self.write(r,'pair_auth_pending')
        return self.guarded(r,action)

    def final(self,r,value,stage):
        exact(value,FINAL_FIELDS)
        if (type(value['schemaVersion']) is not int or value['schemaVersion']!=1 or value['operationId']!=r['operationId'] or
            value['policySha256']!=self.policy_sha or not 0<=number(self.clock())-number(value['checkedAt'])<=120 or
            value['pairStateSha256']!=digest(self.ops.snapshot()) or value['chatAvailability']!='approved-disabled' or
            value['newPaidCallsEnabled'] is not False):raise ValueError('Fresh final operator acceptance missing or changed scope')
        hexid(value['acceptanceSha256'])

    def open(self,proof,acceptance):
        return self._open(proof,acceptance,recovery=False)

    def open_recovered(self,proof,acceptance):
        return self._open(proof,acceptance,recovery=True)

    def _open(self,proof,acceptance,*,recovery):
        r=self.state('recovery_verified' if recovery else 'pair_verified')
        if self.clock()>r['authExpiresAt']:raise ValueError('Final authenticated read expired')
        stage='before' if recovery else 'after';self.proof(r,proof,stage);self.final(r,acceptance,stage)
        backend=self.p['oldBackend' if recovery else 'newBackend'];frontend=self.p['oldFrontend' if recovery else 'newFrontend']
        self.snapshot(r,backend=backend,frontend=frontend,process=r['candidateProcess'])
        self.write(r,'final_drain_intent')
        def action():
            self.ops.drain(r,r['candidateProcess'])
            self.snapshot(r,backend=backend,frontend=frontend,process=r['candidateProcess'])
            # A slow drain cannot spend an expired DB/acceptance attestation.
            self.proof(r,proof,stage)
            if self.clock()-acceptance['checkedAt']>120:raise ValueError('Final acceptance expired during drain')
            if self.clock()>r['authExpiresAt']:raise ValueError('Final authenticated read expired during drain')
            self.write(r,'opening',writesMayHaveOpened=True,finalProofSha256=digest(proof),finalAcceptanceSha256=digest(acceptance))
            self.ops.open(r,r['candidateProcess']);self.ops.probe(r)
            if hasattr(self.ops,'complete'):self.ops.complete(r,recovery=recovery)
            return self.write(r,'recovered' if recovery else 'opened')
        return self.guarded(r,action)

    def cancel(self,proof):
        r=self.state('sealed','blocked')
        if r['migrationNonce'] is not None or r['writesMayHaveOpened'] is not False:raise ValueError('No old-pair recovery after dispatch/open intent')
        self.proof(r,proof,'before')
        s=self.ops.snapshot()
        if s['backend']!=self.p['oldBackend'] or s['frontend']!=self.p['oldFrontend'] or s['frontendArtifact']!=self.p['oldFrontendArtifact']:raise ValueError('Old pair identity changed')
        self.write(r,'recovery_start_intent')
        def action():
            if s['process'] is not None:
                if s['process']!=r['initial']['process']:raise ValueError('Old process changed')
                self.ops.drain(r,s['process']);self.ops.stop(r,s['process'])
            new=self.ops.start(r,self.p['oldBackend'])
            self.snapshot(r,backend=self.p['oldBackend'],frontend=self.p['oldFrontend'],process=new['process'])
            return self.write(r,'recovery_auth_pending',candidateProcess=new['process'])
        return self.guarded(r,action)
