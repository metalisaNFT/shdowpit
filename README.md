# SHDOWPIT

A minimalist 3D nemesis roguelite. Three.js + TypeScript + Vite, no other runtime dependencies.

You fight your way through one compact region held by a hierarchy of named enemies. The enemies are
persistent: they have names, faces, grudges, scars and opinions about you, and they keep existing
whether you are alive or not. When you die the world takes a turn without you — duels are fought,
captains are promoted, allies are betrayed, and some of the people you killed decide they were not
finished. Then you come back and find out what changed.

Nothing here is derived from any existing game's characters, names, art, text, or code. The names,
titles, personalities, traits, dialogue, areas and systems are all original to this project.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build on :4173 (includes /api/ai)
npm run serve      # same thing from a plain node server, no vite

npm test               # 44-check headless playtest
npm run test:backend   # 29-check AI backend security suite
npm run test:ai        # 75-check AI + nemesis continuity suite
npm run test:ai-success # 31-check AI success path (needs preview:mock)
```

Desktop browsers, keyboard + mouse. The game asks for pointer lock when a run starts; press `Esc`
to release it (that also pauses).

### Render quality

Three settings — `high` / `medium` / `low` — change shadow resolution and pixel density only.
Gameplay, enemy counts and map are identical at every setting. It auto-steps down if the frame rate
cannot hold, and you can force one with `?quality=low` in the URL or from the pause menu.

---

## Controls

| Key | Action |
| --- | --- |
| `WASD` | Move |
| `Mouse` | Camera |
| `Left Mouse` | Light attack (3-hit combo) |
| `Right Mouse` | Heavy attack (staggers) |
| `Space` | Dodge (brief invulnerability) |
| `Q` | Parry (timing window; opens captains up badly) |
| `E` | Interact / execute |
| `Shift` | Sprint |
| `F` / `Middle Mouse` | Soft lock-on |
| `Tab` | Hierarchy, chronicle and the dead |
| `Esc` | Pause / settings |
| `F1` | Developer overlay |
| `1`–`3` | Choose a power when one is offered |

Inputs are buffered for ~250ms and only consumed once they actually fire, so a press made slightly
early during recovery or a stagger still comes out.

---

## The loop

1. A run starts in **THE PIT** with your base weapon and no powers.
2. You explore six connected areas, kill things, and take powers from shrines and from captains you
   kill. A run is meant to last roughly 20–40 minutes.
3. Named enemies show up: on their own ground, hunting you, or interrupting each other.
4. You die, or you kill the Overlord, or you extract from the pause menu.
5. **Death advances the world by one turn.** You get the WHILE YOU WERE DEAD report, then a new run.
6. Killing the Overlord ends the Age: a power vacuum, several turns of succession, a relic weapon
   for you, and a new set of world modifiers. This continues indefinitely.

Your Nemesis world is never reset by death. Only `RESET WORLD` on the title screen destroys it.

---

## Systems

### Nemesis records

Every named enemy is one `Nemesis` object (`src/nemesis/Nemesis.ts`) that persists forever: rank,
level, archetype, personality, appearance seed, weapon, strengths, weaknesses, scars, memory events,
rivalries, allies, master, kill/defeat/escape counts, stolen loot, revenge chance, and territory.
Grunts use the exact same structure with `persistent: false`, so there is one code path for stats,
appearance and behaviour.

### Memory

Discrete events, not AI. `PLAYER_BURNED_ME`, `I_KILLED_PLAYER`, `PLAYER_HUMILIATED_ME`,
`I_ESCAPED_PLAYER`, and so on. Memory drives revenge chance, dialogue selection, titles, and how
likely they are to come hunting you during a run.

### Scars and titles

Surviving something notable leaves a scar, which changes the model (burn scars darken and ember,
a missing eye removes one, a broken mask hangs off, a metal jaw is bolted on) and brings mechanical
consequences — fire resistance *and* a fear of fire, for instance. Titles are scored against actual
history, so `THE ASHEN`, `THE RETURNED`, `THE THIEF` and `THE UNBROKEN` are earned rather than
decorative, and the roster avoids duplicating them.

### Adaptation

Enemies watch how you fight and learn — but softly, never as a hard counter. Parry everything and
someone picks up `DELAYED STRIKE`. Burn everything and survivors gain `FIRE HARDENED`. Hit from
behind constantly and someone starts watching their back. Each of these costs you convenience, not
your build.

### World simulation

`src/world/WorldSimulation.ts` runs a seeded turn when you die. It picks weighted events — duels,
challenges upward, betrayals, alliances, assassinations, territory grabs, injuries, mutations,
weapon theft, recruitment — resolves them against power, personality and luck, then reconciles the
hierarchy. Beating someone above you takes their rank *and* pushes them down, so the crown genuinely
changes hands. Roughly six different Overlords per hundred turns in testing.

Returns from death are deliberately rare: two turns buried minimum, weighted by personality and
unresolved grudge, at most one per turn.

### Ages

Killing the Overlord increments the Age. Ages 1–5 are named (`THE WASTES`, `BLOOD MOON`,
`THE PLAGUE`, `THE IRON AGE`, `THE VOID`); after that they are procedurally combined from a pool of
modifiers, forever. Modifiers change aggression, armour prevalence, mutation and resurrection rates,
captain density, fog and lighting — never a flat health multiplier, because bullet sponges are not
difficulty.

### Loot and revenge

When a named enemy kills you they may take your weapon. They carry it visibly on their next
appearance, it makes them stronger, other enemies can steal it off their corpse, and killing them
gives it back. That is the whole feature: a personal objective the game did not write for you.

### Powers

Twenty run-scoped powers, all mechanical rather than percentage bumps — `BLINK`, `REVERSAL`,
`PREDATOR`, `PARASITE`, `BLOOD DEBT`, `SHOCKWAVE`, `CHAIN`, `PHANTOM`, `EMBER`, `RIPOSTE`, `TERROR`,
`ECHO`, `STAMPEDE` and friends. Offered at shrines and after every captain-or-above kill.

---

## Architecture

```
src/
  core/      Game.ts (wiring + UI state machine), GameLoop, Input, SaveSystem, EventBus, Events, RNG
  world/     Arena (geometry + collision), World (run director), WorldSimulation, WorldEvent
  nemesis/   Nemesis (model), NemesisManager (roster + hierarchy), Generator, Appearance,
             Memory, Relationships
  player/    Player, PlayerController, PlayerCombat, PlayerStats
  enemy/     Enemy, EnemyAI, EnemyCombat
  combat/    CombatSystem (resolves every blow), Hitbox, Types
  camera/    ThirdPersonCamera
  abilities/ AbilityManager
  ui/        HUD, HierarchyScreen, DeathReport, NemesisIntro, TitleScreen, PowerSelect,
             PauseScreen, DebugOverlay, Dom
  audio/     AudioManager (fully synthesised, no assets)
  fx/        Particles
  data/      traits, abilities, personalities, names, dialogue, weapons, areas, ages
```

Deliberate boundaries worth keeping:

- **`PlayerCombat` and `EnemyCombat` only decide *timing*.** They open a hit window;
  `CombatSystem` decides what that window touches. Tuning feel means editing one file.
- **`NemesisManager` is the only thing that writes the save** and the only thing that decides who
  is Overlord.
- **Everything procedural runs off a seeded `RNG`.** Appearances, names and simulation outcomes are
  reproducible; a save reloads to exactly the same cast.
- **The scene is rebuilt through `Game.rebuildArena()`**, because `Arena.build()` clears the scene
  and the player, particles and live enemies all have to go back in.

### Performance notes

The whole map is a handful of `InstancedMesh` draws — around 50–120 draw calls and under 3k
triangles with a full arena and a crowd. Point lights are a **fixed pool of four** that get moved to
whichever sources are nearest the player: Three.js recompiles every material when the light *count*
changes, so the count never changes.

---

## Developer tools

`F1` opens the debug overlay (pointer lock is released so the buttons work). From there you can
spawn or summon any nemesis, force promotions, betrayals and resurrections, advance a world turn or
a whole Age, grant powers, teleport between areas, toggle invulnerability, kill the player, and
inspect any character's full memory and relationship state. Emergent systems are close to untestable
by playing normally, so this panel is not optional.

There is also an automated playtest:

```bash
npm run build
npx vite preview --port 4173 &
node tools/playtest.mjs
```

It boots the real build in headless Chromium, drives actual keyboard and mouse input, and asserts 40
things: movement, each combat action, damage, the power offer, the hierarchy and chronicle screens,
the full death → world turn → report → next run flow, the Overlord → succession → new Age flow,
save persistence across reload, and a 120-turn simulation stress run (no errors, roster stays
populated, promotions happen, the crown changes hands, some enemies return, betrayals occur). It
fails on any console error. Screenshots land in `playtest-shots/`.

`tools/quickcheck.mjs` boots one quality level and reports draw calls and errors.

Three more suites cover the AI layer:

- `tools/backendtest.mjs` — the backend security contract over HTTP: no endpoint echoes the key on
  any path, every upstream failure maps to a short sanitised string, malformed input never returns
  a stack trace.
- `tools/aitest.mjs` — the settings UI, the security properties in the browser (nothing in
  localStorage, the save, the console or the F1 panel), every AI failure mode, and the full
  nemesis continuity scenario: meet, scar, escape, killed-by, world turn, promotion, return with a
  changed face and title, death, resurrection, Book of Enemies page, reload.
- `tools/aisuccess.mjs` — the success path against a mock provider, so generated titles, taunts,
  chronicles, portraits, caching and portrait evolution are tested without a key or a bill. Run the
  server with `npm run preview:mock` first.

Together: 179 checks.

---

## AI content (optional)

AI is an enhancement, never a dependency. With it switched off — which is the default, and what
happens automatically when there is no connection — every system still works: names, titles,
dialogue, chronicles and portraits all come from `src/ai/AIFallbackGenerator.ts`, deterministically
seeded from each nemesis's own data.

### What AI is and is not allowed to do

The game creates facts. AI interprets them. It never controls combat, hit detection, stats, damage,
progression, world simulation, promotion odds, loot, movement or enemy AI — those stay deterministic.
Generated content lands in `Nemesis.ai`, a presentation-only namespace nothing mechanical reads.

Prompts are built only from a `NemesisFacts` snapshot and instruct the model that it may not assert
anything absent from it. Because a prompt instruction is a request rather than a guarantee, every
response is re-checked on the way back in by `AIContentService.assertsUnknownFact`, which rejects
claims about fire, a lost eye, theft, returning from death, or having killed the player when the
simulation never recorded them. A rejected response is discarded and the local content stands.

### Modes

`OFF` — everything local. `TEXT ONLY` — names, titles, taunts and chronicles. `FULL` — adds
generated portraits.

Generation fires on **myth events** (a promotion, a kill against the player, surviving a death, a
major scar, a weapon theft, taking the crown, coming back from the dead) and also warms the living
hierarchy on the title screen when AI is on — Overlord and captains, at a lower priority than a live
encounter. Results are cached under `hash(nemesisId + kind + visualVersion + eventVersion)`, so
identity is stable across encounters and reloads and nothing is regenerated until the character
actually changes.

Nothing blocks. A nemesis appears immediately with its procedural portrait and local title; anything
generated arrives later and swaps in. If the request takes 30 seconds, or fails, or there is no
server at all, play is unaffected.

### The API key

**The key never enters the browser.** You paste it into the settings panel, it goes straight to a
local backend, and that backend holds it in memory for the lifetime of the process:

```
settings UI  ->  POST /api/ai/connect  ->  in-memory keyStore  ->  OpenAI
```

It is never written to `localStorage`, the save file, the console, the F1 panel, a log line, or an
error message. `SaveSystem` additionally scrubs anything key-shaped on the way in and out, as a
guard against a future edit. Restart the server and you re-enter the key; that is intended.

`server/aiHandler.mjs` is the whole backend and is mounted three ways from one implementation:
as Vite middleware in `dev` and `preview`, and by `server/index.mjs` as a standalone server.
`OPENAI_API_KEY` in the environment works too, for local convenience.

Upstream failures are mapped to a fixed vocabulary — `Invalid API key`, `Network unavailable`,
`Request timed out`, `API unavailable`, `Rate limited` — and the upstream body is discarded rather
than forwarded, because OpenAI echoes a recognisable key prefix in some of its errors.

### Module layout

```
src/ai/
  AITypes.ts              the contract, including the presentation-only namespace
  AIBackend.ts            browser -> local backend client
  AITextProvider.ts       provider interface + backend and null implementations
  AIImageProvider.ts      same, for images
  AIContentService.ts     orchestration, validation, the sync getters the UI calls
  AIPromptBuilder.ts      facts projection, memory compression, prompts
  AIFallbackGenerator.ts  local generation + the procedural SVG portrait
  AICache.ts              text cache (localStorage) + portrait store (IndexedDB)
  AIQueue.ts              priority queue, bounded concurrency, contained failures
```

Nothing outside `src/ai/` names a vendor.

---

## Debug panel

`F1` opens it. Live readout (FPS, player state, enemy count, world turn and Age, area), an AI status
block (provider, connection, mode, queue, active, cached, last request, last result, latency, and
every in-flight request), and controls to force any interesting state: spawn, damage or kill the
player, kill / promote / demote / scar / escape / revive / crown any nemesis, advance the world or
the Age, reset the run, reset the save, regenerate AI content, clear the AI cache.

It cannot display the API key, because the key is not in the browser.

---

## Save data

One versioned JSON blob in `localStorage` under `shdowpit.world.v1`, a few tens of KB. It holds the
roster, appearance seeds, memory, relationships, hierarchy, territories, event log, world turn and
Age, player meta progression, weapon ownership including stolen weapons, and settings. Unknown or
missing fields are filled by `SaveSystem.migrate()` rather than crashing, and a corrupt save is
archived aside instead of silently destroyed.

---

## Where to take it next

- Gamepad input: `Input` already routes everything through named actions, so this is one adapter.
- More weapons and archetypes — the data tables are the only thing that needs to grow.
- Enemy-vs-enemy encounters are in (rivals attack each other on sight, loyalists guard masters);
  they could carry more staging.
- Body-part damage or a stance system would deepen combat without touching the nemesis layer.
