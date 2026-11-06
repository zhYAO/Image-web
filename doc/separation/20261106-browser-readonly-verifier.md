# Browser-native read-only verifier (2026-11-06)

The helper in `ops/aliyun/backend/browser-readonly-verifier.mjs` produces the existing `zimage-backend-readonly-v2` receipt on the signed-in `https://www.zimage.store` page. It neither obtains nor exports a credential. The browser attaches its normal same-origin credentials to fixed GET requests. No authenticated browser run, production acceptance, deployment, or service change was performed while implementing this helper.

## Review and generate the readable Sources Snippet

Use the existing Node 24 executable; no package installation is needed. Run from the repository root, substituting the exact public operation ID and approved candidate/recovery release SHA40 values. The allowed release list is fixed in the generated source, with at most eight distinct releases. There are no URLs in the configuration or challenge.

```sh
NODE24=/Users/zhaoyao/Documents/Codex/2026-10-27/task/toolchain/node_modules/node/bin/node
"$NODE24" ops/aliyun/backend/browser-readonly-verifier.mjs --snippet operation-1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,cccccccccccccccccccccccccccccccccccccccc > /tmp/zimage-browser-readonly-snippet.js
shasum -a 256 ops/aliyun/backend/browser-readonly-verifier.mjs /tmp/zimage-browser-readonly-snippet.js
```

Review the full module and generated source in a local text editor before execution. The generated file is readable JavaScript with the kernel embedded as a function; it has no import, dynamic code evaluation, network script loader, or dependency on a local HTTP/file URL. The module's CLI only emits public configuration and code. Do not open the generated file as a browser page.

## Chrome operator steps

1. In the existing normal Chrome profile, open `https://www.zimage.store` and sign into the existing account through the normal site UI. Keep this same top-level tab open. Do this before any checking-window admission seal. The helper does not sign in or refresh authentication.
2. Open DevTools, select **Sources → Snippets** (the pane may be under **More tabs**), choose **New snippet**, and name it `zimage-readonly-v2`. Insert only the reviewed generated source in this editor. Save with Command-S on macOS or Control-S on Windows/Linux. Select **Run** or press Command-Enter / Control-Enter to run it in the current page. Chrome documents both the page-context execution model and these controls in [Run snippets of JavaScript](https://developer.chrome.com/docs/devtools/javascript/snippets).
3. If Chrome blocks insertion with a self-XSS warning or modal, **stop**. Do not enter an override, alter DevTools settings or launch flags, manufacture console history, switch profiles, or route execution through another editor. Chrome's [self-XSS documentation](https://developer.chrome.com/blog/self-xss) confirms this protection also applies in the Sources editor. Whether the existing profile permits this reviewed snippet remains unverified. A warning is an execution blocker under this task's restrictions.
4. The in-page helper should show the exact operation ID and approved releases. Mounting performs no fetch. Keep this tab and helper loaded through candidate/recovery checks; it needs only the fixed same-origin GET routes after loading. It does not need localhost, file URLs, or additional static resources.
5. Obtain the public seven-field v2 challenge from the coordinator. Paste it into **Public request JSON**, or select only its small public JSON file using the helper's chooser, then click **Verify public request**. Do not select a credential file or paste browser/network state. Input is cleared when verification starts. A selected file is read locally into the same parser and is never uploaded.
6. On success, read/copy only the redacted receipt and the displayed **Receipt SHA-256**, or choose **Download redacted receipt**. The displayed SHA is over the exact UTF-8 download bytes: `JSON.stringify(receipt, null, 2) + LF`. The fixed filename is `backend-readonly-receipt.json`; Chrome may suffix duplicate downloads. Confirm the downloaded artifact with `shasum -a 256 ACTUAL_DOWNLOADED_FILENAME` and compare the result. Transfer only this receipt plus its digest through the existing authorized receipt path. Browser UI automation may enter the public challenge and read these redacted result controls; it must not inspect credential storage or private response bodies.
7. A subsequent candidate/recovery request may use another approved release and another pid. Each new nonce consumes one of eight attempts, including failed attempts. The same nonce and binding returns the cached result without another fetch; altered bindings for an existing nonce fail. Expired/future requests always fail, including cached results. A failed nonce stays failed. Do not reload/re-run the helper to evade the attempt or deadline bound. The mounted helper refuses a second mount on the same page.

The helper stops accepting requests twenty minutes after construction using the monotonic clock. It also clears the UI at that deadline. Request wall-clock lifetime is at most 120 seconds; expiry is checked around every fetch and before receipt creation. If the checking window, auth state, nonce window, browser protection, or helper deadline prevents completion, no receipt is generated. Ask the coordinator for a newly authorized round only within its allowed operation/window; do not change the fixed operation/release configuration ad hoc.

## Wire and privacy boundary

The exact request keys are `schemaVersion`, `operationId`, `backendRelease`, `pid`, `nonce`, `createdAt`, `expiresAt`. Request input is bounded to 4096 UTF-8 bytes; duplicate decoded JSON names, unknown fields, wrong wire types, unsafe pid/time values, wrong operation/release, and nonfinite/future/expired/unbounded timestamps fail before network activity. Request pids obey the receipt kernel's positive signed-32-bit range. Integral timestamp floats are normalized, then sorted compact JSON plus LF is SHA-256 hashed exactly as in `verify.py` and `receipt.py`, including Python's small-exponent formatting.

The only requests, in order, are:

- `GET /api/health/ready`
- `GET /api/meta`
- `GET /api/auth/session`
- `GET /api/account`
- `GET /api/sessions`
- `GET /api/credits/pricing`
- `GET /api/meta` (release drift recheck)

Every request fixes `credentials: same-origin`, `redirect: error`, `cache: no-store`, `mode: same-origin`, and `Accept: application/json`. Only the pricing GET carries `x-zimage-readonly-probe: catalog-v1`, and its response must echo that exact marker. Fetches have an AbortController deadline of at most twelve seconds, shortened by request/helper expiry. Every response is streamed through a 2,000,000-byte bound, strict UTF-8 and JSON parsing, and DTO validation. Metadata, ready release and API major, capabilities, matching verified-session/active-account identity, catalog token price optional fields, cache directives, and final full metadata are checked. JSON integer fields preserve the Python int/float wire distinction; duplicate response fields fail closed. Session timestamps use valid timezone-aware ISO calendar strings produced by the current wire DTO; unsupported alternative ISO spellings fail closed.

The receipt has the unchanged v2 schema and six ordered checks, plus `requestSha256`, `checkedAt`, `authenticatedReadOnly: true`, `independentPublic: true`, and `catalogReady: true`. Final metadata recheck adds no seventh receipt row. It includes no account ID, email, display name, session content, pricing bodies, headers, tokens, or cookie values. Failures use one fixed redacted message, clear stale UI output, and cannot download a prior receipt. No cookie, local/session storage, browser credential API, auth query parameter, or private response logging is used. Transient identity/body values remain local to verification and are discarded. Saved Snippet code contains only the public operation/release configuration; no challenge or result is persisted by the helper.

This receipt does not install itself, open writes, deploy, attest paid-model health, prove wallet/ledger availability, or replace privileged coordinator acceptance. Policy/journal bindings remain in the existing root-side context; adding fields to the v2 request is rejected.

## Offline validation

```sh
NODE24=/Users/zhaoyao/Documents/Codex/2026-10-27/task/toolchain/node_modules/node/bin/node
"$NODE24" --test ops/aliyun/backend/browser-readonly-verifier.test.mjs
python3 -B -m unittest discover -s ops/aliyun/backend -p 'test_*.py'
```

The Node tests use real Response streams, controlled fetch and DOM ports, and an isolated JavaScript VM for emitted source. They do not access the network, browser credentials, service state, or providers. They cover request/response parsing, exact GET options, SHA binding, malformed DTOs, marker/cache/identity/version drift, redacted errors/results, stream bounds/abort, nonce deduplication, eight rounds, monotonic deadline, public file input, download bytes, and snippet origin enforcement. Offline green tests do not establish that the existing Chrome profile will permit execution or that the live authenticated routes pass. Those remain explicitly unverified.
