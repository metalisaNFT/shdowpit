# SHDOWPIT — RECONSTRUCTION

Written 2026-09-02 against the live tree (local `main`, ahead of GitHub `840a56c`).
This is a game-design audit followed by a rebuild. It is not a polish pass and it is not
a bug list. Every claim below was checked by reading the code and by running the real
build headless (`tools/observe.mjs`, added by this pass) and reading what the simulation
actually printed.

---

## A. WHAT SHDOWPIT CURRENTLY IS

The README describes a god game. The code produces a **weather simulator with a betting
window**.

Concretely, one full run with the player doing nothing (`node tools/observe.mjs 32 quiet`):

- 11 named characters at cycle 1. **24** named characters had existed by cycle 23, because
  rabble kill named characters and inherit their name every two or three cycles
  (`Skirmish.rabbleVsNamed` → `Context.elevateRabble`).
- **73** fights ended in flight, **28** territory seizures, **19** "WAS DISPLACED — THE
  HIERARCHY CLOSED AROUND THEM", **9** returns from the dead, **7** house collapses or
  re-formations, in 23 cycles. Territory changed hands more than once per cycle among six
  areas. `fillRanks` undid promotions the same cycle they happened.
- The same pair — `MAZAOCK CAUGHT UP WITH OLMYUG, WHO WOULD NOT STAND AND FIGHT` — printed
  **eleven** times. Revenge never closed.
- The board (OBSERVE) showed `X IS BADLY HURT` in **six of nine** slots for most of the run,
  plus `FERAL SURGE`, `DUNGEON READY`, `HOUSE NEED`, `QUEST URGENT`.
- Influence sat at the 12 cap for 22 of 23 cycles. Chaos stayed at 0.
- A crisis was born at cycle 22 (`THE WAR NOBODY CAN END`) and resolved itself the **same
  cycle** because a house came apart, which houses do every few cycles. Ending: **TRIUMPH,
  zero interventions.**

The same script spending Influence every cycle on the board's top suggestion (`greedy`):
32 interventions, chaos peak 62, ending **COLLAPSE**, crisis "Grimak — 92 wins, 0 losses,
19 kills" (wins inflated by rabble skirmishes that count as duels).

So the actual game is: a world that churns so fast nobody is recognisable, that wins by
itself if you touch nothing and loses if you touch it, whose board is a list of injuries,
and whose only real decision is whether to press ADVANCE. The engineering underneath —
utility scoring, a stepped duel off the real attack tables, per-beat WHY, legends that
reach forward — is real and often good. It is wired into a world that cannot hold a story
long enough for any of it to matter.

---

## B. SCORECARD (1–10, not inflated)

| Category | Score | Evidence |
| --- | --- | --- |
| Core identity | 3 | The god fantasy is designed and documented; the produced experience is watching a feed scroll. |
| God fantasy | 2 | Spending is a losing move; not spending wins. Interventions vanish into churn. |
| Strategic agency | 2 | No forecast, no reliable actors, no target that stays alive long enough to plan around. |
| Decision quality | 2 | BLESS-spam is as good as anything. Nothing has an opportunity cost. |
| Decision density | 3 | One optional spend per cycle; Influence is always full, so it is never a trade. |
| Causality | 4 | WHY panel and `Beat.why` are genuinely good. The aftermath card links are weak (string heuristics). |
| Predictability | 2 | Nothing on the board says what anyone will *likely* do. Personality is invisible except via a label. |
| Uncertainty | 3 | Present, but as flee-noise and rabble RNG rather than as characters surprising you. |
| Emergence | 3 | Chains of events exist in the log but are buried under 40 beats a cycle and rotate cast every 3 cycles. |
| Character autonomy | 6 | The scorer works. Characters do act on grudges, wounds, ambition. |
| Character identity | 2 | Nine rabble elevations per run. 24 names for 11 seats. Titles change every promotion. |
| Relationships | 3 | Bonds exist and are read by the scorer; they change nothing you can see or plan around. |
| Memory | 5 | Memory drives revenge and betrayal scoring. Grunt ids leak into grudge lists (`rev=[g14d0el9]`). |
| Rivalries | 3 | Rivalry = "we fought once". Trimmed to five, everyone is everyone's rival. |
| Factions | 2 | Collapse and re-form constantly. War declared every 2–3 cycles, ended only by dissolution. |
| Territory | 2 | Reassigned by `assignTerritories` to the strongest local every beat; six areas, no geography. |
| Influence | 2 | Regen ≥ 3/cycle, cap 12, cheapest spend 2. Always full. Never a constraint. |
| Chaos | 2 | Literally the spread on `noiseTerm`. A quiet player never sees it. |
| Interventions | 4 | Distinct on paper (13 ids); in play, five of them are "adjust confidence + combat tilt". |
| Information design | 2 | Board = injuries and biome chores. Feed = rabble skirmishes as NOTABLE. |
| WHY system | 7 | The best thing in the layer. Honest, non-inventing, shows the god's marks. |
| Consequences | 3 | Deaths reverse (9 returns/run). Territory reverts. Ranks revert. |
| Crisis structure | 2 | Born at cycle 22–23, often resolves the same cycle. No runway, no escalation you can feel. |
| Run structure | 2 | Four acts author tempo multipliers. There is no midgame. |
| Roguelike variety | 3 | Runs differ in names, not in shape: same churn, same "someone won" or "war ended". |
| Meta progression | 6 | Unlocks are verbs and world shapes, not stats. Correctly designed. |
| Persistent world | 5 | Legends reach forward (relic/bloodline/rumour/grudge/title). Good idea, invisible in play. |
| Nemesis system | 4 | Rich record, but the god run recycles the cast so fast nothing becomes personal. |
| Death | 2 | A death is a 2–3 cycle pause. |
| DESCEND | 4 | Works mechanically; outcome is derived from a snapshot diff in Game.ts and only `killed` writes back. The world moves 2 cycles regardless of what you did. |
| Combat | 6 | The third-person layer is competent (separate audits). Duel.ts is a good headless model. |
| UI/UX | 4 | The oracle layout is sound; what it is fed is noise. |
| Spectacle | 4 | Duel replays exist. Every event has identical weight in the feed. |
| Pacing | 2 | Every cycle is equally loud. 35–50 beats per cycle. |
| Onboarding | 5 | Guided first cycle + lessons are thoughtful; lessons key on prose regexes. |
| Replayability | 2 | Nothing to summarise a run by. |
| Technical architecture | 5 | Sim/presentation split is mostly honoured. `Game.ts` is 7,300 lines and owns god orchestration, descent outcome derivation and the debug API. Two parallel taxonomies (`Beat.kind`, `WorldEvent.type`). |
| **Overall fun** | **2** | Matches the owner's rating. |

---

## C. TOP ROOT PROBLEMS

1. **The world moves faster than a story can form.** Rabble elevation, `fillRanks` target
   counts, `assignTerritories` every beat, house collapse at 0 stability with −8 to −22
   swings per event, returns every 2–3 cycles. Every system that could create a character
   is outrun by a system that replaces them. *This one problem is responsible for more of
   the 2/10 than everything else combined.*
2. **The player is not necessary.** Influence is free, chaos is opt-in, the crisis is born
   too late and dies of its own accord. A quiet world triumphs. There is no threat that
   grows unless the player arranges against it.
3. **Fights don't resolve.** `fleeThreshold` fires before anything decisive; flight leaves
   no state behind (`hiddenUntil` is set by HIDE only, and `reachable()` is never called
   by any action), so the same hunter finds the same runner every cycle forever.
4. **Interventions are undifferentiated in play and unreadable in advance.** Nothing tells
   the player *who* would answer a bounty, *whether* this loyalist would ever act on a
   whisper. The scorer that could answer that exists and is never asked before a spend.
5. **The board is a health readout, not a strategic map.** Situations are generated from
   thresholds on numbers (`injury > 52`, `ambition > 70`), not from tensions (who wants
   whom, who is wavering, who would inherit).
6. **A whole economy nobody plays.** Biomes, materials, quests, dungeons, treasury,
   tribute, deliver, plunder, guard_site, hunt_feral, gather: nine actions, three
   situation kinds, a save field, a test file — and no decision for the player anywhere.
   It exists to be simulated.
7. **Chaos is a noise slider.** The design says "the world becomes harder to control
   because you interfered"; the code says `rng.bell() * (2.2 + chaos*0.09)`.
8. **Rank is a quota, not a status.** `targetCounts()` forces exactly 1/2/4+/4+ per rank
   every beat. A climb is reverted by the hierarchy "closing around" someone within the
   same cycle.
9. **Everything is NOTABLE.** Rabble skirmishes with a kill are `notable`; a named
   captain's death is `major`; a return is `legendary` and happens nine times a run.
10. **DESCEND is a time skip with a snapshot diff.** The board does not know what you did
    down there beyond alive/dead; the world does not react to your presence; the two
    cycles pass identically whether you won or died.

---

## D. PLAYER EXPERIENCE FAILURES

| The player should feel | The player actually feels |
| --- | --- |
| "That bastard remembered what happened ten cycles ago." | "Who is Nuleith? When did Olmyug become a captain?" |
| "I didn't order that; I caused the conditions." | "I blessed him. He fled. He fled again. Somebody I've never heard of took his ground." |
| "I thought I understood this character." | "Everyone flees. Everyone seizes. Everyone returns." |
| "Helping this person created a monster." | "The monster was named at cycle 22 and gone at cycle 23." |
| "I started a war without starting a war." | "THE BLACK HAND AND THE STILL KENNEL ARE AT WAR (again)." |
| "I know exactly why, but I didn't predict it." | WHY works — but the event it explains is one of forty this cycle. |
| "Fine. I'll handle this myself." (DESCEND) | "I went down, killed him, came back; two cycles happened; here are some power deltas." |

---

## E. SYSTEM MAP — where the links are weak or nonsensical

```
Player ──► Interventions ──► Conditions ──► Characters ──► Decisions ──► Relationships
   │            │                │              │               │              │
   │       (4) all read as   (ok) index    (1) replaced    (ok) scorer    (3) bonds change
   │       tilt+confidence;  is fine       every 3 cycles  is honest      scores, not
   │       no forecast                                                    behaviour you see
   │
   ▼
Factions ──► Territory ──► Conflict ──► Consequences ──► Crisis ──► Run progression ──► Persistence
   │            │             │              │              │              │                 │
(2) collapse (2) reassigned (3) 60% flee, (2) death      (2) born at   (2) acts =        (5) legends
& reform     to strongest   no aftermath  reverses;      cycle 22,     tempo multipliers  reach forward
every 3-5    local each     state         rank reverts   self-solves                      but invisible
cycles       beat
```

Strong links worth keeping: Conditions → scorer (`opportunityTerm`, `dangerTerm`),
Decisions → `Beat.why` → WHY panel, `Context.handleDown` (the aftermath branch),
`Duel.ts`, Legends → next world.

---

## F. KEEP / REWRITE / DELETE

| System | Verdict | Why |
| --- | --- | --- |
| Utility scorer (`Utility.ts`, eight parts) | **KEEP** | Correct architecture. Tune weights; add forecast use. |
| `Actions.ts` — fight/social verbs | **REWRITE (trim + retune)** | Keep challenge, attack, revenge, hunt, betray, ally, protect, seize, defend, hide, recover, consolidate, brood, defy, pursue_item. Apply reachability; make flight leave state. |
| `Actions.ts` — gather/delve/plunder/guard_site/deliver/tribute/hunt_feral | **DELETE** | Simulation without gameplay. |
| `NpcQuests.ts` + quest situations | **DELETE** | Same. |
| `BiomeState` in the god cycle (tickBiomes, biome situations, map chips) | **DELETE from god** | Keep the module for the pit's territory laws only if something reads it; otherwise gone. |
| `Skirmish.ts` | **REWRITE** | Rabble fights become silent ambient pressure. Named involvement removed. Elevation only as a rare, deliberate event. |
| `Context.ts` fight/aftermath | **KEEP, retune** | Best story generator. Fix grunt-id leaks, flight consequences, kill shaping. |
| `Autonomy.ts` returns/drift/faction war | **REWRITE** | Returns rare and earned. War declared from grievance, ended by exhaustion/peace. |
| `NemesisManager.fillRanks` in god runs | **REWRITE** | No quota. Rank moves by duel, succession, leadership. |
| `assignTerritories` every beat | **REWRITE** | Territory is owned state; only vacated ground gets a new holder. |
| `Factions.ts` | **REWRITE (stability model)** | Slower erosion, real succession (heir by loyalty/rank, not raw power), peace. |
| `Crisis.ts` | **REWRITE (timing + resolution)** | Born mid-run, grows, needs a body to die or a war to be *won*. |
| `Influence.ts` | **RETUNE** | Scarcity. Regen 2, cap 9, costs 2–6. |
| Chaos | **REWRITE (meaning)** | Keep the number; change what it does: marks lose bite, heretics, unreliable reads, world noticing. |
| `Interventions.ts` | **REWRITE (moveset + forecast)** | Nine verbs with a *reading* — who would answer, and how likely, from the real scorer. |
| `Situations.ts` | **REWRITE** | Tensions with forecasts, not thresholds. |
| `Feed.ts` priorities | **RETUNE** | Rabble → silent. Death major. Return legendary but rare. |
| `Explain.ts` / WHY | **KEEP** | |
| `Aftermath.ts` | **KEEP for now** | Improve once the feed is quiet enough to link honestly. |
| `Legends.ts`, `Unlocks.ts` | **KEEP** | |
| `Teaching.ts` | **KEEP** | Prose-regex triggers must be moved to beat kinds (later). |
| DESCEND (`PitBridge`, Game.beginDescent/afterRunEnds) | **REWRITE later (Phase 7)** | Outcome should be reported by the pit to the sim, not diffed. |
| `Game.ts` god orchestration | **EXTRACT later** | Not a gameplay problem; a maintenance one. |
| Harness assertions that lock churn in (`godtest` "someone rises", emergence `dungeon_cycle`, `biome_pressure`) | **DELETE/REPLACE** | Tests must measure the new game. |

---

## G. TARGET SHDOWPIT

A run is a **short, dense political history of about twelve people**. You learn them in
the first five cycles because they *stay*: a coward who keeps surviving, a loyalist whose
master is a fool, a hunter who would take any price, a traitor one bad cycle from turning.
A threat forms around cycle 10 — a warlord pulling ahead, a house splitting, someone who
came back — and it grows unless the world is arranged against it. You cannot fight it.
You can make the hunter want it, make the traitor's master look weak, put steel in the
coward's hand and watch what a coward does with steel.

Each intervention comes with a **reading**: who would likely answer, who wouldn't, how
sure the god is. The reading is the scorer's own preview, phrased as `LIKELY / MIGHT /
WON'T`, never a percentage. Then time passes and the reading is wrong sometimes, and the
WHY panel tells you exactly why it was wrong, and you learn the person.

Death is permanent nine times in ten. Rank changes because a fight was won or a leader
fell. Ground changes hands once or twice a run per area and everyone remembers who took
it. Influence is scarce enough that every cycle is *spend here or save for the big move*.
Chaos is the world noticing you: your marks start to be doubted, your favourites start to
be resented, and eventually someone says your name out loud.

A run ends in a way you can say in one sentence, and the person who ended it — or the
person who couldn't — goes into the Book and comes back to haunt the next world.

DESCEND is the one time you are in the room. It is expensive, it is loud, and what you do
down there is a fact the board treats as a fact.

---

## H. RECONSTRUCTION ROADMAP (player impact × dependency × risk)

**Phase 1 — THE WORLD HOLDS STILL** (this pass)
- No rank quotas in god runs; rank moves only by duel/succession/leadership.
- Territory is owned state; vacated ground only.
- Rabble skirmishes silent; no rabble-vs-named; elevation deliberate and rare.
- Returns rare (≈1–2 per run), earned by personality + grudge + chaos.
- Flight leaves state: the runner goes to ground and moves; `reachable()` enforced.
- Faction stability slowed; heir by loyalty+rank; peace when leaders aren't rivals.
- Delete the biome/quest/material economy from the god cycle.
- Feed priorities retuned.
- Fix grunt-id leaks into grudge lists.

**Phase 2 — THE PLAYER IS NECESSARY / DECISIONS** (this pass, second half)
- Crisis born at cycle 9–12 with real growth; resolution = body dead or war won.
- Influence scarce. Costs rebalanced.
- Interventions get a **reading** (`forecastIntervention`) from the real scorer.
- Chaos: marks doubted at high chaos; heretic path stays.

**Phase 3 — LEGIBILITY** (this pass, where cheap)
- Situations rebuilt as tensions with forecasts.
- Board hides chore kinds; UI kicker map updated.

**Phase 4 — RUN STRUCTURE & PERSISTENCE** (next)
- Run identity summary at end ("the civil-war run").
- Lesson triggers moved from prose regex to beat kinds.

**Phase 5 — DESCEND INTEGRATION** (next)
- Pit reports outcome events into the sim (kill/spare/humiliate/flee) via `CombatOutcome`.
- Allies react to your presence; the descent target's faction remembers.

**Phase 6 — PRESENTATION / GAME.TS EXTRACTION** (after)

---

## I. FIRST REWRITE

Phase 1 + 2 above, implemented in this pass. Verification is `tools/observe.mjs` (read the
transcript), `tools/emergence.mjs` (rewritten patterns), `tools/godtest.mjs` (updated),
`npm run test:unit`, `tsc`, `vite build`. Target numbers for a quiet run: ≤ 3 rabble
elevations, ≤ 2 returns, ≤ 10 territory changes, ≤ 3 house collapses, 6–12 named beats
per cycle, quiet-play triumph rate well under 50%.
