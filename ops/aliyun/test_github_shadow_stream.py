import io
import unittest

from github_shadow_wire import HEADER, LIMITS, MAGIC, parse, read_packet


class ShortReads(io.BytesIO):
    def read(self, n):
        if n <= 0:
            raise AssertionError('unsafe read')
        return super().read(min(n, 2))


class HeaderOnly(ShortReads):
    def read(self, n):
        if self.tell() >= HEADER.size:
            raise AssertionError('body read after invalid header')
        return super().read(n)


class Tests(unittest.TestCase):
    def test_short_reads_and_exact_wire_identity(self):
        packet = HEADER.pack(MAGIC, 1, 1, 1, 1) + b'abcd'
        self.assertEqual(parse(read_packet(ShortReads(packet))), (b'a', b'b', b'c', b'd'))

    def test_trailing_and_truncated_data_rejected(self):
        packet = HEADER.pack(MAGIC, 1, 1, 1, 1) + b'abcd'
        for malformed in (packet[:1], packet[:-1], packet + b'x'):
            with self.assertRaises(ValueError):
                read_packet(ShortReads(malformed))

    def test_reject_header_before_reading_any_body(self):
        for header in (HEADER.pack(MAGIC, LIMITS[0] + 1, 1, 1, 1),
                       HEADER.pack(MAGIC, 0, 1, 1, 1)):
            with self.assertRaises(ValueError):
                read_packet(HeaderOnly(header))
