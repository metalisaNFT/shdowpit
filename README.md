# SHDOWPIT

A minimalist 3D nemesis roguelite. Three.js + TypeScript + Vite, no other runtime dependencies.

There are two ways to play the same world.

**THE LONG GAME** is the main one, and you are not in it. You are the thing arranging it. A
region of named characters wants things — to climb, to be safe, to answer somebody for
something — and every cycle they each weigh everything they could do and do the thing that
scores highest. You never move any of them. You spend Influence on conditions: a price on a
head, a rumour in an ear, steel in a hand, a blessing, a wound closed. Then time passes and
you find out what people did with what you left lying around. Every intervention raises Chaos,
and a world you have handled too much stops being one you can predict.

**DESCEND ALONE** is the third-person game: you fight your way through the same region yourself.
It is also available from inside the long game, as the most expensive intervention there is —
you put yourself in the world for one confrontation, and the cycles keep turning without you.

Either way the enemies are persistent: they have names, faces, grudges, scars and opinions about
you, and they keep existing whether you are alive or not. When you die the world takes a turn
without you — duels are fought, captains are promoted, allies are betrayed, and some of the
people you killed decide they were not finished. Then you come back and find out what changed.

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

# Browser suites need a preview server and Chromium:
#   npm run build && npx vite preview --port 4173
# Chromium resolution: PLAYWRIGHT_CHROMIUM, then Playwright's install,
# then platform fallbacks. If none: npx playwright install chromium

npm test               # headless playtest (tools/playtest.mjs)
npm run test:god       # THE LONG GAME vertical slice (75 checks)
npm run test:emergence # do stories actually emerge? (accelerated runs)
npm run test:depth     # save migrate / Heat / Remnants / sim hooks
npm run test:story     # story graph, recap, Web
npm run test:combat    # combat QA tests 1–5
npm run test:anim      # animation arena
npm run test:slice     # Tower Commander vertical slice
npm run test:backend   # AI backend security suite
npm run test:ai        # AI + nemesis continuity suite
npm run test:ai-success # AI success path (needs preview:mock)
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
| `R` / `Middle Mouse` | Void Needle |
| `E` | Interact / execute / remnant / extraction |
| `F` | Soft lock-on |
| `Shift` | Sprint |
| `Tab` | Hierarchy, chronicle and the dead |
| `Esc` | Pause / settings |
| `F1` | Developer overlay |
| `1`–`3` | Choose a power when one is offered |

Inputs are buffered for ~250ms and only consumed once they actually fire, so a press made slightly
early during recovery or a stagger still comes out.

---

## The long game

The board is an **oracle view** over the live 3D world: a territory minimap, one
**NOW** card at a time, and a **hybrid clock** that auto-advances cycles unless you
pause, intervene, or a major beat stops time. Major fights replay in the viewport
from afar while captions land on the NOW card.

1. **OBSERVE.** One load-bearing situation at a time — a grudge about to act, a house
   coming apart, someone climbing too fast. The full board and feed live in drawers.
2. **INTERFERE.** Spend Influence. Thirteen interventions write *conditions*, not
   outcomes (`BLESS`, `CURSE`, `WHISPER`, `PRICE THEIR HEAD`, `DESCEND`, …). The clock
   waits until you advance after a spend.
3. **SIMULATE.** Characters score every option from personality, relationships,
   memory, needs, danger, opportunity, ambition, and chaos-widened noise — then act.
   Fights use the real weapon and attack tables.
4. **CONSEQUENCES.** One aftermath link at a time on the NOW card; the feed drawer
   holds the full timeline. Major beats pause the clock until dismissed.
5. **ESCALATE.** Four acts toward a crisis you cannot touch directly — only arrange
   for someone who can.
6. **RUN END.** Up to three characters enter the **Book of Legends** and leave
   something in the next world. Unlocks add verbs and starting worlds, not bigger numbers.

**Learning it.** The first run walks six guided steps. After that, at most one short
lesson per cycle. **WHY** on decision beats opens the arithmetic. `THE PRIMER` on the
god teaching rail is the rules on one page.

`docs/GOD_LAYER.md` is the map of `src/god/`.

## The descent loop

1. A run starts in **THE PIT** with your base weapon and no powers.
2. You explore six connected areas, kill things, and take powers from shrines and from captains you
   kill. A run is meant to last roughly 20–40 minutes.
3. Named enemies show up: on their own ground, hunting you, or interrupting each other.
4. You die, or you kill the Overlord, or you extract at a physical gate after a named kill (or by paying Remnants). Pause **abandon** banks Essence without moving the world.
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

Forty-three run-scoped powers are defined (thirty-one appear in offers), all mechanical rather than percentage bumps — `BLINK`, `REVERSAL`,
`PREDATOR`, `PARASITE`, `BLOOD DEBT`, `SHOCKWAVE`, `CHAIN`, `PHANTOM`, `EMBER`, `RIPOSTE`, `TERROR`,
`ECHO`, `STAMPEDE` and friends. Offered at shrines and after every captain-or-above kill.

---

## Architecture

```
src/
  god/       THE LONG GAME — GodRun (the cycle), Autonomy + Utility + Actions (the simulation),
             Duel + Combatant (headless combat off the real tables), Interventions + Conditions
             (the player's only reach into it), Influence, Factions, Arc, Crisis, Situations,
             Feed, Legends, Unlocks
  core/      Game.ts (wiring + UI state machine), GameLoop, Input, SaveSystem, EventBus, Events, RNG
  world/     Arena (geometry + collision), World (run director), WorldSimulation, WorldEvent
  nemesis/   Nemesis (model), NemesisManager (roster + hierarchy), Generator, Appearance,
             Memory, Relationships
  player/    Player, PlayerController, PlayerCombat, PlayerStats
  enemy/     Enemy, EnemyAI, EnemyCombat
  combat/    CombatSystem (resolves every blow), Hitbox, Types
  ai/        AIContentService, AIBackend, AIQueue, comic portrait pipeline
  anim/      Rig, Animator, ClipLibrary (clips.json)
  comic/     ComicService, capture queue
  progress/  Progression, OfferRoller, skill tree
  run/       RunState types
  story/     StoryAI, StoryModel, arcs
  camera/    ThirdPersonCamera
  abilities/ AbilityRuntime, OfferRoller, Reactions, SkillTargeting
  ui/        HUD, HierarchyScreen, DeathReport, NemesisIntro, TitleScreen, PowerSelect,
             PauseScreen, DebugOverlay, GodScreen, LegendsScreen, Dom
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

The whole map is a handful of `InstancedMesh` draws. At quality=low with six enemies the
harness sees ~130 draw calls and ~5k triangles — higher than the early prototype target, still
modest for WebGL. Point lights are a **fixed pool of four** that get moved to
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

It boots the real build in headless Chromium (see `tools/browser.mjs` for path resolution), drives actual keyboard and mouse input, and asserts the major loop: movement, each combat action, damage, the power offer, the hierarchy and chronicle screens,
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

`tools/godtest.mjs` walks the long game's vertical slice and its teaching layer end to end — a run starts, the board
surfaces situations, an intervention charges both resources and provably changes no outcome, time
advances, characters decide for themselves, fights happen, people die and come back, memory turns
into intent, a crisis emerges from the simulation, the run ends, somebody reaches the Book, and the
next run inherits it. `tools/emergence.mjs` runs many accelerated runs and reports how often each of
the eight target story patterns occurred.

Together: 179 + 99 checks, plus the emergence probe.

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

## Depth systems (player-facing)

Named enemies can offer a **Vendetta** — one optional personal objective with a previewed reward. **Heat** is the readable pursuit meter; thresholds telegraph hunters and lockdowns, never spawning on top of you. **Remnants** are a run-only drop (not Essence): heal (vulnerable), reroll offers, pay extraction, or block a fake death. Territories impose **one law** from the current holder; liberation is temporary and the law follows the new holder after simulation. After a named victory you pick **one** reward derived from their real traits. Mercy, tribute, humiliation and betrayal are available when a named foe is broken and the fight is safe enough. Weapons are sidegrades with unlockable **techniques**. Power **families** and up to three **reactions** change verbs, not just numbers.

AI remains optional and presentation-only. Saves are version **7**; older worlds migrate with defaults.

### Tower Commander vertical slice (human playtest)

1. `npm run build && npx vite preview --port 4173`, then play or `npm run test:slice`.
2. New world → first minutes should teach move/strike from a prompt (pause **SKIP TUTORIALS** / **REPLAY TUTORIALS**). **NOW** panel lists Vendetta, holder law, stolen steel — not every system.
3. F1 **TOWER SLICE** (or `__sim('verticalSlice')`): a named Commander holds THE TOWER, a loyalist guards them, your spear is stolen, a Vendetta is live, Heat is up. Beacon and banners follow the holder. **THE RING** labels the spire.
4. Fight: Duelist feints; Commander **order pulse** / weaker when isolated; summoned grunts do not farm Essence. Skills `1`/`2`, ultimate `3`/`G` (`spectral_guard`, `hunters_brand`, `shadow_snare`, `living_weapon`, `last_defiance`, `pit_eruption`).
5. Outcome / **NEMESIS TROPHY** then **RUN POWER**. Death recap is four beats plus a hook; Skip jumps to Continue. Full chronicle is Hierarchy TIME.

### Wave C leftovers (not this pass)

Gamepad adapter, HUD scale / colorblind / assist options, pruning redundant PowerId grants, extracting Tutorial/Reward/Recap controllers from `Game.ts`, lazy-loading AI/Web/F1 extras, remaining five territories via `docs/TERRITORY_PASS.md`.

### Extension points

- Vendetta patterns: `src/nemesis/Vendetta.ts`
- Reactions: `src/abilities/Reactions.ts`
- Territory laws: `src/world/TerritoryRules.ts`
- Heat: `src/world/Heat.ts` + `HEAT` in `src/data/balance.ts`
- Proc ownership: `src/combat/ProcRules.ts`
- F1 **DEPTH** buttons and `Game.__sim()` for harnesses

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

One versioned JSON blob in `localStorage` under `shdowpit.world.v1` (`saveVersion` 7). It holds the
roster, appearance seeds, memory, relationships, hierarchy, territories, liberation mods, event log, world turn and
Age, player meta (Essence, Vigour cap 30, techniques, Vendetta history), optional mid-run snapshot, the
suspended long-game run, the Book of Legends, the god-layer unlocks, and settings. Unknown or
missing fields are filled by `SaveSystem.migrate()` rather than crashing, and a corrupt save is
archived aside instead of silently destroyed.

---

## Where to take it next

Wave C from the Tower slice plan: gamepad, accessibility, progression prune, architecture extract from `Game.ts`, bundle split, other territories.

- Gamepad input: `Input` already routes everything through named actions, so this is one adapter.
- More weapons — the data tables are the only thing that needs to grow.
- Remaining areas follow `docs/TERRITORY_PASS.md`.
- Body-part damage or a stance system would deepen combat without touching the nemesis layer.
