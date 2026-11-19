"""Read-only ECS public-image acceptance and a local, uninstalled route review map."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

_spec = importlib.util.spec_from_file_location('reviewed_public_images', Path(__file__).with_name('public-images.py'))
images = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(images)
ORIGIN = 'https://www.zimage.store'


def checked_policy():
    raw = images.POLICY.read_bytes().replace(b'\r\n', b'\n')
    policy = json.loads(raw)
    originals = images.checked_images(images.ROOT / 'apps/web/public', policy)
    if len(originals) != 62:
        raise ValueError('Reviewed image count changed: update all shared allowlists deliberately')
    return policy, hashlib.sha256(raw).hexdigest()


def validate_base(base, version):
    expected = ORIGIN + '/static-assets/' + version
    # An exact literal rejects credentials, redirects, queries, alternate hosts/ports and path normalization.
    if base != expected:
        raise ValueError('Expected the exact reviewed same-origin immutable image base')
    return expected


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_public_image(url, maximum, timeout):
    # Default certificate/hostname verification and normal network policy. No auth, proxy override or TLS relaxation.
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(url, headers={'Accept-Encoding': 'identity'}, method='GET')
    with opener.open(request, timeout=timeout) as response:
        deadline = time.monotonic() + timeout
        data = bytearray()
        while len(data) <= maximum:
            if time.monotonic() >= deadline:
                raise TimeoutError('Bounded public image read')
            chunk = response.read1(min(65536, maximum + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        return response.status, {key.lower(): value for key, value in response.headers.items()}, bytes(data)


def immutable_public_cache(value):
    tokens = {part.strip().lower() for part in value.split(',')}
    return ({'public', 'immutable'} <= tokens and not tokens.intersection({'private', 'no-store', 'no-cache'})
            and any(re.fullmatch(r'max-age=[0-9]+', token) and int(token.split('=')[1]) >= 86400 for token in tokens))


def verify(base, fetch=fetch_public_image, clock=time.monotonic):
    policy, version = checked_policy()
    validate_base(base, version)
    deadline = clock() + 60
    rows = []
    for entry in policy['files']:
        if clock() >= deadline:
            rows.append({'path': entry['path'], 'verified': False, 'reason': 'total-time-limit'})
            break
        row = {'path': entry['path'], 'verified': False}
        try:
            status, headers, body = fetch(base + '/' + entry['path'], entry['bytes'], min(5, max(.1, deadline-clock())))
            row['status'] = status
            if status != 200:
                row['reason'] = 'http-status'
            elif headers.get('content-type', '').split(';')[0].strip().lower() != entry['contentType']:
                row['reason'] = 'image-mime'
            elif headers.get('content-encoding', 'identity').lower() not in ('', 'identity'):
                row['reason'] = 'encoded-body'
            elif len(body) != entry['bytes'] or hashlib.sha256(body).hexdigest() != entry['sha256']:
                row['reason'] = 'image-bytes-or-sha256'
            elif headers.get('x-content-type-options', '').lower() != 'nosniff':
                row['reason'] = 'missing-nosniff'
            elif not immutable_public_cache(headers.get('cache-control', '')):
                row['reason'] = 'missing-immutable-public-cache'
            else:
                row.update(verified=True, bytes=len(body), sha256=entry['sha256'], contentType=entry['contentType'])
        except urllib.error.HTTPError as error:
            row.update(status=error.code, reason='http-status')
            error.close()
        except Exception:
            # Never emit a response body, low-level URL/error string, environment, or credentials.
            row['reason'] = 'network-or-tls-unverified'
        rows.append(row)
        if not row['verified']:
            break
    passed = len(rows) == len(policy['files']) and all(row['verified'] for row in rows)
    return dict(schema=1, kind='public-image-https-acceptance', baseUrl=base, manifestSha256=version,
                expectedImages=len(policy['files']), checkedImages=len(rows), verifiedImages=sum(row['verified'] for row in rows),
                allImagesVerified=passed, productionReady=False, serverChanges=False, imageTransfers=0, files=rows)


def route_review_map(resource_directory):
    policy, version = checked_policy()
    # This is a reviewed existing cache namespace, never an arbitrary path, shell snippet or upload destination.
    if not re.fullmatch(r'/opt/zimage/layer-cache/assets/[a-f0-9]{64}', resource_directory):
        raise ValueError('Expected an independently verified immutable existing resource directory')
    return dict(schema=1, kind='public-image-route-review-only', installed=False, serverChanges=False,
                imageTransfers=0, productionReady=False, manifestSha256=version,
                proposedBaseUrl=ORIGIN+'/static-assets/'+version, resourceDirectory=resource_directory,
                requiresExistingFileRecheck=True, requiresServerConfigReview=True, requiresResourceRetention=True,
                routes=[dict(urlPath='/static-assets/'+version+'/'+entry['path'], source=resource_directory+'/'+entry['path'],
                             bytes=entry['bytes'], sha256=entry['sha256'], contentType=entry['contentType']) for entry in policy['files']])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-base')
    mode.add_argument('--review-resource-directory')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = verify(args.verify_base) if args.verify_base else route_review_map(args.review_resource_directory)
    text = json.dumps(result, indent=2)+'\n'
    if args.output:
        output = args.output.resolve()
        if output == images.ROOT or output.is_relative_to(images.ROOT):
            raise ValueError('Generated reports must stay outside the checkout')
        with output.open('x', encoding='utf-8') as stream:
            stream.write(text)
    print(json.dumps({key: value for key, value in result.items() if key not in ('files', 'routes')}))
    return 0 if not args.verify_base or result['allImagesVerified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
