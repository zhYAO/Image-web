# Complete local dependency trees

## account
- `apps/web/app/account/page.tsx`
  - `apps/web/features/account/AccountPanel.tsx`
    - `packages/domain/src/auth-contracts.ts`
  - `apps/web/lib/supabase/server.ts`
    - `apps/web/lib/supabase/database.generated.ts`
    - `apps/web/lib/supabase/env.ts`
  - `apps/web/server/auth/account-service.ts`
    - `apps/web/server/api-error.ts`
      - `packages/domain/src/index.ts`
        - `packages/domain/src/api-contracts.ts`
          - `packages/domain/src/skill-contracts.ts`
        - `packages/domain/src/gateway.ts`
          - `packages/domain/src/types.ts`
        - `packages/domain/src/logic.ts`
        - `packages/domain/src/model-registry.ts`
          - `packages/domain/src/official-skills.ts`
    - `apps/web/server/route-context.ts`
      - `apps/web/server/observability.ts`

## auth
- `apps/web/app/auth/page.tsx`
  - `apps/web/features/auth/AuthPanel.tsx`
    - `apps/web/features/auth/feedback.ts`
    - `apps/web/features/auth/return-to.ts`
    - `apps/web/features/auth/use-auth-captcha.tsx`

## auth/reset
- `apps/web/app/auth/reset/page.tsx`
  - `apps/web/features/auth/ResetPasswordPanel.tsx`
    - `apps/web/features/auth/feedback.ts`

## auth/verify
- `apps/web/app/auth/verify/page.tsx`
  - `apps/web/features/auth/VerifyPanel.tsx`
    - `apps/web/features/auth/feedback.ts`
    - `apps/web/features/auth/return-to.ts`
    - `apps/web/features/auth/use-auth-captcha.tsx`

## login
- `apps/web/app/login/page.tsx`
  - `apps/web/app/auth/page.tsx`
    - `apps/web/features/auth/AuthPanel.tsx`
      - `apps/web/features/auth/feedback.ts`
      - `apps/web/features/auth/return-to.ts`
      - `apps/web/features/auth/use-auth-captcha.tsx`

## .
- `apps/web/app/page.tsx`
  - `apps/web/app/client-workspace.tsx`
    - `apps/web/app/anonymous-auth-gate.tsx`
      - `apps/web/lib/supabase/client.ts`
        - `apps/web/lib/supabase/database.generated.ts`
        - `apps/web/lib/supabase/env.ts`
      - `apps/web/gateways/http-workspace-gateway.ts`
        - `packages/domain/src/index.ts`
          - `packages/domain/src/api-contracts.ts`
            - `packages/domain/src/skill-contracts.ts`
          - `packages/domain/src/gateway.ts`
            - `packages/domain/src/types.ts`
          - `packages/domain/src/logic.ts`
          - `packages/domain/src/model-registry.ts`
            - `packages/domain/src/official-skills.ts`
          - `packages/domain/src/auth-contracts.ts`
      - `apps/web/features/auth/return-to.ts`

## privacy
- `apps/web/app/privacy/page.tsx`

## skills/[id]
- `apps/web/app/skills/[id]/page.tsx`
  - `packages/domain/src/index.ts`
    - `packages/domain/src/api-contracts.ts`
      - `packages/domain/src/skill-contracts.ts`
    - `packages/domain/src/gateway.ts`
      - `packages/domain/src/types.ts`
    - `packages/domain/src/logic.ts`
    - `packages/domain/src/model-registry.ts`
      - `packages/domain/src/official-skills.ts`
    - `packages/domain/src/auth-contracts.ts`
  - `apps/web/app/skills/skills.module.css`

## skills
- `apps/web/app/skills/page.tsx`
  - `packages/domain/src/index.ts`
    - `packages/domain/src/api-contracts.ts`
      - `packages/domain/src/skill-contracts.ts`
    - `packages/domain/src/gateway.ts`
      - `packages/domain/src/types.ts`
    - `packages/domain/src/logic.ts`
    - `packages/domain/src/model-registry.ts`
      - `packages/domain/src/official-skills.ts`
    - `packages/domain/src/auth-contracts.ts`
  - `apps/web/app/skills/skills.module.css`

## terms
- `apps/web/app/terms/page.tsx`

## / dynamically imported workspace
- `apps/web/features/workspace/workspace.module.css`
- `apps/web/features/workspace/assistant-message-segments.ts`
- `apps/web/features/workspace/SessionSidebar.tsx`
- `apps/web/features/workspace/use-smart-auto-scroll.ts`
- `apps/web/features/workspace/WorkspaceApplication.tsx`
- `apps/web/features/workspace/UnifiedComposer.tsx`
- `apps/web/features/workspace/AssistantMessageContent.tsx`
- `apps/web/features/workspace/WorkspaceTimeline.tsx`
- `apps/web/features/workspace/GenerationConfig.tsx`
- `apps/web/features/workspace/UnifiedWorkspace.tsx`
- `apps/web/store/workspace-store.ts`
- `apps/web/app/providers.tsx`
- `apps/web/i18n/zh-CN.ts`
