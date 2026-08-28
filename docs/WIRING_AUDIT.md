# Wiring Audit — Created but Not Wired

**Verified:** 2026-08-28  
**Integration hub:** [`src/main.ts`](../src/main.ts) → [`src/core/Game.ts`](../src/core/Game.ts) → [`src/core/GameLoop.ts`](../src/core/GameLoop.ts)

Automated checks: `npm run test:wiring` (static source audit + in-browser self-test).

---

## Summary

| Category | Status |
|----------|--------|
| **UI screens** (`src/ui/*.ts`) | All 16 top-level screens instantiated and mounted in `Game.ts` (~311–331). **No orphan UI classes.** |
| **God / Comic / Progress / Tutorial / VerticalSlice** | **Wired** through `Game.ts`. Submodules consumed via `GodRun`, `ComicService`, `Progression`. |
| **Partial wiring** | OverlayGate (3 unused fields), ComicViewer (gated + missing death hook), run-loot pipeline, EffectTrigger system |
| **Dead code** | `AbilityManager.ts` (superseded by `OfferRoller`) |
| **Dead EventBus events** | 7 of 9 event types unused or one-sided |
| **Save schema without consumers** | `telemetryOptIn`, `unlockedStarting`, `progress.favorites` |
| **Exported helpers with no imports** | ~12 functions across `god/` and `progress/` |

---

## 1. UI — mounted but partially connected

### All screens wired (no orphans)

Every screen in `src/ui/` is created in `Game.ts` and appended to `#ui`:

HUD, TitleScreen, HierarchyScreen, DeathReport, NemesisIntro, PowerSelect, ChoiceOverlay, PauseScreen, DebugOverlay, AIStatus, BuildScreen, GodScreen, PrimerScreen, LegendsScreen, RunEndScreen, ComicViewer.

Child: `AISettingsPanel` mounted by `PauseScreen.ts` on open.

### Partial: OverlayGate decisions never applied

`OverlayGate.ts` computes 8 fields; `Game.ts` (~2111–2166) only consumes 5:

| Field | Computed | Consumed in Game? |
|-------|----------|-------------------|
| `lane`, `showTutorial`, `showPurpose`, `showPrompt`, `nextLabel`, `combatFocus` | Yes | **Yes** |
| `showBanner` | Yes | **No** — banner visibility is timer-only in HUD |
| `showToasts` | Yes | **No** — toasts always append; CSS hides in story-centre mode |
| `allowRemnantPrompt` | Yes | **No** — remnant gated only via `showPrompt` |

### Partial: ComicViewer — wired but rarely reaches player

**Wired:**

- Instantiated `Game.ts:327`; `present`/`hide` via `presentComicNow` / `closeComic`
- Combat feeds: `onNamedIntro`, `onNamedStrike`, `onNamedOutcome` (enemy outcomes only)

**Not wired / blocked:**

- **Player death** dismisses comics instead of recording outcome — `Game.ts:2797–2801`: `dismissComic(true)` with no `comic.onNamedOutcome(..., 'player_dead')`, despite beats existing in `comic/StoryBuilder.ts`
- **`onPanelReady`** callback never passed in `setupComic()` — progressive panel UI not connected
- **Auto-present** requires empty arena + 1.4s calm + idle player (`tryPresentComic` ~491–504) — comics mostly queue and expire in combat-heavy play
- **`ComicService.setStyle()`** and **`setEnabled()`** never called from Game

### Reachability notes (wired but gated)

- **BuildScreen** — title + pause only; no in-play hotkey without pausing
- **LegendsScreen** — title button hidden until `legendCount > 0`
- **`AIStatus.clear()`** — method exists, never called

### Stub callback

`onGodEnd(outcome)` at `Game.ts:1456` is registered as `GodRun` hook (`onEnd` at ~1088) but empty. Real end-screen flow goes through `presentGodEnd()` called directly from `godAdvance`, `abandonGodRun`, descent return, and debug paths.

---

## 2. EventBus — 7 of 9 events dead

Defined in `src/core/Events.ts`:

| Event | Emitted? | Listened? | Verdict |
|-------|----------|-----------|---------|
| `worldEvent` | `NemesisManager.ts:516` | `Game.ts:414` | **Wired** |
| `sfx` | Never | `Game.ts:413` | Listener with no emitter |
| `toast` | Never | Never | Dead — game calls `ui.hud.toast()` directly |
| `rosterChanged` | Never | Never | Dead |
| `saveRequested` | Never | Never | Dead |
| `hudDirty` | Never | Never | Dead |
| `nemesisPromoted` | `NemesisManager.ts:381` | Never | Emitted, no listener |
| `nemesisDied` | `NemesisManager.ts:437` | Never | Emitted, no listener |
| `nemesisReturned` | `NemesisManager.ts:461` | Never | Emitted, no listener |

Nemesis lifecycle is handled via direct callbacks (`onNamedDefeated`, encounter director), not the bus.

---

## 3. Game systems — created but not connected

### Orphan module

**`src/abilities/AbilityManager.ts`** — class exported, **zero imports** anywhere. Superseded by `OfferRoller.ts` used at `Game.ts:108`.

### Run-loot pipeline (schema exists, gameplay never populates)

| Piece | Status |
|-------|--------|
| `RunState.runLoot` | Defined in `RunState.ts`, read by `applyBuildToStats` and `BuildScreen` |
| `runLootChoices()`, `randomDef()` | Exported from `Progression.ts`, **never called** |
| Only write path | Debug command `runLoot` in `Game.ts` (~5381–5384) |

Normal play never awards run loot — the field is effectively dead outside debug.

### EffectTrigger system (types only)

- **`EffectTrigger`** union in `progress/Types.ts`: `ON_HIT`, `ON_PARRY`, `ON_KILL`, etc.
- **`EffectBus`** in `progress/Effects.ts` used only as proc cooldown guard in combat
- Type import is void-cast to silence lint (`Effects.ts:48`) — trigger dispatch never implemented

### Comic barrel unused

`src/comic/index.ts` re-exports the comic subsystem — **zero** `from '../comic'` imports. Game imports `ComicService` directly; barrel is dead.

---

## 4. SaveSystem fields — written/migrated, never read

From `SaveSystem.ts` → `PlayerMeta`:

| Field | In save schema | Read in gameplay/UI |
|-------|----------------|---------------------|
| `telemetryOptIn` | Default + migrate (~189, 297) | **Never** — does not gate `Telemetry.enabled` |
| `unlockedStarting` | Default + migrate (~187, 295) | **Never** |
| `progress.favorites` | Migrated in `Progression.ts:24` | **Never** |

---

## 5. Telemetry — partially hooked

| Capability | Normal play | QA only |
|------------|-------------|---------|
| Kit counters (`noteSkillUse`, `noteSurge`, etc.) | Yes | — |
| `pushDeath()` | Yes (always logs) | — |
| `pushHit()` / `pushFrame()` / `pushEnemy()` | No | `Game.__qaStart()` (~4993) |
| Player opt-in UI | **Missing** | — |

---

## 6. Exported helpers with zero consumers

| Export | File |
|--------|------|
| `filterFeed`, `summariseCycle`, `threadFor`, `beatToneClass` | `god/Feed.ts` |
| `legendHome` | `god/Legends.ts` |
| `describeFaction` | `god/Factions.ts` |
| `unlockName` | `god/Unlocks.ts` |
| `CHAOS_HERESY_AT` | `god/Teaching.ts` |
| `nodePreview`, `treeCostRemaining` | `progress/Progression.ts` |

Likely prepared for UI polish (feed filtering, faction tooltips, skill tree previews) but not yet connected.

---

## 7. Priority matrix

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P0** | Run-loot pipeline | Build screen shows empty run loot forever | Medium — hook into boon/kill/extract |
| **P0** | Comic `player_dead` outcome | Death comics never generate | Small — one hook in death flow |
| **P1** | OverlayGate unused fields | Banner/toasts/remnant ignore combat gating | Small — wire in `tickPlaying` |
| **P1** | `onGodEnd` stub | Misleading callback registration | Trivial — delegate to `presentGodEnd` or remove |
| **P2** | EventBus cleanup | Dead types + emit-only nemesis events | Medium — wire listeners or remove emits |
| **P2** | Save fields | Schema bloat / false expectations | Medium — implement or remove |
| **P3** | `AbilityManager.ts` | Duplicate of OfferRoller | Trivial — delete |
| **P3** | God Feed helpers | Richer god board UI | Medium |
| **P3** | EffectTrigger dispatch | Gear affix behavior | Large — full combat hook system |
| **P3** | `comic/index.ts` barrel | Unused export surface | Trivial — delete or adopt |

---

## 8. Correctly wired (for contrast)

These were flagged as "new" in git status but **are integrated**:

- **God layer** — `GodRun`, `GodScreen`, interventions, teaching, legends, descent via `applyVerticalSlice`
- **Comic system** — `ComicService` + viewer + combat intro/strike/enemy-outcome hooks
- **Progress** — build screen, gear, cinders, skill tree, `ensureStarterGear`, `applyBuildToStats`
- **Tutorial** — combat tutorials via `TutorialController`; god guide via `Guide` + `PrimerScreen`
- **VerticalSlice** — tower god-descent and debug hook

---

## Recommended next steps

**Recommended fix scope: P0 + P1 first**, then re-run `npm run test:wiring` to confirm known gaps shrink.

### Phase 1 — P0 (player-visible gaps)

1. **Run-loot pipeline** — call `runLootChoices()` after kills, boons, or extraction; push chosen item IDs into `world.run.runLoot`.
2. **Comic player death** — before `dismissComic(true)` on death, call `comic.onNamedOutcome(killer.nemesis.id, 'player_dead')` when killer is named.

### Phase 2 — P1 (coordination bugs)

3. **OverlayGate** — in `tickPlaying`, apply `showBanner`, `showToasts`, and `allowRemnantPrompt` (hide banner via `clearAreaBanner` when false; gate toast creation or visibility; use `allowRemnantPrompt` for remnant heal prompt).
4. **`onGodEnd` stub** — delegate to `presentGodEnd(outcome)` or remove hook and rely on `godAdvance` path only (document chosen pattern).

### Phase 3 — P2 cleanup (when schema stabilizes)

5. **EventBus** — either wire nemesis events to HUD toasts / hierarchy refresh, or remove dead types and emit-only calls.
6. **Save fields** — implement telemetry opt-in toggle, starting unlocks, and build favorites UI, or remove from schema.

### Phase 4 — P3 (optional polish / debt)

7. Delete `AbilityManager.ts` or merge into `OfferRoller`.
8. Wire god Feed helpers into `GodScreen` feed filtering.
9. Implement `EffectTrigger` dispatch or defer and remove the type until needed.
10. Delete or adopt `comic/index.ts` barrel.

### Automation

- **`npm run test:wiring`** — static source checks (`tools/wiringaudit.mjs`) plus in-browser DOM/regression checks (`tools/wiringtest.mjs` via `WiringSelfTest.ts`).
- Re-run after each wiring fix; gap tests should flip from known-gap to passing.
