"""Fixed GitHub GET-only report transport. No signing or deployment."""
import hashlib
import http.client
import json
import re
import ssl
from urllib.parse import urlsplit

from github_shadow_signer_intake import require

API = 'api.github.com'
ROOT = '/repos/zhYAO/Image-web'
MAX_JSON = 1_000_000
N = r'[1-9][0-9]{0,18}'
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')


def official_root(host):
    return host == 'results-receiver.actions.githubusercontent.com' or bool(
        re.fullmatch(r'[a-z0-9]{3,24}\.blob\.core\.windows\.net', host))


class Transport:
    def __init__(self, *, token, run, attempt, ids, object_hosts, connect=http.client.HTTPSConnection):
        require(type(token) is str and re.fullmatch(r'[A-Za-z0-9_.-]{8,1024}', token))
        require(set(ids) == {'report', 'backend', 'frontend'} and len(set(ids.values())) == 3)
        for value in (run, attempt, *ids.values()):
            require(type(value) is int and re.fullmatch(N, str(value)))
        require(type(object_hosts) in (set, frozenset) and 0 < len(object_hosts) <= 8
                and all(type(h) is str and official_root(h) for h in object_hosts))
        self.hosts, self.connect = frozenset(object_hosts), connect
        self.report = ROOT + '/actions/artifacts/' + str(ids['report'])
        run_path = f'{ROOT}/actions/runs/{run}/attempts/{attempt}'
        self.json_paths = {ROOT+'/branches/main', ROOT+'/actions/workflows/rehearsal-candidates.yml',
                           run_path, run_path+'/jobs?per_page=100'} | {
            ROOT+'/actions/artifacts/'+str(i) for i in ids.values()}
        self.headers = {'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json',
                        'X-GitHub-Api-Version':'2022-11-28',
                        'Accept-Encoding':'identity','User-Agent':'zimage-stage-shadow/1'}
        self.tls = ssl.create_default_context()

    def _read(self, host, path, headers, status, cap):
        conn = self.connect(host, timeout=5, context=self.tls)
        try:
            conn.request('GET', path, headers=headers)
            r = conn.getresponse()
            require(r.status == status)
            if status == 302:
                location = [v for k,v in r.getheaders() if k.lower() == 'location']
                require(len(location) == 1)
                return location[0]
            require(r.getheader('Content-Encoding', 'identity') == 'identity')
            raw = r.read(cap+1)
            require(0 < len(raw) <= cap)
            return raw
        except Exception:
            # Exception messages may contain signed redirect URI or secrets.
            raise ValueError('GitHub report transport rejected') from None
        finally:
            conn.close()

    def get(self, path):
        require(path in self.json_paths)
        def unique(pairs):
            value = dict(pairs)
            require(len(value) == len(pairs))
            return value
        value = json.loads(self._read(API,path,self.headers,200,MAX_JSON), object_pairs_hook=unique)
        require(type(value) is dict)
        return value

    def download_report(self, path, cap):
        require(path == self.report+'/zip' and type(cap) is int and 0 < cap <= 65536)
        meta = self.get(self.report)
        expected = meta['digest']
        size = meta['size_in_bytes']
        require(type(expected) is str and DIGEST.fullmatch(expected)
                and type(size) is int and 0 < size <= cap)
        raw_location = self._read(API,path,self.headers,302,0)
        require(type(raw_location) is str and raw_location.isascii() and 0 < len(raw_location) <= 8192
                and not re.search(r'[\x00-\x20\x7f\\#]', raw_location))
        location = urlsplit(raw_location)
        require(location.scheme == 'https' and location.netloc in self.hosts
                and location.path.startswith('/') and not location.path.startswith('//')
                and location.query and not location.fragment)
        value = self._read(location.netloc,location.path+'?'+location.query,
                           {'Accept-Encoding':'identity','User-Agent':'zimage-stage-shadow/1'},200,cap)
        require(len(value) == size and 'sha256:'+hashlib.sha256(value).hexdigest() == expected)
        return value
