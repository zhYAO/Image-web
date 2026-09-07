# Next App Router
All pages use apps/web/app/layout.tsx. / is the only workspace. /chat and /image redirect. /skills publicly lists official skills; /skills/[id] provides detail. Login, verification, recovery, account and legal pages are standalone.
- /account → `apps/web/app/account/page.tsx`
- /auth → `apps/web/app/auth/page.tsx`
- /auth/reset → `apps/web/app/auth/reset/page.tsx`
- /auth/verify → `apps/web/app/auth/verify/page.tsx`
- /chat → `apps/web/app/chat/page.tsx`
- /image → `apps/web/app/image/page.tsx`
- /login → `apps/web/app/login/page.tsx`
- / → `apps/web/app/page.tsx`
- /privacy → `apps/web/app/privacy/page.tsx`
- /skills/[id] → `apps/web/app/skills/[id]/page.tsx`
- /skills → `apps/web/app/skills/page.tsx`
- /terms → `apps/web/app/terms/page.tsx`
