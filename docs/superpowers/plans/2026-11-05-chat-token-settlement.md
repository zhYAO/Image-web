# Chat token settlement — isolated candidate

User confirmed input/output token based charging and verified usage on voluntary stop; missing usage/outcome stays held. Images keep successful-count fixed prices.

- [ ] Immutable reviewed model tariffs (RMB nano precision, explicit cache rate/aliases, max input/output and markup); no production defaults.
- [ ] Per-model cap and tariff version in catalog/confirmation; freeze before call, reject changed version, preserve legacy operation replay.
- [ ] Service-only token operation snapshots and receipt; original funded ownership/history/claim protocol retained.
- [ ] Edge waits for usage after finish, records complete content before terminal signal; missing usage preserves content and holds, never retries supplier.
- [ ] Atomic partial capture/release at wallet precision only after summing all token components; over-cap and missing evidence hold.
- [ ] Early cancellation before attempt releases; cancellation after attempt only settles verified receipt, otherwise pending.
- [ ] Meaningful domain/Edge/SQL/Web tests, independent review, native runtime and full regression/build.

No production migration, secrets, enabled flag, model calls or prices are changed. A separate tariff approval and real environment acceptance remain required.

本地实现与独立审查已完成，最终全量回归/构建进行中；真实浏览器与完整 Supabase Edge 环境仍未验收。具体结果以 doc/project-progress.md 与 verification 证据为准。

最终本地自动验收已通过，见最新项目进度和最终代码指纹。真实环境验收仍为blocked，不标记上线完成。
