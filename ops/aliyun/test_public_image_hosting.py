import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('public_image_hosting', Path(__file__).with_name('public-image-hosting.py'))
hosting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosting)


class PublicImageHostingTests(unittest.TestCase):
    def setUp(self):
        self.policy, self.version = hosting.checked_policy()
        self.base = hosting.ORIGIN+'/static-assets/'+self.version
        self.payload = {entry['path']: (hosting.images.ROOT/'apps/web/public'/entry['path']).read_bytes() for entry in self.policy['files']}

    def fetch(self, url, maximum, timeout):
        name = url.removeprefix(self.base+'/')
        entry = next(e for e in self.policy['files'] if e['path'] == name)
        self.assertEqual(maximum, entry['bytes']); self.assertTrue(0 < timeout <= 5)
        return 200, {'content-type':entry['contentType'], 'x-content-type-options':'nosniff', 'cache-control':'public, max-age=31536000, immutable'}, self.payload[name]

    def test_policy_version_is_canonical_and_deadline_cannot_be_a_pass(self):
        self.assertEqual(self.version,'6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24')
        raw=hosting.images.POLICY.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
        with patch.object(hosting.images,'POLICY',SimpleNamespace(read_bytes=lambda:raw)):
            self.assertEqual(hosting.checked_policy()[1],self.version)
        with patch.object(hosting,'fetch_public_image') as fetch:
            result=hosting.verify(self.base,fetch,clock=iter([0,61]).__next__)
            self.assertFalse(result['allImagesVerified']);fetch.assert_not_called()

    def test_catalogue_image_absent_from_policy_is_rejected(self):
        policy=dict(self.policy,files=self.policy['files'][1:])
        with self.assertRaisesRegex(ValueError,'Unreviewed public catalogue image'):
            hosting.images.checked_images(hosting.images.ROOT/'apps/web/public',policy)

    def test_offline_all_62_exact_images_pass_without_claiming_app_readiness(self):
        result = hosting.verify(self.base, self.fetch)
        self.assertTrue(result['allImagesVerified']); self.assertEqual(result['verifiedImages'],62)
        self.assertFalse(result['productionReady']); self.assertFalse(result['serverChanges'])
        self.assertEqual(sum(row['bytes'] for row in result['files']),8067881)

    def test_rejects_configuration_before_any_request(self):
        for base in [self.base+'/',self.base+'?x=1',self.base+'#fragment',self.base.replace('https:','http:'),self.base.replace('www.zimage.store','other.test'),self.base.replace('https://','https://user@'),self.base.replace(self.version,'0'*64)]:
            with self.subTest(base=base), patch.object(hosting,'fetch_public_image') as request:
                with self.assertRaises(ValueError):hosting.verify(base,request)
                request.assert_not_called()

    def test_first_unverified_response_stops_without_body_or_error_disclosure(self):
        for mode in ['status','mime','body','encoding','nosniff','immutable','redirect','network','private-cache']:
            calls=[]
            def broken(url,maximum,timeout):
                calls.append(url)
                if mode=='redirect':raise urllib.error.HTTPError(url,302,'redirect',{},None)
                if mode=='network':raise RuntimeError('synthetic private error must not escape')
                status,headers,body=self.fetch(url,maximum,timeout)
                if mode=='status':status=404
                if mode=='mime':headers['content-type']='text/html'
                if mode=='body':body=b'not the reviewed image'
                if mode=='encoding':headers['content-encoding']='gzip'
                if mode=='nosniff':headers.pop('x-content-type-options')
                if mode=='immutable':headers.pop('cache-control')
                if mode=='private-cache':headers['cache-control']='private, no-store, immutable'
                return status,headers,body
            result=hosting.verify(self.base,broken)
            self.assertFalse(result['allImagesVerified']);self.assertEqual(len(calls),1)
            self.assertNotIn('synthetic private error',str(result))
            self.assertEqual(result['verifiedImages'],0)

    def test_no_redirect_handler_and_fixed_request_semantics(self):
        self.assertIsNone(hosting.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://other.test'))
        with patch.object(hosting.urllib.request,'build_opener') as build:
            response=build.return_value.open.return_value.__enter__.return_value
            response.status=200;response.headers={'Content-Type':'image/webp'};response.read1.side_effect=[b'fixture',b'']
            hosting.fetch_public_image(self.base+'/commerce/test.webp',123,5)
            request=build.return_value.open.call_args.args[0]
            self.assertEqual(request.get_method(),'GET');self.assertEqual(request.get_header('Accept-encoding'),'identity')
            self.assertEqual(response.read1.call_args_list[0].args,(124,))

    def test_review_map_is_exact_image_only_and_never_a_server_write(self):
        root='/opt/zimage/layer-cache/assets/'+'a'*64
        result=hosting.route_review_map(root)
        self.assertEqual(len(result['routes']),62);self.assertFalse(result['installed'])
        self.assertTrue(result['requiresServerConfigReview']);self.assertTrue(result['requiresResourceRetention'])
        self.assertTrue(all(row['source'].startswith(root+'/commerce/') and row['source'].endswith(('.jpg','.webp')) for row in result['routes']))
        for bad in [root+'/../private',root+';command','/tmp/images','/opt/zimage/current']:
            with self.assertRaises(ValueError):hosting.route_review_map(bad)


if __name__=='__main__':unittest.main()
