# THE LONG GAME — the god layer

> The player fantasy: **you don't control the characters, you control what happens to them.**
>
> The rule everything is built on: **an intervention creates conditions, never outcomes.**

This document is the map of `src/god/`. Read it before changing anything in there.

---

## 1. The loop

```
        ┌───────────────────────────────────────────────────────────┐
        │                        ONE CYCLE                          │
        │                                                           │
  OBSERVE ──►  INTERFERE  ──►  SIMULATE  ──►  CONSEQUENCES  ──► ESCALATE
   the board    spend           every living   beats into the    act clock,
   of things    Influence,      character      feed, memories    chaos decay,
   about to     which writes    scores every   written, houses   crisis growth
   matter       Conditions      option and     settle up
                                acts on one
        └───────────────────────────────────────────────────────────┘
                     ▼  crisis answered / world consumed / cycles run out
                  RUN END ──► Book of Legends ──► unlocks ──► a new world
```

A run is 25–32 cycles and takes a few minutes at ×20. Endings are roughly
60/40 triumph to collapse under semi-random play.

## 2. What lives where

| File | Job |
| --- | --- |
| `GodTypes.ts` | every type, plus `SimState` — the per-character dimensions the `Nemesis` record did not already carry (fear, confidence, ambition, loyalty, injury, goal, faction, deeds). Attached as `Nemesis.sim`, exactly the way `Nemesis.ai` is attached. |
| `Combatant.ts` | turns a persistent record into a fighter using `BODY`, `ENEMY_WEAPONS`, `computeMods` and `PERSONALITIES` — the same numbers the onscreen game uses |
| `Duel.ts` | headless combat, stepped at 120ms, driven by the real `chooseAttack` table. Returns who was standing, blow-by-blow beats, and injuries. It deliberately does **not** decide the loser's fate. |
| `Context.ts` | the one surface actions talk to. Owns `fight()` (which runs the duel and then decides kill / spare / humiliate / rob), `killOff()`, `wantRevenge()`, `deed()`, and both output channels (the feed and the existing chronicle). |
| `Utility.ts` | the scoring components and the shared terms |
| `Actions.ts` | eighteen things a character can decide to do, each enumerating its own targets and scoring them |
| `Autonomy.ts` | the SIMULATE phase: initiative order, the fight ration, drift, returns from death, faction settlement |
| `Conditions.ts` | the only thing the player writes. Ten kinds, all with a decay. |
| `Interventions.ts` | thirteen interventions. **Nothing in this file may change `alive`, `rank`, `power`, who holds ground, or who fights whom.** |
| `Influence.ts` | the two resources and the five chaos tiers |
| `Factions.ts` | houses: leader, members, ground, stability. They fracture, they re-form. |
| `Arc.ts` | the four acts. The only authored thing in the layer, and it authors *pressure*, not events. |
| `Crisis.ts` | reads the world and names whatever has already gone wrong with it |
| `Situations.ts` | the OBSERVE board — the handful of things about to matter, not the simulation dump |
| `Feed.ts` | priority filtering and cycle grouping |
| `Legends.ts` | the Book, and the five ways a legend reaches into the next world |
| `Unlocks.ts` | roguelite progression that adds verbs, not percentages |
| `GodRun.ts` | the run controller: phases, resources, the ending |
| `Explain.ts` | turns a decision's arithmetic back into sentences — the WHY panel |
| `Teaching.ts` | the guided first cycle, the lesson catalogue, and the primer |
| `Clock.ts` | hybrid world clock — auto-advance, pause on major beats, intervention hold |
| `../ui/GodScreen.ts` | oracle UI orchestrator: NOW card, clock, map rail, drawers |
| `../ui/GodMap.ts` | territory minimap over the six areas |
| `../ui/GodSpectator.ts` | distant 3D camera + duel replay on the main viewport |
| `../ui/GodNowCard.ts` | single-focus narrative card |
| `../ui/GodActionStrip.ts` | collapsible intervention strip |
| `../ui/GodFeedDrawer.ts` | consequence timeline drawer |
| `../ui/GodInspectDrawer.ts` | character inspect slide-over |
| `../ui/LegendsScreen.ts` | the Book and the end-of-run report |
| `../ui/GodTutorial.ts` | the teaching rail, the WHY panel, the primer screen |

## 2b. Oracle UI + clock

THE LONG GAME no longer dumps three columns at once. The live `#viewport` stays
visible behind semi-transparent panels while you play:

```
top bar     run · cycle · act · influence · chaos · world clock
left rail   territory minimap (click a region to focus)
center      the 3D world — camera flies to urgent ground; major fights replay here
bottom      NOW card — one situation, beat, or consequence link at a time
strip       interventions (collapsed until you click INTERFERE)
drawers     full feed timeline · character inspect
```

**Hybrid clock** (`Clock.ts`, settings in `SaveSystem.settings.god`):

- By default the world **auto-advances one cycle** when the timer reaches zero.
- Spending Influence **pauses** the clock until you advance manually.
- **Major and legendary beats pause** until you dismiss the NOW card.
- **3D duel replays** pause during spectacle; aftermath opens after.
- Opening tutorial keeps the clock off until the first lesson completes.

AI remains presentation-only: it words the NOW card and dossiers, never sim state.

## 3. The scoring engine

Every living character considers everything it could plausibly do and scores
each option out of the same eight components:

```
score = base          what this action is worth at all
      + personality   how much this KIND of person wants this kind of thing
      + relationship  what they are to the target
      + memory        what has already happened between them, decayed by age
      + need          injury, fear, confidence — what they lack
      - danger        what being wrong would cost them
      + opportunity   conditions in the world, including yours
      + ambition      how hard the current act is pushing everyone
      + noise         scaled by chaos
```

There is no `if` tree. A traitor betrays because betrayal scores highest for a
traitor with a weak master, an old wound and a rumour in their ear; a loyalist
does not, because the same sum comes out differently for them. `PERSONALITIES`
already carried the bias vector (`challenge / betray / ally / revenge /
ambition / survival / hunt / protect / steal`) — the engine reads it directly
rather than inventing a parallel one.

The full breakdown is kept for every option, not just the total. `F1` →
**CONSIDERED ACTIONS** prints it. A system nobody can inspect is a system
nobody can tune.

## 4. Conditions, and the rule

An intervention writes a `Condition` and nudges `SimState`. That is all it can
do. `PRICE THEIR HEAD` does not kill anybody — it adds a `bounty`, which raises
the `opportunity` term on `hunt` for characters whose personality already
leans that way, against a `danger` term they may still find too high.

The distance between *"I put a price on his head"* and *"he died"* is the game.
`tools/godtest.mjs` asserts this mechanically: it snapshots the roster, fires an
intervention, and fails if any character's `alive` or `rank` changed.

`RAISE` is the single exception — a life is touched directly — and it costs ten
chaos for exactly that reason.

## 5. Chaos

Influence is what you spend. Chaos is what spending it costs, and it is not a
penalty you pay to yourself — it is paid by your ability to predict anything.
Higher chaos widens every utility roll, raises tempo and lethality, mutates
newcomers, brings more of the dead back, feeds the crisis, and above 45 lets
characters work out that something has been arranging their world and start
tearing up whatever you put down.

It decays 1.1 per cycle, so a spike is survivable and a habit is not.

## 6. Teaching it

The hard thing to learn here is not the buttons — it is the habit of mind that
you are changing prices rather than issuing orders, and that the gap between
what you paid for and what happened is the game rather than a fault in it. So
the teaching is three layers, and only the first is a tutorial in the usual
sense.

**The guided first cycle** (`Teaching.GUIDE`) is six steps, each waiting on
something the player actually does — selecting a situation, spending, letting
time pass, opening a beat, pressing WHY. Never a timer. It is deliberately
tolerant of being done out of order: any event belonging to a later step
carries the walkthrough forward, so a player who selects a name from the
inspector instead of the board cannot strand it. It also gives up after cycle 5
rather than holding the rail hostage from someone who ignored it. And it ends
by explicitly *not* promising that the intervention worked.

**Lessons** (`Teaching.LESSONS`) are one short card, at most one per cycle,
fired the first time a concept becomes real *in this particular world*. Nothing
is front-loaded: you learn what chaos does the cycle it starts doing it, and
what a grudge is the cycle somebody has held one for long enough to matter. The
rail holds one at a time and will not queue another until the player dismisses
it, so the pacing belongs to them. Two of them are the ones worth having:

- `it_did_not_work` — somebody you were propping up lost anyway. Measured, not
  guessed: `GodContext.blessedLosers` records it during the fight.
- `backfire` — something you paid for was used against something else you paid
  for.

**WHY** (`Explain.ts`) is the only layer that scales, and the one that matters.
Every beat produced by a character's decision carries that decision's full
reasoning (`Beat.why`), and WHY renders it as sentences: what their nature
wanted, what they remembered, what it would have cost them to be wrong, and —
called out separately, because it is the most useful thing the game can say —
what the player had left lying there.

Two rules it must keep:

1. **It never invents.** Every line is generated from a number the simulation
   actually used. A small memory term produces no sentence about memory.
2. **It never promises.** The closing note always says the same true thing —
   these are weights, not a rule.

It is also honest about the fight ration: when the cycle's appetite for
violence displaced somebody's first choice, WHY says so, rather than listing a
higher-scoring option under "they nearly did this instead" and leaving the
player to conclude the arithmetic is broken.

`Beat.why` is trimmed to the most recent 80 beats by `serialiseGod`, so the
save does not carry nine floats per line of ancient background chatter.

The primer (`Teaching.primer`) is the same rules on one page, from the title
screen or the rail, for players who would rather read. `SKIP TUTORIALS` in the
pause menu switches off both games' teaching at once; `REPLAY TUTORIALS` and
the primer's own button restart it.

## 7. DESCEND

The third-person game was not deleted; it became an intervention. `DESCEND`
costs 7 influence and 12 chaos, drops the player into the existing 3D run
against one character, and advances two cycles while they are down there. The
board is waiting when they come back and the world has moved. Nothing about the
run below is special-cased — only where it returns to.

## 8. Verification

```bash
npm run build && npx vite preview --port 4173 &

npm run test:god          # the vertical slice + the teaching layer (~98 checks)
npm run test:emergence    # does the simulation actually write stories?
```

`test:god` walks the seventeen points of the sprint brief in order against the
real build. `test:emergence` runs many accelerated runs and counts how often
each of the eight target story patterns occurs. It is deliberately not a
pass/fail on one run — emergence is a distribution, and a harness demanding one
specific outcome would just be a script with extra steps.

A representative sample (16 runs, 452 cycles, 13.8 seconds):

```
endings {"triumph":10,"collapse":6}

16/16 runs — the final crisis is a character the simulation produced
16/16 runs — a multi-step grudge forms (A wants B, B wants C)
14/16 runs — someone who ran comes back for the one they ran from
14/16 runs — the player's own investment becomes the problem
14/16 runs — someone grows powerful because the player kept protecting them
10/16 runs — a house leader is replaced or a house comes apart
 9/16 runs — a weak character unexpectedly becomes powerful
 4/16 runs — a former ally becomes an enemy
```

Betrayal is the rarest by design: it needs a treacherous nature, an actual bond
to break and a reason, and a world where everyone turns on everyone would make
the ones that do happen worthless. `WHISPER` exists to buy the reason.

If a pattern stops occurring, improve the simulation — not the presentation.

## 9. Things that are easy to break

- **`Nemesis.sim` is a namespace, like `Nemesis.ai`.** Nothing in `src/ai/`
  may write it and nothing presentational may read it as a fact.
- **`remember()` is still the only writer of a character's memory list.**
  NPC-to-NPC memory types are in `NPC_ONLY` so they do not move
  `playerRelationship`; the god memories deliberately do, because
  `playerRelationship` is now "how they feel about you, the interfering thing".
- **Determinism.** Every roll comes off the run's seeded RNG, whose state is
  snapshotted into the save. The emergence probe depends on it.
- **`decisions` never go into the save** — `serialiseGod()` strips them.
- **The god layer must not grow `Game.ts`.** It attaches through one controller
  and one mode.
- **AI stays optional.** The whole layer, including `test:god`, runs with no
  provider connected. Generated copy is a presentation overlay: it may
  word a dossier, a major beat, a recap, or a legend, but it never writes
  `alive`, `rank`, `sim`, conditions, or feed headlines. See `GodAI.ts`.
- **Teaching is a reader.** Nothing in `Teaching.ts` or `Explain.ts` may change
  the simulation, and nothing may describe it inaccurately to make a neater
  sentence. If a lesson's trigger cannot be measured, measure it — do not
  pattern-match the feed text.

## 10. AI is voice, not authority

`AIContentService` is the only talker. THE LONG GAME uses the same queue,
cache, validation, and fallbacks as the 3D game. `GodAI.ts` decides which
moments are worth a request (named characters, major/legendary beats,
crises, endings, legends, aftermath links, situation stakes) and projects
them into `GodFacts` / `StoryFacts`. The service never awaits on a cycle,
a click, a save, or a screen change.

**Oracle UI surfaces (presentation only):**

| Surface | Authored source | AI overlay |
|---------|-----------------|------------|
| NOW card — situation | `Situation.headline` / `detail` | `situationVoiceFor` in headline slot |
| NOW card — beat pause | `Beat.headline` | voice caption under headline |
| NOW card — aftermath | `AftermathReport` links | `aftermathLinkFor` in body |
| Top bar — crisis | `Crisis.title` | `crisisVoiceFor` as body line |
| Inspect drawer | dossier fallback, memory, thread | portrait, display name, dossier, chronicle, crisis block |
| Feed drawer | `Beat.headline` always | voice caption when expanded or legendary |
| Run end | `ENDING_SUB` / highlights | `recapLineFor` subtitle |
| Book of Legends | `describeLegend` epitaph | `legendVoiceFor` replaces last line |

The 3D run uses the same contract via `StoryAI.ts` (recap beats, timeline,
journey, arcs, encounters) in the hierarchy and death report.

A generation scope is bumped when a run begins, is abandoned, or is replaced.
In-flight results with a stale scope are discarded. Overlay keys include the
facts that produced them, so a promotion or a death does not inherit the
previous wording.

**Tests:**

- `npm run test:god-ai` — enabled, disabled, failure, timeout, malformed copy,
  fallback parity, cache-after-reload, rapid advance, abandon-with-queue, stale
  apply, concurrent events, aftermath/situation/crisis/end/legend surfaces,
  feed headline hierarchy, inspect re-queue, and proof that AI cannot change
  sim state.
- `npm run test:story-ai` — pit-run recap/timeline/arc/journey overlays with
  the same failure and cache contract.
