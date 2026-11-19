# Public image migration preparation

This local preparation contains 62 explicitly reviewed JPEG/WebP images
(8,067,881 source bytes). public-images.json pins every path, byte length, MIME
type and SHA-256. Four prohibited source PNGs, their provenance JSON, fonts,
licenses for UI code, environment files, application source and private/user
uploads are excluded from the image archive. UI licenses remain in the existing
application release. No PWA manifest, robots or other protocol file is moved.

Run the local public-images.py with --output pointing to a new directory outside
the checkout. It validates the pinned source closure and creates an image-only
public-images.tgz, a separate reviewed manifest and migration report. Every archive
entry is below static-assets/<manifest-sha256>/commerce/. The version is the hash
of the exact reviewed manifest bytes. Output creation is exclusive and does not
replace an existing directory. Repeated packing produces identical archive bytes.

The prepared local version is
6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24.
The deterministic archive is 8,038,978 bytes, SHA-256
2913548971cd66b28d31f4a563c8206df985dd309b7377fe9372f48f2e06033b.
This is a migration preparation format, separate from the application's existing
font-bearing resource schema. The privileged release installer will not accept it
as an application resource manifest.

## Server prerequisites and version activation

The existing source templates use /static-assets/<sha256>/ URLs and exact HTTPS
site origins. The actual ECS alias target, directory owner, service UID and
currently installed route have not been read in this task. The template's /srv
path is an example and must not be treated as the live destination.

A future authorized server step must first read the installed site contract and
identify an existing or approved image-only root. Verify the manifest and archive
SHA before extraction, validate every member against the 62-entry allowlist, and
stage into a fresh directory. Reject links, extra entries and existing version
destinations. Verify all extracted lengths, hashes and web-service read access
before making that new version visible. Keep all old resource versions and
current/previous releases. Public GET checks must establish exact bytes, JPEG/
WebP MIME, nosniff, immutable caching for successful responses, and safe 404s.

The current publicAssetUrl helper already rewrites reviewed public commerce URLs
when a validated static base is supplied. Its Next remote patterns are scoped
to commerce paths. No new remote URL, fetcher or SSRF surface is introduced here.
The final HTTPS base must be confirmed on the same ECS site before code/build
configuration activates it. Current schema 2 requires same-origin-public with a
null compiled remote base and a resource link, so setting a remote base alone
does not complete a compatible release. That source/installer contract needs an
explicit coordinated change and regression proof first.

The independent frontend has its own /frontend-assets/<source-namespace> closure
and packaging checks. Moving those images also needs its versioned manifest and
resource checker to bind the confirmed image namespace. They remain enforced.

## Font inventory and blocking contract

There are no tracked OTF/TTF/WOFF/WOFF2 files and no next/font or @font-face use
in the current web entry. The body already uses system font families. Inline SVG
filter fragment URLs are UI effects, not external image/font downloads.

The candidate CI and manual quality job still provision two audited Noto OTFs.
package-static-assets.mjs, three-layer-release.py and the Sharp apparel resolver
require both exact OTFs plus license/provenance. The installed schema does not
allow an empty font set, and the Sharp renderer deliberately rejects missing or
unverified fonts. Removing CI provisioning by itself makes packaging fail.

Completing font-free daily releases therefore needs a reviewed font-free asset
contract and companion installer support while retaining old schema acceptance
for existing releases. The ECS system-font inventory, root ownership, permissions,
font identity and glyph coverage for actual Chinese text have not been measured.
A future system-font path must be verified locally on that host and validate
coverage before rendering. Missing glyphs must fail before publishing an image.
Font installation or downloading is outside this local preparation. This commit
does not claim that font provisioning has been removed or that Sharp fallback is
ready. Existing license/provenance and rollback resources remain available.

## Current transport behavior

ci.yml still creates and uploads a complete transport bundle. release-transport.py
already provides a bounded inventory request, rehashes cached objects and plans
upload/reuse by exact length and SHA. Inventory is advisory, and release JSON is
always uploaded. This task does not change that pipeline or its helpers.
