import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


def digest(body):
    return hashlib.sha256(body).hexdigest()


def archive(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as packed:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            packed.addfile(member, io.BytesIO(data))
    return output.getvalue()


class FrontendReviewTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('frontend_review.py')
        spec = importlib.util.spec_from_file_location('frontend_review', path)
        self.review = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.review)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name).resolve()

    def candidate(self, files=None, *, changed_descriptor=False):
        descriptor = b'{"fixture":true}\n'
        inner = archive({'./.release/candidate.json': descriptor, './index.html': b'front', **(files or {})})
        outer_descriptor = b'{}\n' if changed_descriptor else descriptor
        body = archive({
            './frontend-candidate.tgz': inner, './candidate.json': outer_descriptor,
            './SHA256SUMS': f'{digest(inner)}  frontend-candidate.tgz\n{digest(outer_descriptor)}  candidate.json\n'.encode(),
        })
        target = self.work / 'input.tgz'
        target.write_bytes(body)
        return target, digest(body)

    def test_verifies_both_archives_before_exposing_candidate_files(self):
        bundle, checksum = self.candidate()
        result = self.review.extract_candidate(bundle, checksum, self.work)
        self.assertEqual((result / 'index.html').read_bytes(), b'front')

    def test_rejects_substitution_traversal_and_mismatched_descriptor(self):
        for files, changed, wrong in ((None, False, True), ({'../escape.js': b'bad'}, False, False), (None, True, False)):
            with self.subTest(changed=changed, wrong=wrong, files=files), tempfile.TemporaryDirectory(dir=self.work) as scratch:
                bundle, checksum = self.candidate(files, changed_descriptor=changed)
                with self.assertRaises(ValueError):
                    self.review.extract_candidate(bundle, '0' * 64 if wrong else checksum, Path(scratch))
                self.assertFalse((self.work / 'escape.js').exists())

    def test_requires_report_digest_and_exact_frontend_and_backend_subject(self):
        subject = {'schemaVersion': 1, 'candidateSha256': 'a' * 64, 'payloadIndexSha256': 'b' * 64,
                   'publicConfigFingerprint': 'c' * 64}
        archive_sha = 'd' * 64
        source_sha = 'e' * 40
        backend = 'f' * 40
        report = dict(subject, sourceSHA=source_sha, backendRelease=backend, outerArchiveSha256=archive_sha)
        for value in (report, dict(report, backendRelease='0' * 40), dict(report, candidateSha256='0' * 64)):
            body = json.dumps(value).encode()
            report_sha = digest(body)
            (self.work / (report_sha + '.json')).write_bytes(body)
            evidence = dict(subject, backendReleases=[{'backendRelease': backend, 'acceptanceSha256': report_sha}])
            if value == report:
                self.assertEqual(self.review.review_reports(evidence, subject, self.work, source_sha, archive_sha), {report_sha: body})
                (self.work / (report_sha + '.json')).write_bytes(b'changed')
            with self.assertRaises(ValueError):
                self.review.review_reports(evidence, subject, self.work, source_sha, archive_sha)
