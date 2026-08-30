# The unified simulation layer

> One engine runs the world whether you are watching from the oracle board, dying in the pit, or leaving the game open on the title screen.
>
> **`src/sim/` is the map.** `src/god/` owns the scoring engine; `src/sim/` owns how every mode reaches it and what happens after a beat.

Read this before changing offscreen beats, chronicle trim, pit↔god bridges, or anything that touches `worldTurn`.

See also: [`GOD_LAYER.md`](GOD_LAYER.md) for the utility engine, interventions, and oracle UI.

---

## 1. Time axes

Three clocks coexist. Confusing them breaks saves, emergence harnesses, and death-report copy.

| Axis | Storage | Scope | Advances when |
| --- | --- | --- | --- |
| **`worldTurn`** | `SaveData.worldTurn` | Global, persists across pit runs and god runs | Every unified beat — god cycle, death beat, background tick, succession round |
| **`god.cycle`** | `GodState.cycle` | Run-scoped (1…32) | Each `GodRun.advanceCycle()` only |
| **`worldAge`** | `SaveData.worldAge` | Meta epoch | Overlord kill, `reseedWorld()`, title NEW WORLD / RESET |

Canonical definitions live in [`TimeModel.ts`](../src/sim/TimeModel.ts).

**Unification rule:** after Phase 2, **one god cycle ≡ one world beat** (`CYCLE_BEAT_RATIO = 1`). Both call `NemesisManager.advanceTurn()` once per beat. Pit offscreen beats and god cycles share the same global turn counter, so chronicle, story graph, and hierarchy all read one timeline.

`NemesisManager.turn` is an alias for `data.worldTurn`.

---

## 2. The engine

Every beat funnels through the same path:

```
entry point
    │
    ▼
resolveOffscreenBeat()     ← OffscreenBeat.ts
    │  expireQuests + assignQuests  ← NpcQuests (before autonomy)
    │  simulateCycle()     ← god/Autonomy.ts (utility scoring, no story director)
    │  tickBiomes()        ← world/BiomeState.ts (ecology drift after actions)
    │  ctx.silent ?         ← skips feed/UI emission when true
    ▼
reconcileWorld()           ← Reconcile.ts (ranks, territories, roster, power, reconcileBiomes)
    │
    ▼
trimEventLog()             ← ChronicleArchive.ts (archive slice, then drop)
    │
    ▼
mgr.persist()
```

There is no separate weighted-event table in `WorldSimulation.ts` anymore. That file is a thin wrapper: `simulateTurn()` and `simulateSuccession()` call `resolveOffscreenBeat()`.

Interventions still write **conditions**, not outcomes. Offscreen beats use the same `Autonomy.simulateCycle()` as a visible god cycle; only presentation differs.

---

## 3. Entry points

| Entry | Caller | Mode | RNG | Act profile |
| --- | --- | --- | --- | --- |
| **God cycle** | `GodRun.advanceCycle()` | Visible — feed, situations, NOW card | `god` (persisted `GodState.rngState`) | Run act from `Arc.effectiveAct()` |
| **Player death** | `Game.runDeathSimulation()` | Silent | `world` (`mgr.simRng`) | `offscreenActFor(mgr)` |
| **Background tick** | `BackgroundTick.tickBackgroundWorld()` | Silent | `world` | `offscreenActFor(mgr)` |
| **Succession** | `WorldSimulation.simulateSuccession()` | Silent, 2–3 rounds | `world` | `offscreenActFor(mgr)` |
| **DESCEND fast-forward** | `GodRun.fastForward()` | Visible (accelerated cycles) | `god` | Run act |

**God cycle** is the full loop: OBSERVE → INTERFERE → SIMULATE → CONSEQUENCES. It writes to `GodState.feed`, rebuilds situations, and may pause the oracle clock on major beats.

**Death beat** runs one silent turn after succession is committed, then feeds `composeWorldTurnRecap()` and the death report.

**Background ticks** fire during long pit sessions when real-time absence exceeds `settings.backgroundTickMinutes` (default 4), subject to guards in `shouldBackgroundTick()` (no tutorial, no extraction, no encounter intro). Returns `{ fired, turn, message }`; chronicle events are ranked so betrayals, returns, promotions, and duels surface as pit toasts ahead of skirmish filler.

**Succession** logs the empty seat, runs several silent turns, then crowns whoever `fillRanks()` left as Overlord.

**DESCEND fast-forward** runs `advanceCycle()` with no player interference while the player is in the pit — the board moves under them. Summary copy uses `Feed.summariseCycle()`, which prefers story beats over background skirmish noise.

Debug / harness: `Game.__god('pitAdvance', n)` and F1 “advance world turn” hit the same `resolveOffscreenBeat` path as death.

---

## 4. Silent vs visible; ephemeral vs persisted

### Silent vs visible

| | Silent (`ctx.silent = true`) | Visible (god run) |
| --- | --- | --- |
| Feed beats | Suppressed | Written to `GodState.feed` |
| NOW card / spectator | No | Yes |
| Chronicle | Yes — `ctx.chronicle()` still runs | Yes |
| `WorldEvent` log | Yes | Yes |

Pit death, background, and succession are always silent. God cycles and DESCEND fast-forward are visible.

### Ephemeral vs persisted `GodState`

`resolveOffscreenBeat()` chooses god state via `resolveGod()`:

- **`rng: 'god'`** and `mgr.data.god` exists → use **persisted** run state; write back `rngState` after the beat.
- **`rng: 'world'`** (or no god save) → build an **ephemeral** `emptyGodState()` seeded from `worldSeed` + turn; factions seeded with `seedFactions()`; discarded after the beat (only world/roster/chronicle persist).

Starting THE LONG GAME calls `seedSimFromPitHistory()` first — it nudges `Nemesis.sim` from pit memories and event log so the oracle board opens with grudges and confidence that match what the player actually did.

New worlds also seed **standing grudges** in `NemesisManager.seedRoster()`: rival pairs get `goal`, `goalTargetId`, and `goalAge` so cycle-1 situations can read “X WANTS Y” before anyone acts.

---

## 5. Dynamic offscreen act — `offscreenActFor()`

God runs scale pressure through the four authored acts in [`Arc.ts`](../src/god/Arc.ts) (`tempo`, `lethality`, `pressure` keyed on `god.cycle`, then chaos overload via `effectiveAct()`).

Offscreen beats (death, background, succession) do **not** read `god.act`. They call **`offscreenActFor(mgr)`** in [`OffscreenBeat.ts`](../src/sim/OffscreenBeat.ts) and pass the result as `actOverride` to `resolveOffscreenBeat()`:

```ts
const act = opts.actOverride ?? offscreenActFor(mgr);
```

`offscreenActFor()` returns an `ActDef` with the same fields as the run acts, but keyed on **`worldTurn` and `worldAge`**, not `god.cycle`:

| Input | Effect on profile |
| --- | --- |
| `worldTurn < 8` | Lethality capped — early pit deaths stay survivable |
| Mid turns | Bands mirror `Arc.ACTS` tempo/lethality/pressure, indexed on global turn |
| Higher `worldAge` | Sharper offscreen beats even when the player never opens the oracle |

The static `PIT_ACT` constant (tempo 0.75, lethality 0.7, pressure 0.65) is the pre-upgrade fallback. The Long Game pass replaces default resolution with `offscreenActFor()`. Visible god cycles and DESCEND fast-forward still use `Arc.effectiveAct()` on the persisted run.

When `rng: 'god'` and a live `GodState` exists, offscreen resolution may still honour the run’s current act instead of the pit profile — see `resolveGod()` in the same file.

---

## 6. Pit bridges — two directions

Do not confuse these files; they solve opposite problems.

| File | Direction | Role |
| --- | --- | --- |
| [`sim/PitSimBridge.ts`](../src/sim/PitSimBridge.ts) | **Pit → sim** | Live combat updates `Nemesis.sim` via [`CombatOutcome.ts`](../src/sim/CombatOutcome.ts): kills, escapes, scars, vendetta progress, player death. Keeps god resume and descent reports aligned with pit facts. |
| [`god/PitBridge.ts`](../src/god/PitBridge.ts) | **Sim → pit** | God conditions and Book legacies into combat tilts on `Enemy`: blessings, bounties, legacy echoes, arrival toasts. Headless duels use the same math through `Combatant`. |

`PitSimBridge` never runs a full cycle. `PitBridge` never writes rank or `alive`.

---

## 7. Reconciliation and chronicle trim

Every beat ends with the same post-pass — no entry point skips it.

### Reconcile ([`Reconcile.ts`](../src/sim/Reconcile.ts))

1. `fillRanks()` — one Overlord, closed hierarchy; promotion events emitted to feed when `ctx` is present.
2. `pruneDead()` — roster hygiene.
3. `assignTerritories()` — ground assignment (Overlord holds fortress only; W-9).
4. `reconcileBiomes()` — holder personality nudges stock/fauna; house fracture spills treasury; resource feuds.
5. `recomputePower()` — every nemesis.

Biome ecology drift runs **`tickBiomes()`** immediately after `simulateCycle()` (before `advanceTurn`) so autonomy actions can consume/produce stock first; reconcile then aligns ownership effects. See [`BIOME_LAYER.md`](BIOME_LAYER.md).

God cycles pass `GodContext` so promotions can surface as feed beats; silent paths pass `mgr` only.

### Chronicle trim ([`ChronicleArchive.ts`](../src/sim/ChronicleArchive.ts))

| Constant | Value | Meaning |
| --- | --- | --- |
| `MAX_LOG` | 600 | Normal trim threshold |
| `QUOTA_TRIM` | 400 | Harder trim when `localStorage` quota fails |

When the log exceeds the cap, **`archiveAgeSlice()`** runs first: player-facing, witnessed, important, or high story-score events are summarised into `SaveData.chronicleArchives[]` before raw rows are dropped. `trimForQuota()` and `archiveSyntheticAgeBoundary()` handle save pressure and Age boundaries.

Story graph, hierarchy, and death report read the live log plus archives — trim is lossy for noise, not for player-touching history.

---

## 8. Module map

| File | Job |
| --- | --- |
| `TimeModel.ts` | Canonical time-axis types and `CYCLE_BEAT_RATIO` |
| `OffscreenBeat.ts` | `resolveOffscreenBeat()`, `offscreenActFor()`, ephemeral god, `seedSimFromPitHistory()` |
| `BackgroundTick.ts` | Real-time pit absence → silent beats |
| `Reconcile.ts` | Single post-beat hierarchy/territory/biome pass |
| `../world/BiomeState.ts` | Per-area ecology, resources, dungeon sites; seed/tick/reconcile |
| `../god/NpcQuests.ts` | NPC-only quest ledger; syncs `SimState.goal` |
| `ChronicleArchive.ts` | Archive-before-trim pipeline |
| `CombatOutcome.ts` | Shared aftermath vocabulary for pit and god fights |
| `PitSimBridge.ts` | Pit event hooks into `Nemesis.sim` |

Legacy import path: `world/WorldSimulation.ts` → delegates here. Prefer importing from `sim/` in new code.

---

## 9. Verification

Run after sim or god changes:

```bash
npm run build
npm run test:god          # interventions, teaching, oracle slice (~98 checks)
npm run test:simreg       # deterministic worldTurn / roster baselines (seed 424242)
RUNS=16 npm run test:emergence   # eight story-pattern rates across accelerated runs
```

| Harness | What it guards |
| --- | --- |
| **`test:simreg`** | God-only, pit-only, and mixed paths advance `worldTurn` consistently; roster hash stable; no duplicate event ids. Fixture: `tools/fixtures/sim-baseline.json`. |
| **`test:emergence`** | Distribution of grudge chains, returns, betrayals, etc. — not a single-run script. Seeded RNG; optional `MIN_RATE` env thresholds after tuning pass. |
| **`test:god`** | THE RULE (conditions not outcomes), situation board, DESCEND, feed integrity. |

Grudge persistence (G-3) and succession integrity (W-1) gain assertions in `test:simreg` / `test:god` as part of the Long Game upgrade.

**Fresh worlds seed standing grudges.** `NemesisManager.seedRoster()` pairs rivals and writes `sim.goal`, `goalTargetId`, and `goalAge` so the oracle board surfaces intent from cycle 1 — not only after the first kill chain forms in play.

---

## 10. Things that are easy to break

- **One engine.** Do not reintroduce a parallel turn resolver in `WorldSimulation.ts` or `Game.ts`.
- **`worldTurn` is the chronicle index.** Story, AI prompts, and death reports key off it; god-only counters must not fork timeline truth.
- **Silent beats still chronicle.** Suppressing feed ≠ skipping `mgr.log()`.
- **Ephemeral god must not persist.** Offscreen `rng: 'world'` paths must not write a half-finished `GodState` into the save.
- **`Nemesis.sim` is mechanical truth.** Pit bridge and god engine both write it; AI and UI read it, never invent it.
- **Determinism.** `simRng` and god `rngState` are seeded; `test:simreg` and `test:emergence` depend on stable ordering.
