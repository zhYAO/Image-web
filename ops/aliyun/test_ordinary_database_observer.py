import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest

import ordinary_database_observer as observer


TABLES = dict.fromkeys('private.' + name for name in ('chat_usage_versions', 'chat_usage_settings',
                                                     'chat_usage_operations', 'image_usage_receipts'))
FUNCTIONS = dict.fromkeys((
    'public.chat_usage_dispatch(uuid,text,jsonb)', 'public.credit_dispatch(uuid,text,jsonb)',
    'private.credit_settle(uuid,text,text)', 'public.openai_chat_relay(uuid,uuid,text,text,text)',
    'public.doubao_chat_relay(uuid,uuid,text,text,text)', 'private.chat_usage_immutable()',
    'private.chat_usage_config(text)', 'private.chat_usage_cap(jsonb)', 'private.chat_usage_amount(jsonb,bigint,jsonb)',
    'private.preserve_image_usage_receipt()', 'private.credit_dispatch_before_token(uuid,text,jsonb)',
    'private.credit_settle_before_token(uuid,text,text)', 'private.openai_chat_relay_before_token(uuid,uuid,text,text,text)',
    'private.doubao_chat_relay_before_token(uuid,uuid,text,text,text)',
))
EMPTY_ROWS = hashlib.sha256(b'[]').hexdigest()
EXPECTED = dict(schemaVersion=2, projectRef=observer.PROJECT, chatUsageConfiguration={'exists': False},
                objects=dict(functions=FUNCTIONS, tables=TABLES, triggers=dict.fromkeys((
                    'private.chat_usage_versions.chat_usage_version_immutable',
                    'private.generation_work.preserve_image_usage_receipt',
                ))),
                migrations=[dict(version='1', name='isolated_fixture')],
                pricing=dict(creditSettings=None, creditVersionsSha256=EMPTY_ROWS, packageSettings=None,
                             packageCostVersionsSha256=EMPTY_ROWS, packageSaleVersionsSha256=EMPTY_ROWS,
                             providerFlags=None, runtimeFlags=None),
                supplement=dict(exactPrivateRevokeScope=[], affectedNameOverloads=[], tableAndColumnAccess=TABLES,
                                 allUserTriggersOnTouchedRelations=dict(TABLES, **{'private.generation_work': None})))


class DatabaseProbeTest(unittest.TestCase):
    def test_canonical_encoding_matches_the_prior_evidence_contract(self):
        vector = observer.QUERY.parent.parent / '20261106-m6-contract/before.json'
        approved = observer.QUERY.with_name('before-refresh-summary.json')
        self.assertEqual(observer.sha(json.loads(vector.read_bytes())), json.loads(approved.read_bytes())['canonicalSha256'])

    def test_exact_stock_sql_is_wrapped_in_one_read_only_snapshot(self):
        script = observer.script()
        self.assertTrue(script.startswith(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'))
        self.assertTrue(script.endswith(b'ROLLBACK;\n'))

    @unittest.skipUnless(os.environ.get('ZIMAGE_OBSERVER_FIXTURE_SOCKET'), 'Requires fresh, isolated local PostgreSQL')
    def test_real_postgres_observation_and_rejections(self):
        socket = Path(os.environ['ZIMAGE_OBSERVER_FIXTURE_SOCKET'])
        psql = Path(os.environ['ZIMAGE_OBSERVER_FIXTURE_PSQL'])
        contract = observer.sha(EXPECTED)
        args = dict(mode='fixture', operation='zimage-release-1-1', packet_sha256='a' * 64,
                    expected_contract=contract)
        evidence = observer.measure(psql, socket, **args)
        self.assertEqual(evidence['mode'], 'fixture')
        self.assertEqual(evidence['contractSha256'], contract)
        self.assertEqual(evidence['packetSha256'], args['packet_sha256'])

        with self.assertRaisesRegex(ValueError, 'contract differs'):
            observer.measure(psql, socket, **(args | dict(expected_contract='f' * 64)))

        def fixture_ddl(statement):
            environment = dict(PATH='/usr/bin:/bin', PGHOST=str(socket), PGPORT='5432',
                               PGDATABASE='zimage_observer_fixture')
            subprocess.run([str(psql), '-Xqw', '-v', 'ON_ERROR_STOP=1', '-c', statement], check=True, env=environment)

        fixture_ddl('GRANT pg_write_all_data TO zimage_release_observer')
        try:
            with self.assertRaisesRegex(ValueError, 'unprivileged read-only DB session required'):
                observer.measure(psql, socket, **args)
        finally:
            fixture_ddl('REVOKE pg_write_all_data FROM zimage_release_observer')

        fixture_ddl('GRANT UPDATE (name) ON supabase_migrations.schema_migrations TO zimage_release_observer')
        try:
            with self.assertRaisesRegex(ValueError, 'unprivileged read-only DB session required'):
                observer.measure(psql, socket, **args)
        finally:
            fixture_ddl('REVOKE UPDATE (name) ON supabase_migrations.schema_migrations FROM zimage_release_observer')

        fixture_ddl('CREATE TABLE private.chat_usage_settings (fixture integer)')
        with self.assertRaisesRegex(ValueError, 'requires M6 absent'):
            observer.measure(psql, socket, **args)


if __name__ == '__main__':
    unittest.main()
