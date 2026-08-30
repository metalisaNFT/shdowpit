# Biome layer

> Six areas are not just combat zones — each carries persistent ecology, resources, abstract dungeon sites, and house-driven errands that feed the unified sim spine.

See [`SIM_LAYER.md`](SIM_LAYER.md) for beat entry points and [`GOD_LAYER.md`](GOD_LAYER.md) for the conditions-not-outcomes rule.

---

## Module map

| Module | Role |
| --- | --- |
| [`src/data/areas.ts`](../src/data/areas.ts) | Static `BiomeProfile` per area — resources, feral fauna, dungeon site defs |
| [`src/world/BiomeState.ts`](../src/world/BiomeState.ts) | Persisted `SaveData.biomes`, seed/migrate, `tickBiomes()`, `reconcileBiomes()` |
| [`src/god/NpcQuests.ts`](../src/god/NpcQuests.ts) | NPC quest ledger on `SaveData.npcQuests`; assign/expire/complete |
| [`src/god/Actions.ts`](../src/god/Actions.ts) | Verbs: `gather`, `hunt_feral`, `delve`, `plunder`, `guard_site`, `deliver`, `tribute` |
| [`src/god/Skirmish.ts`](../src/god/Skirmish.ts) | Feral-vs-rabble skirmishes weighted by `faunaPressure` |
| [`src/god/Situations.ts`](../src/god/Situations.ts) | Board kinds: `feral_surge`, `resource_scarce`, `abundant_growth`, `house_need`, `dungeon_ready`, `quest_urgent` |
| [`src/ui/GodMap.ts`](../src/ui/GodMap.ts) | Area chip biome meters (fauna/stock/dungeon pulse) |

---

## Beat pipeline (unchanged spine)

```
resolveOffscreenBeat / GodRun.advanceCycle
    │
    ├─ expireQuests + assignQuests     ← before Autonomy.simulateCycle
    ├─ simulateCycle                   ← utility actions consume/produce biome
    ├─ tickBiomes                      ← ecology drift after actions
    ├─ advanceTurn
    └─ reconcileWorld
           └─ reconcileBiomes         ← territory + house feuds + fracture spill
```

Determinism: biome tick RNG is `mixSeed(worldSeed, worldTurn * 9973)`.

---

## Data shapes

### `AreaBiomeState` (per area on save)

- `faunaPressure` 0..1 — feral skirmishes and hunt scoring
- `resourceStock` — material buckets keyed by profile resources
- `depletion`, `unrest` — aggregate wear and local tension
- `activeSites[]` — `{ siteId, status, repopulateAt? }` with `sealed | open | cleared | repopulating`

### `NpcQuest`

House/personal errands: `gather`, `delve`, `hunt_feral`, `deliver`, `guard_site`, `reclaim_cache`. Completing syncs treasury and clears `SimState.dungeonTarget`. **No player journal.**

### NPC materials

`SimState.materials` and `Faction.treasury` are separate from pit `runLoot`.

---

## Chronicle event kinds

| Type | When |
| --- | --- |
| `feral_incident` | Feral skirmish or successful hunt |
| `biome_gather` | Gather action |
| `dungeon_delved` | Delve attempt |
| `dungeon_cleared` | Site cleared |
| `dungeon_reopened` | Repopulate timer completes |
| `quest_complete` | NPC quest finished |

Story graph edges are emitted from these event types in [`StoryGraph.ts`](../src/story/StoryGraph.ts).

---

## Tuning knobs

All constants live in authored profiles (`BiomeProfile.dungeonSites[].danger`, `repopulateTurns`) and `BiomeState` tick deltas. Lock regressions with `npm run test:simreg` and `tests/world/BiomeState.test.ts`.

---

## Pit echo (light touch)

- [`WorldOccupancy.ts`](../src/world/WorldOccupancy.ts) — `faunaPressure` and `resourceLow` on occupancy snapshot
- [`TerritoryRules.ts`](../src/world/TerritoryRules.ts) — `biomeArrivalEcho()` entry copy when fauna or stock is extreme
