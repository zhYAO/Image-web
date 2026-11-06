"""Fixed-path Linux side effects; injected paths/modules are offline-test ports.

The CLI never accepts these injection ports or a command, URL or pathname.
It imports only an authenticated, root-owned installed tool closure.
"""
import hashlib
import os
from pathlib import Path
import stat
import ssl
import signal
import urllib.request
import tempfile
import time
import urllib.error


class Paths:
    def __init__(self,root=Path('/opt/zimage'),etc=Path('/etc/zimage')):
        self.root,self.etc=Path(root),Path(etc)
        self.maintenance=self.etc/'ingress-maintenance.json'
        self.checking=self.etc/'ingress-checking.json'
        self.open=self.etc/'ingress-open.json'
        self.frontend_fence=self.etc/'frontend-checking.json'
        self.control=self.etc/'backend-maintenance.json'
        self.operations=self.root/'paired-operations'


class SystemOps:
    def __init__(self,policy,core,modules,*,paths=None,owner_uid=0,anchor=Path('/')):
        self.p,self.c,self.m=policy,core,modules
        self.paths=paths or Paths();self.uid=owner_uid;self.anchor=Path(anchor)
        self.backend,self.first,self.pub=modules.backend,modules.first,modules.publisher
        self.checkpoint=lambda _:None
        if hasattr(modules,'engine'):
            self.lifecycle=modules.engine.BackendTransaction(self.backend,self.paths.control,self.paths.operations/'unused.json')

    def owned(self,path,directory=False):
        path=Path(path)
        if path!=self.anchor and self.anchor not in path.parents:raise ValueError('Managed path escapes trusted anchor')
        for item in (path,*path.parents):
            info=item.lstat()
            is_dir=directory if item==path else True
            if (info.st_uid!=self.uid or info.st_mode&0o022 or not (stat.S_ISDIR(info.st_mode) if is_dir else stat.S_ISREG(info.st_mode) and info.st_nlink==1)):
                raise ValueError('Untrusted root-managed paired path')
            if item==self.anchor:break
        return path.lstat()

    def raw(self,path,limit=262144):
        before=self.owned(path)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            if self.c.signature(before)!=self.c.signature(os.fstat(fd)) or not 0<before.st_size<=limit:raise ValueError('Managed file bound/type changed')
            out=bytearray()
            while len(out)<=limit:
                block=os.read(fd,min(16384,limit+1-len(out)))
                if not block:break
                out.extend(block)
            if len(out)!=before.st_size or self.c.signature(before)!=self.c.signature(os.fstat(fd)) or self.c.signature(before)!=self.c.signature(path.lstat()):raise ValueError('Managed file changed during read')
            return bytes(out)
        finally:os.close(fd)

    def read(self,path,limit=262144):return self.c.parse(self.raw(path,limit))

    def maybe(self,path):return self.read(path,4096) if os.path.lexists(path) else None

    def token(self):
        return {'schemaVersion':1,'kind':'zimage-paired-release-v1','operationId':self.p['operationId'],'policySha256':self.c.digest(self.p)}

    def markers(self):
        return {key:self.maybe(getattr(self.paths,key)) for key in ('maintenance','checking','open','frontend_fence')}

    def marker_mode(self):
        flags=self.markers();token=self.token()
        if flags['maintenance'] is None and flags['checking'] is None and flags['open'] is not None and flags['frontend_fence'] is None:return 'open'
        if flags['maintenance']==token and flags['open'] is None and flags['frontend_fence']==token:
            if flags['checking'] is None:return 'sealed'
            if flags['checking']==token:return 'checking'
        return 'inconsistent'

    def configuration_digest(self):
        # Deliberately excludes Environment values and secret-file contents.
        return self.c.digest(self.first.service_metadata())

    def ingress_digest(self):
        paths=('/etc/nginx/nginx.conf','/etc/nginx/mime.types','/etc/nginx/sites-available/zimage.conf',
               '/etc/nginx/zimage-ingress-maintenance-maps.conf','/etc/nginx/zimage-ingress-maintenance-server.conf')
        return self.c.digest({path:hashlib.sha256(self.raw(Path(path),1048576)).hexdigest() for path in paths})

    def snapshot(self):
        process=self.first.process();gate=self.read(self.paths.control,4096)
        self.c.exact(gate,{'schemaVersion','operationId','mode'})
        if type(gate['schemaVersion']) is not int or gate['schemaVersion']!=2 or gate['mode'] not in ('open','checking','draining'):raise ValueError('Invalid persistent Node gate')
        if process is not None:
            observed=self.lifecycle.observed(self.backend.current(),pid=process['pid'])
            if observed['admissionMode']!=gate['mode'] or (gate['mode']!='open' and observed['admissionEpoch']!=gate['operationId']):raise ValueError('Node has not observed persistent gate')
        sequence=self.pub.read_json(self.paths.root/'frontend/sequence.json')
        self.c.exact(sequence,{'sequence'})
        flags=self.markers()
        namespace=self.pub.current()
        manifest=self.pub.sealed(namespace)
        return {'backend':self.backend.current(),'frontend':self.pub.current(),'frontendSequence':sequence['sequence'],
                'frontendArtifact':manifest['artifactId'],
                'process':process,'nodeMode':gate['mode'],'ingressMode':self.marker_mode(),
                'fence':self.p['operationId'] if flags['frontend_fence']==self.token() else (None if flags['frontend_fence'] is None else 'foreign'),
                'configurationSha256':self.configuration_digest(),'ingressSha256':self.ingress_digest(),
                'markers':flags,'nodeGate':gate}

    def put(self,path,value):
        self.owned(path.parent,True)
        if os.path.lexists(path):self.owned(path)
        self.m.transaction.atomic_json(path,value,0o644)

    def remove(self,path,expected):
        if self.maybe(path)!=expected or expected is None:raise ValueError('Foreign/missing marker cannot be removed')
        path.unlink();self.c.sync(path.parent)

    def validate_backend(self,release,expected_manifest):
        if release!=self.p['newBackend'] or expected_manifest!=self.p['backendManifestSha256']:raise ValueError('Unapproved backend artifact')
        target=self.paths.root/'releases'/release
        self.m.adapter.verify_retained_layered(target,release)
        if self.raw(target/'.manifest-sha256',128).decode().strip()!=expected_manifest:raise ValueError('Actual backend manifest differs from policy')

    def seal(self,record):
        initial=record['initial']['markers']
        if self.markers()!=initial or initial['maintenance'] is not None or initial['checking'] is not None or initial['frontend_fence'] is not None or initial['open'] is None:raise ValueError('Existing marker generation changed')
        token=self.token()
        self.put(self.paths.frontend_fence,token);self.checkpoint('frontend_fenced')
        self.put(self.paths.maintenance,token);self.checkpoint('maintenance_installed')
        self.remove(self.paths.open,initial['open']);self.checkpoint('old_open_removed')
        if self.marker_mode()!='sealed':raise ValueError('Ingress is not persistently sealed')
        self.seal_probe()

    def seal_probe(self):
        # A fixed benign GET. It cannot initiate work even with a misconfigured
        # ingress. HTTP port80 intentionally remains the canonical HTTPS redirect.
        try:self.m.frontend.http_read('https://www.zimage.store/api/meta')
        except urllib.error.HTTPError as error:
            if error.code==503 and 'no-store' in error.headers.get('Cache-Control','').lower():return
        raise ValueError('Actual TLS ingress has not observed the seal')

    def node_gate(self,mode):
        if mode not in ('draining','checking','open'):raise ValueError('Invalid fixed Node mode')
        self.put(self.paths.control,{'schemaVersion':2,'operationId':self.p['operationId'],'mode':mode})

    def require_ours(self,*,checking=None):
        flags=self.markers();token=self.token()
        if flags['maintenance']!=token or flags['frontend_fence']!=token or flags['open'] is not None or flags['checking'] not in (None,token):raise ValueError('Exact persistent paired fence absent')
        if checking is not None and (flags['checking']==token)!=checking:raise ValueError('Unexpected checking admission')

    def exact_process(self,process):
        if process is None or self.first.process()!=process:raise ValueError('Exact PID/start identity drift')

    def drain(self,record,process):
        self.require_ours();self.exact_process(process)
        if self.maybe(self.paths.checking) is not None:self.remove(self.paths.checking,self.token())
        self.node_gate('draining')
        self.lifecycle.drain(self.backend.current(),record['operationId'],process['pid'],timeout=300)
        self.exact_process(process);self.require_ours(checking=False)

    def stop(self,record,process):
        self.require_ours(checking=False);self.exact_process(process)
        value=self.lifecycle.observed(self.backend.current(),record['operationId'],process['pid'])
        if value['admissionMode']!='draining' or value['activeHttpRequests'] or value['activeFrameworkWork'] or any(value['counters'].values()) or value['drained'] is not True:raise ValueError('Stop requires the full exact drained barrier')
        self.backend.stop()
        if self.first.process() is not None:raise ValueError('Service stop result uncertain')

    def select_backend(self,record):
        self.require_ours(checking=False)
        if self.first.process() is not None or record['phase']!='backend_select_intent':raise ValueError('Backend selection requires stopped service and intent')
        self.backend.select(self.p['newBackend'],self.p['oldBackend'])

    def readiness_get(self,url,timeout):
        allowed={base+path for base in ('http://127.0.0.1:3100','https://www.zimage.store') for path in ('/api/health/ready','/api/meta','/api/account','/api/auth/session')}
        if url not in allowed or not 0<timeout<=3:raise ValueError('Unapproved readiness target')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),self.m.legacy.NoRedirect(),
            self.m.legacy.LocalIngressHTTPSHandler(context=ssl.create_default_context()))
        request=urllib.request.Request(url,headers={'Host':'www.zimage.store','Accept':'application/json','Cache-Control':'no-cache'})
        body_deadline=time.monotonic()+timeout
        try:response=opener.open(request,timeout=timeout)
        except urllib.error.HTTPError as error:response=error
        with response:
            body=bytearray()
            while True:
                if time.monotonic()>=body_deadline:raise ValueError('Readiness body deadline expired')
                block=response.read1(65537-len(body))
                if not block:break
                body.extend(block)
                if len(body)>65536:raise ValueError('Readiness body exceeds bound')
            if time.monotonic()>body_deadline or response.headers.get_content_type()!='application/json' or 'no-store' not in response.headers.get('Cache-Control','').lower():raise ValueError('Readiness response deadline/MIME/cache failed')
            return response.status,bytes(body)

    def checking_ready(self,release,deadline=None):
        deadline=time.monotonic()+40 if deadline is None else deadline
        for base in ('http://127.0.0.1:3100','https://www.zimage.store'):
            for path in ('/api/health/ready','/api/meta','/api/account','/api/auth/session'):
                remaining=deadline-time.monotonic()
                if remaining<=0:raise ValueError('Readiness deadline expired')
                code,raw=self.readiness_get(base+path,min(3,remaining))
                if time.monotonic()>deadline:raise ValueError('Readiness deadline expired')
                body=self.c.parse(raw)
                if path=='/api/health/ready':
                    if code!=200 or type(body)is not dict or body.get('status')!='ok' or body.get('version')!=release:raise ValueError('Exact readiness version failed')
                elif path=='/api/meta':
                    self.c.exact(body,{'schemaVersion','backendRelease','api','capabilities'});self.c.exact(body['api'],{'major','minor'})
                    caps=body['capabilities']
                    if (code!=200 or type(body['schemaVersion'])is not int or body['schemaVersion']!=1 or body['backendRelease']!=release or
                        type(body['api']['major'])is not int or body['api']['major']!=1 or type(body['api']['minor'])is not int or body['api']['minor']<0 or
                        type(caps)is not list or len(caps)>256 or any(type(x)is not str or not x or len(x)>100 for x in caps) or len(set(caps))!=len(caps) or
                        not {'runtime.public-config.v1','runtime.meta.v1'}.issubset(caps)):raise ValueError('Exact readiness metadata failed')
                elif code!=401 or type(body)is not dict or body.get('code')!='unauthorized':raise ValueError('Unauthenticated readiness must remain unauthorized')

    def wait_checking_ready(self,release,*,timeout=40):
        if not 0<timeout<=40 or signal.getitimer(signal.ITIMER_REAL)!=(0.0,0.0):raise ValueError('Unoccupied bounded readiness deadline required')
        previous=signal.getsignal(signal.SIGALRM)
        def expired(signum,frame):raise TimeoutError('Hard readiness deadline reached')
        signal.signal(signal.SIGALRM,expired)
        deadline=time.monotonic()+timeout
        try:
            signal.setitimer(signal.ITIMER_REAL,timeout)
            while True:
                try:return self.checking_ready(release,deadline)
                except (OSError,ValueError):
                    if time.monotonic()+0.25>=deadline:raise
                    time.sleep(0.25)
        finally:
            signal.setitimer(signal.ITIMER_REAL,0)
            signal.signal(signal.SIGALRM,previous)

    def resume_checks(self,record,process):
        if record['phase']!='candidate_reconcile_intent':raise ValueError('Durable reconciliation intent required')
        self.require_ours(checking=False);self.exact_process(process)
        observed=self.lifecycle.observed(self.p['newBackend'],record['operationId'],process['pid'])
        if (observed['admissionMode']!='draining' or observed['activeHttpRequests'] or observed['activeFrameworkWork'] or
            any(observed['counters'].values()) or observed['drained'] is not True):raise ValueError('Reconciliation requires full drained barrier')
        self.node_gate('checking');self.put(self.paths.checking,self.token())
        self.wait_checking_ready(self.p['newBackend'])
        self.exact_process(process);self.require_ours(checking=True)

    def start(self,record,release):
        self.require_ours(checking=False)
        if release not in (self.p['oldBackend'],self.p['newBackend']) or self.backend.current()!=release or self.first.process() is not None:raise ValueError('Start exact retained stopped backend only')
        if release==self.p['oldBackend'] and record['migrationNonce'] is not None:raise ValueError('Old backend forbidden after migration dispatch')
        self.backend.native(release)
        self.node_gate('checking');self.put(self.paths.checking,self.token())
        self.backend.start();self.wait_checking_ready(release)
        result=self.snapshot()
        self.require_ours(checking=True)
        return result

    def prepare_frontend(self,record,approval):
        self.require_ours(checking=True);self.exact_process(record['candidateProcess'])
        value=self.pub.seal(record['operationId'],self.p['newFrontend'],approval['archiveSha256'],approval['manifestSha256'])
        acceptance=Path('/etc/zimage/frontend-acceptances')/(value['artifactId']+'.json')
        if hashlib.sha256(self.raw(acceptance)).hexdigest()!=approval['acceptanceSha256']:raise ValueError('Root frontend approval changed')
        installed=self.read(acceptance)
        if (value['artifactId']!=approval['artifactId'] or value['sourceSHA']!=self.p['newBackend'] or
            value['fileIndex']['sha256']!=self.p['frontendPayloadSha256'] or installed['candidateSha256']!=self.p['frontendCandidateSha256'] or
            value['verifiedBackendReleases']!=[self.p['newBackend']] or self.pub.checked_meta(value)!=self.p['newBackend']):raise ValueError('Formal frontend artifact/approval is not the approved new pair')

    def publish_frontend(self,record,approval):
        self.require_ours(checking=True);self.exact_process(record['candidateProcess'])
        if self.pub.current()!=self.p['oldFrontend']:raise ValueError('Old frontend changed before paired selection')
        value=self.pub.sealed(self.p['newFrontend'],approval['manifestSha256'])
        if self.pub.checked_meta(value)!=self.p['newBackend']:raise ValueError('Actual new API compatibility failed')
        frontend_record=self.pub.start(record['operationId'],{'kind':'paired','namespace':self.p['newFrontend'],
                        'artifactId':approval['artifactId'],'policySha256':self.c.digest(self.p)},self.p['oldFrontend'])
        if frontend_record['state']!='preparing' or frontend_record['sequence']!=record['initial']['frontendSequence']+1:raise ValueError('Frontend operation already exists or generation drifted')
        self.pub.asset_mapping(self.p['newFrontend'])
        self.pub.persist(frontend_record,'switching')
        self.pub.atomic_pointer('current',self.p['newFrontend'])
        self.pub.persist(frontend_record,'checking')
        return self.snapshot()

    def probe(self,record):
        frontend=self.pub.current();backend=self.backend.current()
        if (frontend,backend) not in ((self.p['oldFrontend'],self.p['oldBackend']),(self.p['newFrontend'],self.p['newBackend'])):raise ValueError('Cross-schema pair is not a valid public probe target')
        if not self.m.frontend.production_probe(frontend,backend):raise ValueError('Public pair/static integrity probe failed')

    def complete(self,record,*,recovery):
        if recovery:return
        self.exact_process(record['candidateProcess'])
        if self.backend.current()!=self.p['newBackend'] or self.pub.current()!=self.p['newFrontend']:raise ValueError('Pair drift during completion')
        path=self.paths.root/'frontend/journal'/(record['operationId']+'.json')
        frontend_record=self.pub.read_json(path)
        if frontend_record['sequence']!=record['pairSequence'] or frontend_record['state']!='checking':raise ValueError('Frontend completion generation drift')
        self.pub.atomic_pointer('previous',self.p['oldFrontend'])
        self.backend.previous(self.p['oldBackend'])
        frontend_record['success']=True;self.pub.persist(frontend_record,'committed')

    def open(self,record,process):
        if record['phase']!='opening' or record['writesMayHaveOpened'] is not True:raise ValueError('Durable opening intent required')
        self.require_ours(checking=False);self.exact_process(process)
        value=self.lifecycle.observed(self.backend.current(),record['operationId'],process['pid'])
        if value['admissionMode']!='draining' or value['activeHttpRequests'] or value['activeFrameworkWork'] or any(value['counters'].values()) or value['drained'] is not True:raise ValueError('Open requires a fresh complete drain')
        self.put(self.paths.open,self.token());self.checkpoint('new_open_installed')
        self.node_gate('open')
        # Node observes the gate asynchronously. No public requests are possible
        # while M remains; wait only for this exact process, never restart it.
        deadline=time.monotonic()+10
        while True:
            self.exact_process(process)
            value=self.lifecycle.observed(self.backend.current(),pid=process['pid'])
            if value['admissionMode']=='open' and value['maintenance'] is False:break
            if time.monotonic()>=deadline:raise ValueError('Node open observation deadline')
            time.sleep(0.05)
        self.checkpoint('node_open')
        self.remove(self.paths.frontend_fence,self.token());self.checkpoint('frontend_unfenced')
        if self.maybe(self.paths.maintenance)!=self.token() or self.maybe(self.paths.open)!=self.token() or self.maybe(self.paths.checking) is not None:raise ValueError('Gate drift at final open boundary')
        self.remove(self.paths.maintenance,self.token());self.checkpoint('ingress_open')
        if self.marker_mode()!='open':raise ValueError('Final ingress opening result uncertain')

    def hold(self,record):
        # Only this exact operation or its captured initial open marker may be
        # touched. Never erase another coordinator's flags or select old code.
        token=self.token();flags=self.markers();old=record['initial']['markers']
        if flags['maintenance'] not in (None,token) or flags['checking'] not in (None,token) or flags['frontend_fence'] not in (None,token) or flags['open'] not in (None,token,old['open']):raise ValueError('Foreign markers require manual reconciliation')
        self.put(self.paths.maintenance,token);self.put(self.paths.frontend_fence,token)
        for name in ('open','checking'):
            value=self.maybe(getattr(self.paths,name))
            if value is not None:self.remove(getattr(self.paths,name),value)
        self.node_gate('draining')
