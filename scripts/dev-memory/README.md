# Controlled development-memory reproduction

Run from a Linux checkout with the repository's Node version and installed web dependencies. Stop other Next development servers first. The runner refuses existing `next-server` or `next dev` processes and never restarts its own server.

```sh
node scripts/dev-memory/reproduce.mjs --output /tmp/zimage-memory-static
node scripts/dev-memory/reproduce.mjs --element render --output /tmp/zimage-memory-render
node --test scripts/dev-memory/reproduce.test.mjs
```

Each output directory must be new, absolute, outside this repository, and have an existing parent. Symlink aliases into the repository are rejected. The directory contains the fixture, server log, PID handshake, primitive samples, and `metrics.json`. Keep raw output out of Git; upload retained evidence to Library.

Defaults are `--bundler webpack --element static --cycles 3`; cycles are restricted to 1–4. A local vendor package creates one static React element at module initialization. The `render` control creates the same element inside its render function. Each edit changes visible page text, and the runner verifies the new text in the HTTP response before sampling.

Every sample follows at least 30 seconds of cooling, including 10 seconds with at most five process-group CPU ticks per poll (approximately two seconds). It then requests three full GCs, with event-loop turns between them. There are two additional cooling/GC samples after the last edit. A phase is limited to 120 seconds and the experiment to 10 minutes. Any owned process reaching 3 GiB RSS, or a readable cgroup reaching 8 GiB (or 80% of a lower cgroup limit), stops the experiment. Cleanup sends TERM then KILL to the runner's dedicated process group on normal completion, failure, timeout, budget breach, or catchable termination signals. SIGKILL or machine failure cannot run cleanup.

The probe uses `WeakRef` to count manifest contexts created by `vm.runInNewContext`. It opens no inspector and captures no heap snapshots. `retained` is a measured result, not a passing regression test. `--assert-collected` exits nonzero unless the final tracked generation count is at most one. `untracked` means no manifest contexts passed through this probe; it never counts as assertion success. These results address this development reproduction, not production memory safety, native allocation attribution, or browser HMR behavior.

`--bundler turbopack` is accepted, but the symlinked dependencies and output must share an ancestor narrower than `/`; use a sibling output such as `/workspace/zimage-memory-turbo` when the checkout is `/workspace/Image-web`. The runner does not traverse that ancestor itself and refuses filesystem-root resolution. Turbopack can report `untracked`. Its execution and Next integration require separate real-server verification; the automated tests here use fake processes only.

The worker handshake depends on Next 16.3 setting both `__NEXT_DEV_SERVER=1` and `NEXT_PRIVATE_WORKER=1` in `dist/cli/next-dev.js`. Upgrades should revalidate this boundary; a missing handshake or unavailable exposed GC fails closed.
