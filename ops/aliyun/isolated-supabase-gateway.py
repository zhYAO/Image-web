#!/usr/bin/env python3
"""Diagnostic reverse gateway. Host supervisor only; no Docker, signing or production.
The supervisor must own the disposable upstream 127.0.0.1:54321 and firewall/
isolate the candidate first. This process is not a network sandbox.
"""
import argparse
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Address
import re
from pathlib import Path
import ssl
import stat
from urllib.parse import parse_qs, urlsplit

MAX = 256 * 1024
JWT_OR_LOCAL = re.compile(r'[A-Za-z0-9_.-]{1,8192}')
UUID = re.compile(r'eq\.[a-f0-9-]{36}')
ROUTES = {
    ('POST', '/auth/v1/token'): ('grant_type', {'password', 'refresh_token'}),
    ('POST', '/auth/v1/logout'): ('scope', {'local'}),
    ('GET', '/auth/v1/user'): None,
    ('GET', '/rest/v1/account_profiles'): 'profile',
    ('POST', '/rest/v1/rpc/require_verified_user_id'): None,
    ('POST', '/rest/v1/rpc/consume_auth_rate_limit'): None,
    ('POST', '/rest/v1/rpc/list_sessions_with_activity'): None,
}


def allowed(method, raw):
    if len(raw) > 1024 or not raw.startswith('/') or raw.startswith('//') or re.search(r'[\x00-\x20\x7f\\]', raw):
        return False
    url = urlsplit(raw)
    key = method, url.path
    if url.scheme or url.netloc or url.fragment or key not in ROUTES:
        return False
    rule = ROUTES[key]
    if rule is None:
        return not url.query
    try:
        params = parse_qs(url.query, strict_parsing=True, max_num_fields=4)
    except ValueError:
        return False
    if rule == 'profile':
        return (set(params) == {'select', 'user_id'} and params['select'] == ['display_name,status']
                and len(params['user_id']) == 1 and UUID.fullmatch(params['user_id'][0]) is not None)
    name, values = rule
    return set(params) == {name} and len(params[name]) == 1 and params[name][0] in values


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, candidate, *, mock_origin=False):
        self.candidate = candidate
        self.upstream_port = 55421 if mock_origin else 54321
        super().__init__(address, Handler)

    def handle_error(self, *_):
        pass  # Never dump candidate request or credential data.


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(4)
        if (context := getattr(self.server, 'tls', None)):
            connection = context.wrap_socket(self.connection, server_side=True, do_handshake_on_connect=False)
            connection.settimeout(4)
            try:
                connection.do_handshake()
            except OSError:
                connection.close()
                raise
            self._tls_connection = connection
            self.connection = self.request = connection
            self.rfile.close()
            self.wfile.close()
            super().setup()

    def finish(self):
        try:
            super().finish()
        finally:
            if connection := getattr(self, '_tls_connection', None):
                connection.close()

    def log_message(self, *_):
        pass

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def do_CONNECT(self):
        self.send_error(403)

    def forward(self):
        if (self.client_address[0] != self.server.candidate or not allowed(self.command, self.path)
                or self.headers.get_all('Transfer-Encoding') or self.headers.get_all('Upgrade')):
            self.send_error(403)
            return
        lengths = self.headers.get_all('Content-Length') or []
        if (len(lengths) > 1 or lengths and not re.fullmatch(r'[0-9]{1,6}', lengths[0])):
            self.send_error(400)
            return
        length = int(lengths[0]) if lengths else 0
        if length > MAX or (self.command == 'GET' and length):
            self.send_error(413)
            return
        headers = {'Accept-Encoding': 'identity'}
        for key in ('apikey', 'Authorization', 'Content-Type', 'Accept'):
            values = self.headers.get_all(key) or []
            if len(values) > 1 or any(len(v) > 8199 or not v.isascii() or re.search(r'[\x00-\x1f\x7f]', v) for v in values):
                self.send_error(400)
                return
            if values:
                headers[key] = values[0]
        for key in ('apikey', 'Authorization'):
            if key in headers and not JWT_OR_LOCAL.fullmatch(headers[key].removeprefix('Bearer ')):
                self.send_error(400)
                return
        upstream = HTTPConnection('127.0.0.1', self.server.upstream_port, timeout=5)
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError('partial request')
            upstream.request(self.command, self.path, body=body if length else None, headers=headers)
            response = upstream.getresponse()
            if 300 <= response.status < 400:
                raise ValueError('redirect refused')
            value = response.read(MAX + 1)
            if len(value) > MAX:
                raise ValueError('oversize')
            self.send_response(response.status)
            for name in ('Content-Type', 'Content-Range'):
                if (header := response.getheader(name)) and re.fullmatch(r'[\x20-\x7e]{1,1024}', header):
                    self.send_header(name, header)
            self.send_header('Content-Length', str(len(value)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(value)
        except (OSError, ValueError):
            self.close_connection = True
        finally:
            upstream.close()


def tls_context(certificate, key):
    info = key.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
        raise ValueError('Expected private TLS key')
    if not stat.S_ISREG(certificate.lstat().st_mode):
        raise ValueError('Expected regular TLS certificate')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certificate, key)
    return context


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--listen-ip', required=True, type=IPv4Address)
    p.add_argument('--candidate-ip', required=True, type=IPv4Address)
    p.add_argument('--certificate', type=Path)
    p.add_argument('--private-key', type=Path)
    p.add_argument('--netproof-mock-origin', action='store_true')
    args = p.parse_args()
    if args.netproof_mock_origin and not (args.listen_ip == IPv4Address('172.31.219.1') and
                                          args.candidate_ip == IPv4Address('172.31.219.2')):
        p.error('Mock upstream reserved for exact isolated proof bridge')
    private = re.compile(r'172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+')
    ip, peer = str(args.listen_ip), str(args.candidate_ip)
    if not (ip == peer == '127.0.0.1' or (ip != peer and private.fullmatch(ip) and private.fullmatch(peer))):
        p.error('expected exact loopback or separately provisioned private bridge endpoints')
    if bool(args.certificate) != bool(args.private_key) or (ip != '127.0.0.1' and not args.certificate):
        p.error('TLS certificate and key are required on a private bridge')
    with Server((ip, 8443), peer, mock_origin=args.netproof_mock_origin) as server:
        if args.certificate:
            # Set timeout before each TLS handshake; do not block in the accept loop.
            server.tls = tls_context(args.certificate, args.private_key)
        server.serve_forever()


if __name__ == '__main__':
    main()
