# Strict portable file identity

D1M Python 3.14 exposes creation time through path `lstat().st_ctime_ns`
and a different change timestamp through descriptor `fstat().st_ctime_ns`.
On the 47-file b8a8fd9 formal external-image dist, all 47 cross-API ctimes
differed, while device/file ID and birth time matched, and descriptor
signatures did not change during the read. This is local evidence, not a
claim that every Python/Windows combination has this behavior.

The reader compares common Windows device/file identity, size, modification
time and birth time across the two APIs. It still compares each API's full
original signature, including ctime, independently before/after reading.
Python versions without birth time keep the original strict comparison.
Missing file identity fails closed. POSIX comparisons retain ctime.

Windows opens the final entry using `CreateFileW(OPEN_EXISTING,
FILE_FLAG_OPEN_REPARSE_POINT)` with read access and only `FILE_SHARE_READ`.
It rejects reparse attributes, nonregular files and multiple hard links on
both path and handle, and checks ancestors and the path again after reading.
Concurrent ordinary data writes and replacement/deletion are denied while
the handle is open. Metadata changes remain subject to the descriptor ctime
check; sharing flags alone do not block attribute access. This is not a
claim of a general hostile-filesystem sandbox or that pre-existing writable
memory mappings are made safe by file sharing flags.

The same guarded reader now covers bounded reads, streaming hashes and archive
input. Archive path, header, member type, expansion, duplicate, byte budget,
manifest/digest and authorization rules are unchanged. No timestamps are
patched in the image contract tests anymore.

Local validation:

- Real baseline dist: unmodified subject-only CLI with this reader passes;
  its source identity remains the actual b8a8fd9 build and acceptance is still
  required. The public configuration used was explicitly synthetic QA config.
- Eight focused identity tests: seven pass, real symlink creation test skips
  under current OS policy. Reparse attribute cases are tested synthetically;
  no OS setting is changed to enable symlink creation.
- Six real local synthetic legacy/new pack/unpack/verify tests pass without
  the former signature adapter. These do not supply production acceptance.
- Linux release tests require `fcntl`, unavailable on Windows. Actual POSIX
  filesystem, Linux activation and older Python runtimes remain unverified.

This patch does not authorize or claim a production package: real backend
functional acceptance and exact build/source/options bindings are still
required. It does not change app/runtime dependencies or deployment helpers.

References:

- [Python os.stat documentation](https://docs.python.org/3.14/library/os.html#os.stat):
  Windows ctime deprecation, birth time and reparse metadata.
- [Microsoft CreateFileW documentation](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew):
  no-follow reparse handling and read/write/delete sharing semantics.
