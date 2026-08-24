# ZImage 桌面创作页 Design QA

- source visual truth:
  - `/var/folders/m9/8qcc1f1x5278r2bzf8kqn_j80000gn/T/codex-clipboard-4930cbbc-4ad4-4ed6-bba8-8253bb4cc3a5.png`
  - `/var/folders/m9/8qcc1f1x5278r2bzf8kqn_j80000gn/T/codex-clipboard-e8c18895-c94b-4121-8215-e49bb6e20c73.png`
- implementation screenshots:
  - `/Users/zhaoyao/Desktop/work_space/Image-web/.design-qa/implementation-empty-matched.png`
  - `/Users/zhaoyao/Desktop/work_space/Image-web/.design-qa/implementation-parameters.png`
  - `/Users/zhaoyao/Desktop/work_space/Image-web/.design-qa/implementation-parameters-focus.png`
- primary E2E viewport: `1440 × 900` CSS px, device scale factor 1
- full-view comparison viewport: `1778 × 995` CSS px, device scale factor 1
- source dimensions:
  - empty page: `3556 × 1990` px, normalized to `1778 × 995` for the full-view comparison
  - parameter crop: `1644 × 882` px, normalized to `822 × 441` for the focused comparison
- state: light theme; empty image-creation home and generation-parameter popover open

## Full-view comparison evidence

The normalized empty-page reference and browser-rendered implementation were opened together. Both use a two-column desktop frame, a narrow white conversation rail, a very light gray creation canvas, a centered greeting with three 16:9 skill cards, a top-right asset-library action, and a large bottom composer. The implementation keeps the project-required mock scenario selector as a lightweight developer control; this is an intentional product constraint rather than design drift.

Required fidelity surfaces:

- Fonts and typography: system sans-serif fallback, compact 14–15 px interface text, bold centered greeting, and muted secondary card copy follow the reference hierarchy. No wrapping, truncation, or optical-weight issues were observed.
- Spacing and layout rhythm: sidebar, centered skill group, composer anchoring, card radii, light borders, and restrained elevation follow the reference. Persistent controls remain inside the viewport at 1440 × 900.
- Colors and visual tokens: white surfaces, `#f7f8fa` canvas, neutral gray controls, and restrained cyan active states retain the reference balance and meet the product's existing token direction.
- Image quality: all three cards use generated local WebP photographs with correct 16:9 crops, sharp subjects, no logos, no text artifacts, and no placeholder/CSS artwork.
- Copy and content: greeting, card actions, asset-library label, image composer guidance, model, parameter and quota summaries are coherent in standalone use.

## Focused region comparison evidence

The normalized parameter reference crop and the implementation's parameter/composer crop were opened together. Both show a white elevated panel anchored immediately above the composer, graphical ratio choices, full-width segmented resolution and count controls, and a live toolbar summary. The implementation intentionally omits smart/custom ratios, 4K, 5–8 images and custom pixel dimensions because current model capabilities and Phase 1 requirements support only five ratios, 1K/2K and 1–4 images.

## Interaction and responsiveness evidence

- Skill card opens the skill dialog.
- Submitting with a missing required skill field reopens the dialog and focuses `商品名称`.
- Escape closes popovers; model, parameter and skill popovers are mutually exclusive.
- Sidebar collapses and expands.
- Asset library provides visible “资产库暂未开放” feedback.
- At `390 × 844`, the composer remains usable and the compatibility configuration drawer exposes the model control.
- Browser console errors checked after desktop and mobile interactions: none.

## Findings

No actionable P0, P1 or P2 fidelity issues remain.

P3 follow-up polish:

- The top Mock selector is intentionally visible for Phase 1A development. It can be removed from production without changing the layout contract.

## Comparison history

- Pass 1: no P0/P1/P2 findings; no visual fixes were required after the combined full-view and focused comparisons.
- Responsive verification then exposed one P2 compatibility issue: the mobile stylesheet hid the required image-tool switch. The rule now hides only desktop popover triggers and keeps the switch visible; the post-fix `390 × 844` Chromium-mobile flow and full E2E matrix pass.

final result: passed
