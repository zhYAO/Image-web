"""Produce an M5 contract measurement in a separate read-only PostgreSQL session.

The caller owns the reviewed connection policy, batch, and expected contract.
The measurement format is distinct from the installed receiver's authorization.
"""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


PROJECT = 'klmiycyesxnpinxpeqep'
QUERY = (Path(__file__).resolve().parents[2] / 'doc/separation/20261106-paired-preflight/before-snapshot.sql')
QUERY_SHA256 = '09d2e7e36376569768d0b8d1005bb7cc3ed0e45748c625abd66884bb1b6509f5'
ROLE = 'zimage_release_observer'
DIGEST = re.compile('[0-9a-f]{64}')
OPERATION = re.compile(r'zimage-release-[1-9][0-9]{0,18}-[1-9][0-9]{0,18}')
COMMON = dict(PATH='/usr/bin:/bin', LANG='C', PGCONNECT_TIMEOUT='5', PGCLIENTENCODING='UTF8',
              PGUSER=ROLE, PGOPTIONS='-c default_transaction_read_only=on')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(value):
    text = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n'
    return hashlib.sha256(text.encode()).hexdigest()


def script():
    sql = QUERY.read_bytes().replace(b'\r\n', b'\n')
    require(hashlib.sha256(sql).hexdigest() == QUERY_SHA256, 'Reviewed DB query digest differs')
    body = sql.rstrip().removesuffix(b';')
    return (b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            b"SET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '1s';\n"
            b"SET LOCAL search_path = pg_catalog;\n"
            b"SELECT jsonb_build_object('role', current_user, 'sessionRole', session_user, "
            b"'readOnly', current_setting('transaction_read_only') = 'on', "
            b"'repeatableRead', current_setting('transaction_isolation') = 'repeatable read', "
            b"'privileged', EXISTS (SELECT FROM pg_roles WHERE pg_has_role(oid, 'MEMBER') AND "
            b"(rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls "
            b"OR rolname IN ('service_role', 'supabase_admin', 'pg_write_all_data'))) "
            b"OR EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('public', 'private', 'supabase_migrations') "
            b"AND has_schema_privilege(oid, 'CREATE')) "
            b"OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid "
            b"WHERE n.nspname IN ('public', 'private', 'supabase_migrations') AND c.relkind IN ('r','p','v','m','f') "
            b"AND (has_table_privilege(c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') "
            b"OR has_any_column_privilege(c.oid, 'INSERT,UPDATE'))), "
            b"'snapshot', measured.snapshot) FROM (\n" + body + b"\n) AS measured;\nROLLBACK;\n")


def parse_unique(pairs):
    value = dict(pairs)
    require(len(pairs) == len(value), 'Duplicate DB observation field')
    return value


def measure(psql, connection, *, mode, operation, packet_sha256, expected_contract, clock=time.time):
    require(mode in ('fixture', 'supabase') and type(operation) is str and OPERATION.fullmatch(operation)
            and all(type(value) is str and DIGEST.fullmatch(value) for value in (packet_sha256, expected_contract)),
            'Exact independent DB observation policy required')
    require(psql.is_absolute() and psql.is_file(), 'Locally trusted psql path required')
    if mode == 'supabase':
        passfile, rootcert = connection
        require(all(path.is_absolute() and path.is_file() for path in (passfile, rootcert))
                and passfile.stat().st_mode & 0o077 == 0, 'Locally provisioned DB observer files required')
        env = dict(PGHOST='db.' + PROJECT + '.supabase.co', PGPORT='5432', PGDATABASE='postgres',
                   PGSSLMODE='verify-full', PGPASSFILE=str(passfile), PGSSLROOTCERT=str(rootcert),
                   PGGSSENCMODE='disable')
    else:
        require(connection.is_absolute() and connection.is_dir(), 'Private test database socket required')
        env = dict(PGHOST=str(connection), PGPORT='5432', PGDATABASE='zimage_observer_fixture', PGPASSFILE='/dev/null')
    argv = [str(psql), '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1']
    try:
        result = subprocess.run(argv, input=script(), capture_output=True, env=COMMON | env, timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('Read-only database observer could not query the pinned session') from None
    require(result.returncode == 0 and 0 < len(result.stdout) <= 1_048_576,
            'Read-only database observer query refused')
    observed = json.loads(result.stdout, object_pairs_hook=parse_unique)
    require(type(observed) is dict and set(observed) == {'role', 'sessionRole', 'readOnly', 'repeatableRead',
                                                        'privileged', 'snapshot'}
            and observed['role'] == observed['sessionRole'] == ROLE and observed['readOnly'] is True
            and observed['repeatableRead'] is True and observed['privileged'] is False,
            'Independent unprivileged read-only DB session required')
    snapshot = observed['snapshot']
    require(type(snapshot) is dict and set(snapshot) == {'checkedAt', 'm6Present', 'vector'}
            and snapshot['m6Present'] is False, 'The reviewed M5 contract requires M6 absent')
    vector = snapshot['vector']
    require(type(vector) is dict and set(vector) == {'schemaVersion', 'projectRef', 'objects', 'migrations',
                                                     'pricing', 'supplement', 'chatUsageConfiguration'}
            and type(vector['schemaVersion']) is int and vector['schemaVersion'] == 2
            and vector['projectRef'] == PROJECT and sha(vector) == expected_contract,
            'Observed database contract differs from independent policy')
    timestamp = datetime.fromisoformat(snapshot['checkedAt'])
    require(timestamp.tzinfo is not None and 0 <= clock() - timestamp.timestamp() <= 30,
            'Database observation timestamp is stale or invalid')
    return dict(schemaVersion=1, kind='zimage-ordinary-db-observation-v1', mode=mode,
                operationId=operation, packetSha256=packet_sha256, contractSha256=expected_contract,
                querySha256=QUERY_SHA256, observedAt=int(timestamp.timestamp()), role=ROLE, readOnly=True)
