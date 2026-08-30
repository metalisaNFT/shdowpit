# ShadowPit Upgrade Review — 2026

Independent follow-up to the fresh review plan. This document is the source of truth for what landed; do not treat older audit files as authoritative.

## Wave A — CI foundation

- Committed `tools/fixtures/sim-baseline.json` with `UPDATE_SIM_BASELINE=1` guard in `tools/simregtest.mjs`
- GitHub Actions: typecheck, build, unit tests, lint, `test:ci` (wiring, backend, simreg, story)
- `tools/run-with-preview.mjs` + `npm run test:ci`
- `scripts/split-css.mjs` rewritten as import-order validator only
- README save version corrected to **9** (`biomes`, `npcQuests`)

## Wave B — Vitest + ESLint

- `vitest.config.ts` with tests for TimeModel, CombatOutcome, save migrations, story helpers
- `eslint.config.js` (typescript-eslint, warnings-only) + `npm run lint`
- `tools/tsconfig.json` with optional `checkJs`

## Wave C — Architecture extract

- `src/core/RenderHost.ts` — renderer, camera, post-FX, quality
- `src/core/PitSession.ts` — playing/dying tick delegation
- `src/core/GodSession.ts` — god mode lifecycle + lazy GodRun import
- `src/core/UIOrchestrator.ts` — mode → `#ui[data-mode]`
- `src/world/modules/SpawnModule.ts` + `HeatModule.ts`
- Eager `SimState` init in `NemesisManager.seedRoster` / `recruit`
- `WorldSimulation.ts` retired; imports use `sim/OffscreenBeat`

## Wave D — Accessibility

- `ChoiceCard` as `<button type="button">` with focus styles
- `src/ui/focusTrap.ts` on PauseScreen and TitleScreen
- `TabBar` primitive for PauseScreen + HierarchyScreen
- `.screen-headline` token, god oracle responsive stack at 900px, selectable recap text

## Wave E — Bundle

- `rollup-plugin-visualizer` + `npm run build:analyze`
- Vite `manualChunks` for three / god / story / comic
- Lazy GodRun load in `GodSession`; deferred debug/comic setup hooks
- Hidden sourcemaps in production builds

## Wave F — Product

- Gamepad adapter in `Input.ts` (standard mapping → named actions)
- Mid-run resume via `RunCheckpoint` + title continue flow
- `alarms_escapes` territory law: combat heat pressure when cowards hold ground
- This review doc

## Residual risks

- `Game.ts` is still large; further session/controller extractions recommended
- Full god-layer code splitting requires moving more static imports behind dynamic boundaries
- Playwright harnesses remain the integration gate; migrate to `@playwright/test` after CI stabilizes
