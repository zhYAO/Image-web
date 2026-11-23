"""Exchange one ordinary release challenge and a redacted receipt over mutual TLS."""
from functools import partial
import hashlib
import hmac
import ipaddress
import json
import re
import socket
import ssl
import struct
import time


HEADER = struct.Struct('!I')
CHALLENGE_LIMIT = 4096
RESPONSE_LIMIT = 8192
PEER = re.compile('[a-f0-9]{64}')
HOST = re.compile(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?')
CHALLENGE = 'zimage-ordinary-readonly-challenge-v1'
RESPONSE = 'zimage-ordinary-candidate-v1'
SERVER_TIMEOUT = 110


def exact(value, keys):
    if type(value) is not dict or set(value) != keys:
        raise ValueError('Exact observer transport record required')


def endpoint(address, port):
    if type(address) is not str or '%' in address or type(port) is not int or not 0 < port <= 65535:
        raise ValueError('Observer requires an exact IP address and TCP port')
    ip = ipaddress.ip_address(address)
    if ip.is_unspecified or ip.is_multicast:
        raise ValueError('Observer transport requires a single unicast endpoint')
    return str(ip), port


def fingerprint(value):
    if type(value) is not str or not PEER.fullmatch(value):
        raise ValueError('Exact observer certificate fingerprint required')
    return value


def tls_context(ca, cert, key, *, server):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER if server else ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(cafile=str(ca))
    context.load_cert_chain(certfile=str(cert), keyfile=str(key), password='')
    return context


def timeout(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Observer exchange expired')
    return remaining


def authenticate(connection, expected):
    certificate = connection.getpeercert(binary_form=True)
    if not certificate or not hmac.compare_digest(hashlib.sha256(certificate).hexdigest(), expected):
        raise ValueError('Observer peer certificate differs from installed pin')


def read_exact(connection, size, deadline):
    body = bytearray()
    while len(body) < size:
        connection.settimeout(timeout(deadline))
        chunk = connection.recv(size - len(body))
        if not chunk:
            raise ValueError('Truncated observer exchange')
        body.extend(chunk)
    return bytes(body)


def read_frame(connection, limit, deadline):
    size, = HEADER.unpack(read_exact(connection, HEADER.size, deadline))
    if not 0 < size <= limit:
        raise ValueError('Observer frame exceeds bound')

    def pairs(items):
        value = dict(items)
        if len(value) != len(items):
            raise ValueError('Duplicate observer frame fields')
        return value

    def invalid(_):
        raise ValueError('Invalid observer frame number')

    return json.loads(read_exact(connection, size, deadline), object_pairs_hook=pairs, parse_constant=invalid)


def write_frame(connection, value, limit, deadline):
    body = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    if not 0 < len(body) <= limit:
        raise ValueError('Observer frame exceeds bound')
    connection.settimeout(timeout(deadline))
    connection.sendall(HEADER.pack(len(body)) + body)


def client(policy, *, ca, cert, key):
    exact(policy, {'schemaVersion', 'address', 'port', 'serverName', 'peerSha256'})
    if (type(policy['schemaVersion']) is not int or policy['schemaVersion'] != 1
            or type(policy['serverName']) is not str or not HOST.fullmatch(policy['serverName'])):
        raise ValueError('Invalid installed observer endpoint policy')
    peer = fingerprint(policy['peerSha256'])
    address = endpoint(policy['address'], policy['port'])
    return partial(exchange, address=address, server_name=policy['serverName'], peer=peer,
                   context=tls_context(ca, cert, key, server=False))


def exchange(challenge, *, deadline, address, server_name, peer, context):
    with socket.create_connection(address, timeout=timeout(deadline)) as raw:
        raw.settimeout(timeout(deadline))
        with context.wrap_socket(raw, server_hostname=server_name) as connection:
            authenticate(connection, peer)
            write_frame(connection, challenge, CHALLENGE_LIMIT, deadline)
            response = read_frame(connection, RESPONSE_LIMIT, deadline)
    if type(response) is not dict or response.get('kind') != RESPONSE:
        raise ValueError('Independent observer did not return a read-only receipt')
    return response


def serve_one(raw, *, context, peer, verify, deadline):
    """Serve one caller. Only the pinned release peer may invoke the verifier."""
    raw.settimeout(timeout(deadline))
    with context.wrap_socket(raw, server_side=True) as connection:
        authenticate(connection, peer)
        challenge = read_frame(connection, CHALLENGE_LIMIT, deadline)
        if type(challenge) is not dict or challenge.get('kind') != CHALLENGE:
            raise ValueError('Only ordinary read-only release challenges are supported')
        response = verify(challenge)
        if type(response) is not dict or response.get('kind') != RESPONSE:
            raise ValueError('Observer verifier returned no receipt')
        write_frame(connection, response, RESPONSE_LIMIT, deadline)


def listen(policy, *, ca, cert, key, verify):
    exact(policy, {'schemaVersion', 'bindAddress', 'port', 'peerSha256'})
    if type(policy['schemaVersion']) is not int or policy['schemaVersion'] != 1:
        raise ValueError('Invalid independent observer listener policy')
    address = endpoint(policy['bindAddress'], policy['port'])
    peer = fingerprint(policy['peerSha256'])
    context = tls_context(ca, cert, key, server=True)
    family = socket.AF_INET6 if ipaddress.ip_address(address[0]).version == 6 else socket.AF_INET
    with socket.socket(family) as listener:
        listener.bind(address)
        listener.listen(2)
        while True:
            raw, _ = listener.accept()
            with raw:
                try:
                    serve_one(raw, context=context, peer=peer, verify=verify, deadline=time.monotonic() + SERVER_TIMEOUT)
                except (OSError, ValueError, TypeError, KeyError, RuntimeError):
                    # No cookies, request bodies or upstream errors go back to the caller.
                    continue
