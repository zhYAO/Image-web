# Local external-image preview

With ZIMAGE_PUBLIC_IMAGE_BASE_URL unset, builds still bundle the 62 reviewed public examples. No production URL
has been verified or enabled by this change. Next and Vite now share the exact
public-example path policy; uploads, unknown paths and query-bearing URLs are
never rewritten.

For a local-only comparison, explicitly set `ZIMAGE_IMAGE_DELIVERY=external-preview`
and `ZIMAGE_PUBLIC_IMAGE_BASE_URL=https://assets.zimage.test/static-assets/<sha>`.
`<sha>` must be SHA256 of the canonical LF `ops/aliyun/public-images.json` bytes used by
the image-only migration tool. The `.test` host is reserved test input, not a
working server claim. The only other accepted origin is the user's
`https://www.zimage.store`, and it remains an unverified preview input here.

The build checks that all 62 source files match the pinned size and SHA256 before
omitting their local copies. Six license notices remain in the artifact. The
browser and SSR bundles use the same literal and dynamic URL policy.

Preview output has `.release/external-images.json` with `productionVerified:false`.
It is intentionally rejected by the existing formal release payload validator;
this change does not add remote assets to the production acceptance protocol or
weaken it. Do not remove that marker to publish the output. Production needs
independent 62-image HTTPS/MIME/byte verification and a separately reviewed
external-resource acceptance contract. Existing server routing, immutable image
versions, full resource schema, font/rollback checks and release jobs are unchanged.

## One shared configuration

Normal builds use only ZIMAGE_PUBLIC_IMAGE_BASE_URL for both Vite and Next.
Vite derives its internal constant; Next inlines the same public input at build time.
Changing it requires rebuilding BOTH applications. Changing an ECS runtime environment
variable alone cannot change compiled static files. No second public URL is needed.
Normal configured builds require actual per-image HTTPS acceptance before output.
The explicit offline preview is separate and remains formally nonpublishable.
The Python frontend manifest and Next full-resource contract still reject this
image-only namespace: coordinated formal acceptance remains pending.
