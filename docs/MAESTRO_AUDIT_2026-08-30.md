# SHDOWPIT — Maestro Audit, 2026-08-30

**Auditor**: Claude (Cowork), Maestro workflow (Logician → Maestro → Polymath)
**Method**: Live working-tree source pulled directly from `F:\ShdowPit` on the user's machine, built and exercised in a clean cloud container (`npm ci && npm run build`, then the full Playwright harness battery against `vite preview`), cross-checked against the prior audit (`docs/MAESTRO_AUDIT.md`, written 2026-08-29 against commit `840a56c`).

## 0. Repo state — read this before the findings

Local `main` is **14 commits ahead** of the previously-audited `840a56c`, ending at `6b550e4` ("Resolve Maestro §6 owner decisions for god layer and run semantics"). The reflog shows those 14 commits are a methodical remediation pass that worked through the prior audit phase-by-phase and finding-by-finding: *Fix Maestro Phase 0 session breakers*, *Phase 1 harness honesty*, *Phase 2 unify modal queue/succession/run-end*, *Phase 3 combat promises*, *Phase 4 long-game integrity*, *K-10/K-11/K-12 combat gear rebuild*, *Phase 5 world simulation truthfulness*, *Phase 6 AI cache/queue/validation*, *Phase 7 low-risk fixes*, *A-11 local AI hardening*, *C-7/C-8 run-offer seeding*, *T-9/T-10 harness stabilization*, ending with the §6 owner-decision resolution.

**On top of that**, several source files on disk are timestamped ~15 hours **after** the `6b550e4` commit (e.g. `core/Game.ts`, `core/SaveSystem.ts`, `god/NpcQuests.ts`, `ui/GodMap.ts`). That is uncommitted work-in-progress this audit could not diff against git history (no local shell access to the user's machine this session — see §7). **Everything below was measured against that actual on-disk state**, uncommitted changes included, because that is what the game currently does.

**GitHub `metalisanft/shdowpit` main is still at `840a56c`.** None of the 14 commits above — and none of the further uncommitted work — has been pushed. If Vercel deploys from the GitHub link, production is still running the audited-broken build with all four P0s live. Push before anything else.

## 1. The four prior P0s — all verified fixed in the live tree

| ID | Finding | Status | Evidence |
|---|---|---|---|
| C-1 | Reroll on a power offer froze the game | **FIXED** | `requestModal`/`presentOffer` were rewritten around a real pending-modal queue (`Game.ts` `requestModal` ~4335, `pendingModals`/`modalRank`/`canOpenModal`). `tryRerollOffer` (~3869) now unconditionally resets `mode = 'playing'`, clears the power UI, and re-offers through the same path. |
| C-2 | Esc on the BUILD screen froze the game | **FIXED** | `onRawKey`'s `Escape` handler (~3165) now has an explicit `else if (this.mode === 'build') this.closeBuild();` branch instead of falling through to the guarded `openPause()`. |
| C-3 | Title NEW WORLD wiped banked meta with no confirm | **FIXED** | `TitleScreen.ts` (~145) now requires a second click — the button relabels to "START FRESH WORLD?" and arms a `confirmingNewWorld` flag before calling `onNewWorld`. `depthtest` (harness, live run) confirms the semantics: **PASS** "NEW WORLD keeps banked essence — 120", "NEW WORLD keeps banked cinders — 8", "NEW WORLD resets world turn — 1". |
| K-1 | `EffectBus.chain` never reset — gated powers went silently dead after 3 hits | **FIXED** | `beginEvent()` (`progress/Effects.ts:21`) now has real callers at `Game.ts:6492` and `Game.ts:6520`. |

Two more Phase-0 items from the prior audit are also independently confirmed fixed by the harness run:

- **A-2** (server crash on `/%`) and the general backend hardening: `backendtest` — **45/45 passed**, including "malformed path returns 400" and "server survives malformed path".
- **A-1** (`/api/ai/*` accepted any origin): `server/aiHandler.mjs` now has explicit `localhost` / `127.0.0.1` / `[::1]` origin checks (~264, ~271).
- **W-2** (heat `lockedExits` never released): `depthtest` — **PASS** "heat 90 locks extraction exits", **PASS** "heat 60 reopens extraction exits", **PASS** "heat can pulse 60 threshold again after decay".

This is a genuinely clean sweep of the prior P0s. Nice work.

## 2. Full harness battery, run live (this audit, cloud container, commit `6b550e4` + uncommitted)

Recipe: `npm ci && npm run build && npx vite preview --port 4173 &`, then `PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tools/<suite>.mjs`, matching the methodology the prior audit established.

| Suite | Result | vs. prior audit (840a56c) |
|---|---|---|
| `vitest run` (unit) | **18/18 passed** (8 files) | not previously run standalone |
| `test:wiring` (wiringaudit) | **19/19 regression passed, 0 known gaps** | was informational-only before (couldn't fail); now green *and* meaningful |
| `qa` / simreg baseline | **all checks PASS** | previously reported a MAJOR and exited 0 regardless; now genuinely clean |
| `test:backend` | **45/45 passed** | — |
| `test:story` | **6/6 + 21/21 self-test passed** | — |
| `test:simreg` | **14/14 passed** | — |
| `test:god-ai` | **57/57 passed** | — |
| `test:depth` | **22/22 passed** | — |
| `test` (playtest) | **crashed** after 1 explicit FAIL | was 47/50 |
| `test:god` (godtest) | **97/100** (3 FAIL) | was 97/98 (1 FAIL) — **worse** |
| `test:sequence` | **51/53** (2 FAIL) | was 49/50 (1 FAIL) — **worse** |
| `test:slice` | **15/16** (1 FAIL, same theme) | was 15/16 (1 FAIL) — unchanged |
| `test:anim` | **29/32** (3 FAIL) | was 31/32 (1 FAIL) — **worse** |
| `test:comic` | **hard crash** (TypeError) | was 8/9 (soft FAIL) — **worse** |
| `test:combat` | **48/51** (3 FAIL) | not in the 16-suite battery the prior audit table covered |
| `test:ai` | **82/88** (6 FAIL, one cluster) | not in the prior audit's headline table |
| `test:leaks` | **3/4** (1 FAIL) | not in the prior audit's headline table |

Net: the six suites the prior audit flagged as red are **still not clean** — three of them (godtest, sequencetest, animtest, comictest — four, really) got measurably worse, one is unchanged, and `playtest` now crashes outright instead of finishing with failures. The harness-honesty work (Phase 1) paid off, though: `wiring` and `qa` went from structurally unable to fail to genuinely green, which is real progress on trustworthiness even though it surfaced new red elsewhere.

## 3. New / regressed findings from this pass

Numbered independently of the prior audit's C-/K-/G-/W-/A-/U-/T- scheme (call them **R-1** … **R-9**) since these were found fresh, not re-verified against a known ID.

### R-1 — P1 — Combat gear rebuild broke two ranged attack variants
`test:combat` — **FAIL** "charged fires (piercing_shot) — saw 0", **FAIL** "ground fires (toxic_lob) — saw 0", **FAIL** "ground shot leaves a toxic zone — 0 zones". Both `piercing_shot` and `toxic_lob` are defined in `data/attacks.ts` (356, 376) but the harness never observes either firing. This lands squarely in the area touched by "Finish combat gear rebuild and copy gaps (Maestro K-10/K-11/K-12)" — worth a targeted look at whatever dispatches attack IDs to projectile spawning in `CombatSystem.ts`/`EnemyCombat.ts` for these two specifically.

### R-2 — P1 — Void Needle projectile broken in sequence flow
`test:sequence` — **FAIL** "the Void Needle fires — fired=true kinds=none", **FAIL** "needle travels at a readable speed — 0 m/s". The fire event registers but produces no projectile *kind* and zero travel speed — consistent with R-1: something in the projectile-kind pipeline (shared by player Void Needle and the enemy ranged attacks above) regressed together, likely in the same gear-rebuild commit.

### R-3 — P1 — Comic pipeline hard-crashes on `setQuality` of an unloaded module
`test:comic` — crashes (not a soft FAIL) with `TypeError: Cannot read properties of undefined (reading 'setQuality')` inside `__comicSlice` → `this.comic.setQuality(...)` (`Game.ts:6605`). `src/comic` is behind a lazy bundle (`src/lazy/comicPipeline.ts`), and `__comicSlice` itself already guards one race ("not_playing" if you haven't descended — `Game.ts:5497`) but not this one: if `__sim('comicSlice', quality)` runs before the lazy comic module has finished loading, `this.comic` is still `undefined` and the quality-set call throws instead of failing soft. This regressed from a soft FAIL (8/9) in the prior audit to a hard crash — worth fixing before the next audit, since a thrown error here can abort whatever test or player flow triggers it.

### R-4 — P1 — Playtest: power offer missing after a captain death, then a hard crash
`test` (playtest) — **FAIL** "power offer appears after a captain dies — screen not shown", then the harness itself throws `no such tab: ORDER (have )` trying to open the hierarchy/Book screen next. The empty `(have )` means `#hierarchy-screen .tab` returned zero elements — the hierarchy screen likely never opened. Treat the power-offer failure as the primary suspected regression (an offer that should appear after killing a captain doesn't); the ORDER-tab crash is very likely a downstream symptom of the game being left in an unexpected mode after that failure rather than a second, independent bug — **unverified**, flag for isolation before fixing.

### R-5 — P1 — God layer: contextual descend can't find an actor to meet
`test:god` — **FAIL** "contextual descend enters the pit — false god There is nobody there to meet" (message sourced from `god/Interventions.ts:576`, `if (!a || !a.alive) return 'There is nobody there to meet.'`), plus **FAIL** "return lands back on the board — undefined" and **FAIL** "return produces a strategic report". The two `return` failures are almost certainly downstream of the descend failure (if descend never succeeds, nothing produces a report to return from) rather than three independent bugs — **suspected single root cause**: the actor-presence precondition for contextual descend isn't being satisfied in a state the test expects to be valid.

### R-6 — P2 — Book/Legends detail page: AI content missing across the board
`test:ai` — 82/88, with a tight cluster of 6 FAILs all on the same screen: "the book has his page", "the page lists scars", "the page shows his record", "the page has a readable history", "the page shows a portrait", "his chronicle survives the reload" — all reference `ai.chronicleFor(n)` / `ai.portraitFor(n)` / `ai.portraitHistory(n)` in `ui/HierarchyScreen.ts` (~576-670). Three console errors during the run are `400 Bad Request` from the AI backend. `backendtest` passing 45/45 rules out gross server breakage, so this looks like either a request-shape regression specific to the Book page's AI calls, or the A-1/A-11 origin-hardening work being stricter than this one call site expects. Investigate the exact request `HierarchyScreen` sends versus what `aiHandler.mjs` now accepts.

### R-7 — P1 — Animation regressions: heavy attack, knockdown, taunt
`test:anim` — 3 new FAILs not present in the prior audit's single failure: "B1 heavy → HEAVY_ATTACK/Atk2H_Slam ends in IDLE/Idle" (unexpected), "B6 knockdown → KNOCKDOWN/Knockdown plays none", "B7 taunt one-shot plays taunt=null". All three are named-clip lookups failing to resolve or play — worth checking whether these clip IDs survived whatever touched `anim/clips.json` (untouched per the diff, so more likely something in `Animator.ts`/`Enemy.ts`'s clip-selection logic shifted during the wider `core/Game.ts` rewrite).

### R-8 — P2 — Geometry leak across run boundaries
`test:leaks` — **FAIL** "geometry count stable after 5 run boundaries — 77 → 143 (Δ66)", while shader programs (Δ1) and listeners (Δ0) stay flat. Something created per-run (per-enemy mesh, per-hitbox visualizer, or per-VFX geometry) isn't going through `Arena`'s `disposables` array (`world/Arena.ts:860`, `for (const d of this.disposables) d.dispose();`) the way the pooled shader programs clearly are. Long sessions will accumulate GPU memory.

### R-9 — P3 — Bundle grew despite the recommended fix landing
The audit's "cheapest win" (`json: { stringify: true }` for `vite.config.ts`, to stop inlining `clips.json` as an object literal) **is applied** and confirmed in the live build. Net effect: gzip total is still **~637 kB** across chunks (previously 574 kB) — the story/god/sim layer expansion outgrew the savings. Also new: Vite's build now explicitly warns `Circular chunk: story -> god -> story` — a concrete, bundler-flagged version of the prior audit's "type-only import cycle" finding, now real enough to show up as a chunking warning. Not urgent, but worth knowing before the next perf pass.

## 4. Still open, unchanged from the prior audit

- **Seeded RNG scope.** The "Seed run offers from runSeed" commit (C-7/C-8) added `this.rng = new RNG(this.world.run.runSeed)` and a per-encounter seed, but a repo-wide grep still finds **84 `Math.random()` call sites across 17 files** (prior audit: 83/16) — essentially unchanged. Crits, live enemy AI, and run-loot are still on unseeded `Math.random`. If deterministic replay or seeded-run fairness matters, this is still the gap.
- **`slicetest` "multi staging id present or solo — temp_cooperate".** Same 15/16 ratio as the prior audit; not confirmed whether this is the *same* failure carried forward or a coincidentally-identical ratio with a different cause — flag for isolation, don't assume it's stale.

## 5. What this audit could not check

- **No local shell on the user's machine this session** (no `device_bash` tool available), so nothing here is a `git diff` — the "changed since `840a56c`" picture in §0 comes from file mtimes and the commit-message reflog, not a real diff. A proper `git diff 840a56c..HEAD` plus `git diff` (working tree) would sharpen every finding above and should be the first thing whoever picks this up runs.
- `test:ai-success`, `test:local-ai`, `test:godplay`, `test:animshot`, `test:quickcheck` were not run (need `preview:mock` or the real local-AI sidecar binaries, which weren't staged into this audit's container).
- No manual/visual QA pass — everything above is what the harnesses assert, not a played-through session.

## 6. Recommended next order

1. **Push `main` to GitHub.** Fourteen commits of P0 fixes plus further uncommitted work are sitting on one machine. If Vercel deploys from GitHub, production still has all four original P0s live.
2. Isolate and fix the shared root cause behind R-1/R-2 (gear-rebuild projectile regressions) — likely one fix in the attack-dispatch path fixes both `test:combat` and `test:sequence`.
3. Fix R-3 (comic `setQuality` crash) — small, well-localized, and currently the only *hard crash* in the battery besides playtest's cascade.
4. Isolate R-4 (playtest) and R-5 (godtest) — in both cases, run the harness with one check at a time to confirm whether the later failures are cascades of the first, then fix the root check.
5. R-6 (Book/AI content) — compare the exact request `HierarchyScreen` makes against what the now-hardened `aiHandler.mjs` accepts.
6. R-7 (anim regressions), R-8 (geometry leak) as the next pass; R-9 (bundle/circular chunk) is informational only.
7. Re-run this same harness battery after the fixes above — six of sixteen suites red is a smaller finding than "406 lines of P0/P1 findings," but it means this audit's "green" still isn't fully trustworthy either.
