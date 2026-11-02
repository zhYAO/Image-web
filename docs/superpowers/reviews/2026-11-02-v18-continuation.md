# ZImage v18 implementation handoff

The approved presentation is integrated in the existing React/Vite frontend and shared `apps/web/features` components. Refer to [the QA matrix](2026-11-02-v18-qa-fix-matrix.md) for observed Terra acceptance, exact full/targeted test counts and remaining environment/business boundaries. [Project progress](../../../doc/project-progress.md) is the delivery-status source of truth.

## Preserved architecture

- One workspace/session store and owner-scoped gateway callbacks; independent chat/image drafts and shared image-reference ownership.
- Account navigation reuses the existing workspace sidebar through a presentation-only owner-scoped bridge. Direct account visits warm that same workspace instance without remounting public forms.
- Real HTTP auth, credits, uploads, task recovery, downloads and exports remain in place. No reference mock store, demo phone authentication or production fixture is added.
- Apparel compact sizing applies only to example previews; real task results retain their version/history/download controls. Business notes remain available through a native disclosure.

## Further verification

Use the established Node/pnpm versions and repository commands for lint, typecheck, tests, acceptance budget and builds. The CI production-adapter build uses `next build --webpack`; frontend builds require the existing explicit compatibility descriptor and namespace. Keep source/resource guards enabled.

The five baseline Windows symlink setup failures must be exercised on a supported host before claiming their security assertions pass. Real service/payment/provider acceptance needs an authorized environment and scope. Local preview processes, fixture files and machine-specific commands are intentionally outside this repository. No merge or deployment is part of this change.
