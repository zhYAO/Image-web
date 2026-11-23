"""Pure, offline validation of the reviewed public-image contract.

No network, filesystem discovery, credentials or first-use trust. The source
policy digest is an independently reviewed constant, not supplied by an archive.
This companion must be installed with any new verifier that consumes it.
"""
import hashlib
import json
import re

POLICY_SHA256 = '6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24'
BASE_URL = 'https://www.zimage.store/static-assets/' + POLICY_SHA256
METADATA = 'public-image-contract.json'


def validate(value):
    if (type(value) is not dict or set(value) != {'schema', 'baseUrl', 'manifestSha256', 'files'}
            or type(value['schema']) is not int or value['schema'] != 1
            or value['baseUrl'] != BASE_URL or value['manifestSha256'] != POLICY_SHA256
            or type(value['files']) is not list or len(value['files']) != 62):
        raise ValueError('Invalid pinned public image contract')
    files = []
    for item in value['files']:
        if (type(item) is not dict or set(item) != {'path', 'bytes', 'sha256', 'contentType'}
                or not isinstance(item['path'], str)
                or not re.fullmatch(r'commerce/(?:[a-z0-9][a-z0-9._-]*/)*[a-z0-9][a-z0-9._-]*\.(?:jpg|webp)', item['path'])
                or type(item['bytes']) is not int or not 0 < item['bytes'] <= 16 * 1024 * 1024
                or not isinstance(item['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])
                or item['contentType'] != ('image/jpeg' if item['path'].endswith('.jpg') else 'image/webp')):
            raise ValueError('Invalid public image entry')
        files.append({key: item[key] for key in ('path', 'bytes', 'sha256', 'contentType')})
    if [item['path'] for item in files] != sorted({item['path'] for item in files}):
        raise ValueError('Public image entries must be unique and ordered')
    # Reconstruct the original reviewed LF policy, independently of JSON field
    # order/whitespace in the uploaded contract. Unknown/mixed hashes fail.
    body = (json.dumps({'schema': 1, 'kind': 'public-images', 'files': files}, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if hashlib.sha256(body).hexdigest() != POLICY_SHA256:
        raise ValueError('Public image policy differs from reviewed bytes')
    return value


def urls(value):
    validate(value)
    return {BASE_URL + '/' + item['path'] for item in value['files']}


def reject_copies(records, value):
    validate(value)
    paths = {item['path'] for item in value['files']}
    hashes = {item['sha256'] for item in value['files']}
    if any(item['path'] in paths or item['sha256'] in hashes
           or (item['path'].startswith('commerce/') and re.search(r'\.(?:jpe?g|webp|png)$', item['path'], re.I)) for item in records):
        raise ValueError('External public image copied into payload, including renamed copy')
