# Five-million-byte code delivery feasibility: current QA only

Baseline: `18ffbd3e0682f62d5448de3ed65ef6d6b13ae097`, using the retained
Next16.4.1/Sharp0.35.5 QA build. **No rebuild, dependency installation, application
change, further code-layer migration, upload, CI or production operation.**
Default gzip10MB packaging and its artifacts remain unchanged and available.

## Result and precise boundary

Lossless XZ9 compressed the exact existing code tar to **3,799,552bytes**.
A local proposed-format delivery of that archive, its198,429-byte code index and
2358-byte release manifest is **4,000,339bytes (3.815021MiB)**, below the decimal
5,000,000-byte target. These three files were materialized and their combined
size checked. The candidate is explicitly QA/non-production and schema2.

**This is a codec/format prototype, not an enabled production deployment.**
Current `release-layers.py` intentionally rejects schema2; refusal was verified
without publishing a destination. Production `release.py` accepts gzip only.
Do not rename XZ to `.tgz` or send this candidate to the existing deployment path.

All server code, generated client JS/CSS, error reporting, validation, languages
and themes are retained. The original code tar is46,172,160bytes and SHA256
`092a26d969588caf1d33b3a597fb20fd39a74b7fca7f8ec19bac921892a28ebe`.
Every tested codec decoded to this exact byte count/hash. The gzip9 control also
reproduced the existing archive SHA256 byte-for-byte. No runtime feature was
removed or moved out of the code layer.

## Measurements on this machine

Each encode and streaming decode used a separate process. Peak RSS includes the
runtime/input buffering; time includes local file IO. These are local codec
microbenchmarks, not target-server extraction/startup measurements.

| Codec | Archive bytes | With existing metadata bytes | Encode seconds | Encode peak MiB | Decode seconds | Decode peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gzip9 control | 9,776,761 | 9,977,498 | 2.073 | 72.55 | 0.178 | 12.73 |
| XZ6 | 5,743,352 | 5,944,089 | 13.802 | 157.74 | 0.305 | 21.06 |
| XZ9 | 3,799,552 | 4,000,289 | 14.428 | 521.71 | 0.194 | 56.18 |
| Brotli11, window24 | 4,991,971 | 5,192,708 | 58.401 | 276.55 | 0.234 | 64.68 |
| Zstd22, window26 | 4,070,132 | 4,270,869 | 17.244 | 763.75 | 0.244 | 92.09 |

The comparison column keeps baseline metadata size fixed. The actual XZ schema2
candidate adds50bytes of encoding metadata and totals4,000,339bytes. Brotli's
bare archive is below5MB but its delivery including metadata is **over budget**.
XZ9 is smaller and cheaper here than Zstd22 and uses the existing Python `lzma`
module; no new software was installed. Brotli/Zstd tests used existing Node24
built-ins. Existing XZ/Zstd tools were inspected, not installed.

XZ9 uses a64MiB LZMA2 dictionary and CRC64. XZ reports67,175,064bytes decoder
memory requirement. A bounded Python decoder **refused at32MiB** and passed at
96MiB, producing the same tar hash. Encoding costs about12.4 additional CPU
seconds and449MiB more peak RSS than gzip9 in this microbenchmark. Keep that
work on the build host; target memory/latency must be verified independently.

## Bundle and duplication findings

The code index has1118 files;931 JS files were parsed without execution using
the already installed Babel parser. Largest individual contributions include:

| Path relative to apps/web/.next | Raw bytes | Individual gzip9 bytes |
| --- | ---: | ---: |
| server/chunks/1389.js | 4,254,063 | 1,090,205 |
| server/instrumentation.js | 1,590,291 | 456,466 |
| server/chunks/9060.js | 1,572,098 | 446,674 |
| static/chunks/ffb8519d.76d33eeb420d1ef3.js | 1,449,789 | 428,508 |
| static/chunks/4479.e28ee792bcc79afc.js | 1,173,141 | 343,472 |

Do not add individual gzip sizes as if they were the whole-archive size.
Exact file hashes found44 redundant copies:1,139,340 raw bytes, only104,079bytes
as independent redundant gzip streams. Whole-file dedup alone does not explain
or deliver the required roughly5MB reduction.

AST extraction found260 distinct grammar JSON payloads across708 occurrences,
with9,020,319 repeated decoded-data bytes;65 distinct theme JSON payloads occur
twice each, with1,323,272 repeated decoded-data bytes. These are data payload
counts, not removable module byte totals. For example, the same788,819-byte
Emacs Lisp grammar exists in server6163.js and a client17bb598f chunk, wrapped
with different module IDs/debug metadata. Larger compression dictionaries can
reuse such data without deleting either runtime path.

`AssistantMessageContent.tsx` enables arbitrary Markdown code highlighting;
Lobe's hook loads Shiki by the matched language and defaults to its custom
`lobe-theme`. The app does not explicitly select the other bundled themes, so
narrower theme imports are a possible later optimization. Arbitrary languages,
fallbacks, module dispatch and streaming behavior still need preservation.
No language/theme pruning, server aliasing or import rewrite was attempted;
they are unnecessary for the demonstrated5MB compression result.

## First installation and minimal adoption plan

Other required layers remain unchanged at60,084,135bytes. With the proposed XZ
code delivery, **first required download is64,084,474bytes (61.115717MiB)**.
The retained debug archive adds11,232,847bytes if transferred:75,317,321bytes in
total. Resource/dependency changes still require their complete changed layers.
Browser transfer and assembled disk usage are unchanged. This is different from
moving client JS/CSS into another reusable layer; no such move occurred.

The smallest next implementation would add an **opt-in XZ code codec** to the
local packer/assembler while keeping gzip as default. Bind encoding, dictionary,
archive hash and index identity; cap decoder memory; refuse missing codec support
before extraction; retain all integrity, no-overwrite and rollback checks. Then
round-trip a fresh assembled directory and run the existing real runtime probes.
Target Python `lzma` is optional and must be checked without installing software
or changing production permissions. Transport/helper adoption remains separate
from this local experiment. The already verified10MB version is the fallback.

No new runtime startup was claimed: this study proves decoded bytes equal the
previously tested QA code. It does not validate an XZ-enabled deployment helper,
target host, real production settings/authentication or online Sentry symbolication.

Machine-readable measurements: [results](2026-10-26-release-code-5mb-results.json).
Candidate code XZ SHA256:
`614f1f3d2398d938d78888e2acd42defdc48ce50c27446ff6c834a59d13677eb`.
Candidate manifest SHA256:
`32cc216aabc3316b779a96fc25731bfb477398c8b16456c0cb61cdfbe9ef31d7`.

For the core lossless reproduction, decode the code gzip to a tar, encode with
`lzma.compress(tar, format=lzma.FORMAT_XZ, preset=9, check=lzma.CHECK_CRC64)`,
then compare `sha256(lzma.decompress(encoded))` with the original tar hash. Budget
the new index/manifest as well as the encoded archive; never use bare size alone.
