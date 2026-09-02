# SHDOWPIT II

### Design Bible — v1.0

*A god game about consequence. You never give an order. You only make some futures cheaper than others, and then you watch what people do about it.*

---

## 0 · What this document is

This is the bible: what SHDOWPIT II **is**, what it is **for**, and the laws it may not break. It is not a build plan and not a pitch deck. When a decision comes up and the answer is not obvious, the answer is here — and if it is not, this document is wrong and should be amended rather than worked around.

It assumes a clean start. Nothing is carried over from the first game's codebase. What is carried over is knowledge: five sprints of finding out which of these ideas survive contact with a running world. Those findings appear here as law, not as history.

**Stack:** TypeScript, Three.js, Vite. No engine, no runtime dependencies beyond the renderer. The reason is in §12.

**The one-line pitch:** *You are the god of a buried place. You cannot command anyone. You can only change what they want, what they fear, and what they believe — and then live in the world that makes.*

---

## 1 · The fantasy

### What you are

You are what the Pit grew so that something would be watching. You are not benevolent and you are not evil; you are **interested**. You have no body, no army, no cursor that reaches down and moves people. You have attention, and you have the ability to make a place feel cursed, make a nobody feel seen, put an idea in a frightened man's head at the exact moment it will take root.

Everything that happens in the Pit is done by someone who had their own reasons. Your entire craft is arranging the reasons.

### What the game is about

It is about the gap between what you meant and what happened.

You bless a promising fighter because you want her to take the crown. She takes it. Six ages later her descendants are still killing each other over which of them you actually meant, and none of them have ever heard your name spoken by anyone who was alive when you said it. That is the game.

The thematic spine is **indirect authorship**. Not "am I a good god" — there is no morality meter, there is no ending where you are told what you were. The question the game asks is quieter and harder: *did the world you made turn out to be the one you wanted, and can you still tell?*

### The moment we are selling

A player has been watching for forty minutes. They have not clicked anything in six. They are following one man they marked an hour ago because he had a funny title, through a fight he is going to lose, and when he loses it they will say a name out loud that the game generated and that nobody else on earth has ever heard.

Every system in this document exists to produce that moment more often.

---

## 2 · Pillars

Six. Each one is a constraint before it is a feature. Each carries what it forbids.

### I. Never the outcome. Always the condition.

The god writes **conditions** — timed, sourced, inspectable facts about a person or a place that change how the world scores its options. The god never sets a result. Not who dies, not who rises, not who holds ground, not who fights whom.

> LAW · No god verb may directly write `alive`, `rank`, `power`, `holder`, or a fight's winner. A verb that appears to need this is a verb designed wrong.

This is the load-bearing wall of the whole game. The instant the player can set an outcome, every other system becomes decoration — because why would you arrange a grudge if you could just delete the man. There is exactly one sanctioned exception (§7, RAISE), and it is priced to be a decision the player makes three times in a world, not thirty.

> NOT · A god-mode cheat panel shipped as a feature. Debug tools that set outcomes exist, are clearly marked, and are not reachable in a real world.

### II. Everything that happens has a body, a reason, and a memory.

No abstract events. Nothing "happens to the region". If a house falls, a specific person broke it, for a motive you can inspect, and the survivors remember it in a way that changes what they do next.

> LAW · Any chronicle entry that cannot name its actor and produce the score breakdown behind the decision is a bug, not a flavour event.

This is the difference between a simulation and a random-event generator with good prose. It is also what makes the chronicle worth reading back years later.

> NOT · Weighted random "world events" that fire on a timer and are narrated as though someone did them.

### III. The world is watched, not read.

Every beat has a place in space and a moment in time, and the camera can go there. The feed is a table of contents for the world, never a substitute for it. If the only way to experience something is to read that it happened, we have not finished building it.

> NOT · A scrolling text log as the primary interface. It is the index, not the game.

### IV. A seed is a world.

The simulation is deterministic. The same seed and the same inputs produce the same world, beat for beat, forever. This is not engineering hygiene — it is a feature the player holds. Worlds are shareable as a string. History is scrubbable because it is re-derivable. A story you loved can be replayed, watched from another angle, and handed to someone else.

> LAW · No simulation code may call an unseeded random source, read the wall clock, or touch the renderer. §12 makes this structural rather than a habit.

### V. The game can always answer "why".

At any moment, for any actor, the player can ask why and get three honest layers: **what they did**, **what they wanted**, and **what they believed**. Including the options they rejected and the numbers behind the rejection.

Difficulty in this game comes from the world being complicated, never from the world being concealed. A player who is surprised should be able to become un-surprised in fifteen seconds, and then be smarter.

> NOT · Hidden modifiers, undisclosed odds, or "mysterious" systems used to manufacture depth.

### VI. Descending is the most expensive thing a god can do.

Taking flesh is a real verb with a real price, not a mode toggle on the title screen. It is rare, it is short, it is public, and it changes the god layer whether it goes well or badly.

> NOT · A second full game bolted alongside the first. The action layer serves the god layer. It is never the balance target.

---

## 3 · Anti-goals

What SHDOWPIT II is deliberately **not**, so that no one has to relitigate it:

- **Not a city builder.** You do not place buildings, assign jobs, or manage an economy on the world's behalf.
- **Not a strategy game.** There is no win condition you optimise toward. There are endings, and they are descriptions of what happened, not scores.
- **Not a morality simulator.** No alignment bar, no good/evil ending split, no NPC telling you what you are.
- **Not an idle game.** The world runs without you and does not need you. It also does not pay you for being away. Nothing accrues offline.
- **Not a roguelite with a strategy layer.** The descent is an errand inside a longer story, not the point of the story.
- **Not narratively authored.** There is no written questline, no scripted betrayal, no set-piece. Every story in the game is a reading of what the simulation actually did.
- **Not a game where the AI writes the rules.** Generative content is presentation only, forever, in every direction (§12).

---

## 4 · The loop

### The macro loop

**WATCH → NOTICE → PRESS → LIVE WITH IT → REMEMBER**

1. **Watch.** The world runs. You orbit it, drop into it, follow someone. This is most of the time spent and it must be pleasant with zero input.
2. **Notice.** A pattern surfaces. Someone is climbing. A house is cracking. Two grudges have found each other.
3. **Press.** You spend attention on a condition. You have made a future cheaper. You have not made it happen.
4. **Live with it.** The world metabolises the pressure through people who have their own reasons, and it comes out changed.
5. **Remember.** It enters the chronicle. Weight accumulates. Ages compound. The ground keeps it.

The gap between 3 and 4 is where the entire game lives. Design work that shortens that gap, or makes its outcome more predictable, is usually wrong.

### The session shape

A session is not a run. There is one world, and you return to it.

- **Sit down.** The world is exactly where you left it, paused. A short *where things stood* is available and never forced. Nothing happened while you were away, because nothing runs while you are away — see §3.
- **Orient.** The board surfaces what changed and what is about to.
- **Watch and press.** Long, unhurried. Time controls are the primary verb: pause, real time, fast, and **skip to the next beat that concerns me**.
- **Stop anywhere.** No commitment points, no "just one more cycle" trap engineered into the pacing. The world will be exactly here.

### The world's shape

A world runs in **Ages**. An Age ends when the crown changes in a way the world cannot absorb, when a crisis resolves, or when the Pit's weight exceeds what it can carry. Between Ages the cast turns over; the **ground and the legend do not** (§5, §13).

A world is finished when the player says so. There is an ending, and it is a description: *what the Pit became, and who is remembered for it.*

---

## 5 · The world

### The Pit

A wound in the earth, deep enough to have its own weather. Things that die in the Pit do not entirely leave — that is not a mechanic, it is why the place is the way it is and why resurrection is possible at all.

Nobody in the Pit knows what you are, at the start. They know that something is paying attention. What they build out of that — worship, defiance, an elaborate wrong theology — is theirs, and it changes how your verbs land (§7).

The fiction stays thin and hard on purpose. No lore dumps, no written history, no encyclopaedia of factions. **The only history the game has is the history it made.** A player one hundred hours in should know a great deal about the Pit, all of it derived from things they watched.

### Ground

Ground is a first-class object, not a backdrop. A place carries:

- **Yield** — what can be taken from it, and how depleted it is.
- **Danger** — what is in it that kills.
- **Holding** — who claims it, which is a reading of bonds, not a stored owner (§10).
- **Memory** — what happened here.

Memory is the important one. Ground accumulates the events that occurred on it, and those events change how people feel about standing there. A place where three overlords have died is not a normal place any more. People avoid it, or seek it out to be seen at it, or build there specifically because of what it means. **Ground memory is how a world starts to have geography instead of a map.**

> LAW · Every event is stamped with where it happened, and that stamp is written into the ground's memory. There are no placeless events.

### Ages and what carries

Between Ages: the cast turns over, the crown resets, pressures relax.

Carried forward, always:

- **Ground memory** — literally. Ruins are where things were broken.
- **Legend** — what the Pit remembers about the dead (§6).
- **Your record** — the weight you have accumulated, and what the world believes about you.

Not carried: the living cast, faction structure, active conditions. A new Age is a new generation living in the wreckage of the last one, which is the correct relationship.

---

## 6 · The cast

### What a body is

A person in the Pit is four things. Nothing else is stored about them that a system could quietly forget to use.

1. **Capacities** — what they can physically do. Reach, strength, speed, skill, current injury. This is what a fight reads.
2. **Character** — the stable biases that make them themselves. Ambition, loyalty, cruelty, caution, appetite for a specific thing. Set at birth, moved only by things that would move a person.
3. **State** — what is true of them right now. Standing, wounds, holdings, bonds, conditions on them.
4. **Mind** — memory, and belief. See below; this is the keystone.

### Pressures

A body is driven by five pressures. They rise, they decay, and they compete. They are not resources to maximise — they are discomforts to relieve.

| Pressure | Rises when | Relieved by |
|---|---|---|
| **Safety** | Threatened, wounded, outnumbered, watched by an enemy | Retreat, allies, ground, submission, killing the threat |
| **Standing** | Humiliated, passed over, outshone, forgotten | Being seen doing something, a title, a kill with witnesses |
| **Belonging** | Isolated, betrayed, bereaved | A bond formed or repaired, a house joined, service given |
| **Appetite** | Time, and proximity to the specific thing they want | Getting it. Everyone wants something different and specific |
| **Grievance** | Being wronged, and then being reminded | Revenge, or restitution, or watching the debt collected by someone else |

> WHY · Five is deliberate. A sixth pressure is almost always a special case of one of these wearing a costume, and every one we added past five in the first game turned into a system nobody's decision function actually read.

### Personality is a bias vector, not a script

Character biases scale how each pressure is weighed and how each action is valued. A coward and a zealot in identical circumstances score the same option list differently and pick differently. That is the whole mechanism.

> LAW · There is no branching logic that decides what a character does. Options are enumerated, scored, and the best one wins. If a behaviour is missing from the world, a weight is wrong — never add a special case.

### Bonds

Directed edges between bodies, and between bodies and ground. **Loyalty, debt, grudge, awe, fear, kinship, rivalry.** Each has a strength and a source event.

Bonds are the substrate of everything social. A house is not a record with a treasury — a house is *what we call it* when enough loyalty bonds point at one person (§10). A war is what we call it when two clusters carry mutual grudge above a threshold. Naming these things is a rendering concern. **The simulation only has bonds.**

### Belief — the keystone

**Bodies act on what they believe, not on what is true.**

Every body carries a private, incomplete, frequently wrong model of the world: who is strong, who is loyal to whom, who killed whom, what a place is like, and what the god wants. It is built from three sources:

- **Witness.** What they personally saw. High confidence, decays slowly.
- **Testimony.** What someone told them, discounted by how much they trust the teller and how many hops it travelled.
- **Revelation.** What the god put there directly (§7).

Beliefs are compared against the world only when reality forcibly intrudes — you find out the man you thought was weak is not weak by losing to him.

This one system does more work than any other in the game:

- It makes the god's toolkit meaningful. Shaping belief *is* what a god does. You cannot make a man strong; you can make everyone think he is, and then watch what that does to him.
- It generates the best stories on its own. Reputations outrun reality. Lies become load-bearing. Someone dies for a thing that was never true.
- It makes information a resource. Rumour spreads through bonds at a rate you can affect. A world where nobody talks to each other is a world where nothing propagates.
- It gives the "why" panel its third layer, and the third layer is the one that is interesting.

> LAW · No decision function may read ground truth about another body. It reads the deciding body's belief about them. The only things read truly are the deciding body's own state and the physical facts of where they are standing.

### Memory and the record

Bodies remember specific things that happened to them, tagged with who did it. Memory is what turns an event into a grudge with legs, and what makes a character's account of themselves inconsistent with the chronicle in interesting ways.

> LAW · One writer for memory, one shape for a memory entry, and the display text for every memory type is exhaustive — an unhandled type is a compile error, not an empty string in front of a player.

### Death, return, and legend

Death is normal and cheap. A named body dying is a load-bearing event: it redistributes bonds, spikes grievance in everyone who cared, frees a rank, and writes itself into the ground.

**Return** exists because of what the Pit is. It is rare, it costs the returner something visible, and it is a theological event — people who watched someone come back believe different things afterwards.

**Legend** is what survives a body. A dead character is not deleted; they become a fixed point that the living hold beliefs about. Being killed by a legend means something. Holding a legend's ground means something. Legends are the connective tissue between Ages.

---

## 7 · The god

### The two resources

**ATTENTION** is what you spend. It regenerates from being noticed — worship, awe, witnessed manifestation. A god nobody thinks about is a god who cannot afford to act, which produces the correct pressure: you must occasionally be *seen* to stay able to work.

**WEIGHT** is what you accumulate. Every act bends the world; the bend does not fully relax. High weight makes the world less predictable, not more hostile: prophecy destabilises, beliefs about you diverge and harden, heresies form, and the ending you get is one only a heavy world produces.

> WHY · Weight is not a punishment meter. It is what makes over-management a *style* with consequences rather than a mistake. A player who bends the world constantly should get a wilder, stranger world — not a worse score.

### The devotion band

The Pit's relationship to you moves along a band, and where it sits changes what your verbs cost and how they land:

**UNKNOWN → AWE → DEVOTION → DEPENDENCE → FANATICISM → HERESY**

- **Unknown / Awe** — cheap manifestation, weak revelation. Nobody knows what you want, so nobody acts on it.
- **Devotion** — the working band. Revelation lands. Prayers arrive. Verbs cost least here.
- **Dependence** — they stop acting without you. Cheap to steer, but the world gets boring, which is the real cost.
- **Fanaticism** — they act on what they *think* you want, which is not what you want. Verbs land harder than intended.
- **Heresy** — a counter-belief takes hold. Some bodies now resist revelation outright, and a few actively work against what they read as your will.

The sweet band is deliberately narrow and drifts on its own. This is the game's difficulty curve and it is made of belief, not numbers.

### The verbs

Nine. Each has a cost, a failure mode, and something it cannot do.

| Verb | What it writes | Fails when | Never |
|---|---|---|---|
| **SIGN** | A manifestation. Costs nothing but is seen; raises awe and attention regen | Overused — a common miracle stops being a miracle | Changes anything mechanical |
| **WHISPER** | A belief, into one mind | They distrust you, or it contradicts something they witnessed | Compels an action |
| **OMEN** | A belief, into many minds in a place | Imprecise; propagates unevenly and mutates in retelling | Targets a specific person |
| **MARK** | Raises how legible a body is — their deeds get witnessed and retold | Attention is not always good attention | Changes their capacities |
| **VEIL** | Lowers legibility. They stop being noticed | Protects and buries in equal measure | Makes them safe |
| **BLESS / BLIGHT** | A condition on **ground**: yield, danger, or meaning | Ground is slow; people take time to notice and longer to move | Targets a body |
| **ANSWER** | Grants what someone prayed for, as a condition | Creates expectation. Answered prayers are remembered and repeated | Grants something not asked for |
| **LAW** | A standing condition on the whole world that reweights everyone's scoring | Expensive, slow to take, and generates heresy in those it costs most | Is obeyed. It is pressure, not physics |
| **RAISE** | Returns a specific dead body to life | — | — |

**RAISE is the single sanctioned violation of Pillar I.** It sets an outcome. It is priced in weight, not attention, so it cannot be ground out; the world always notices; and a raised body knows. It exists because a god who cannot do the one thing gods are for is a bad fantasy, and because paying an enormous price for it is a better story than never having the option.

**DESCEND** is the tenth verb and has its own section (§9).

### Prayer

Bodies pray. A prayer is generated from a body's pressures and their belief about you — it is a request, in their words, for the thing they actually need.

Prayer is the world's interface to the player, and it is the best one we have:

- It makes the world **ask**, which is a fundamentally different feeling from scanning a board for something to do.
- Answering is cheaper than acting unprompted, which rewards responsiveness over planning.
- Answering **binds**. They expect it. They tell people. The prayer rate goes up, and now you are running a religion.
- Ignoring prayers is a legitimate strategy with a legitimate cost — devotion drifts down, and eventually somewhere else in the band.

### The Ledger

Always one key away, never a mode: for any body, at any moment, the full breakdown of their last decision. Every option that was on the table, every scoring component, what they believed at the time, and what they would have done if one belief had been different.

> WHY · In the first game this panel was the best thing in it, and it was a debug view. In a game whose entire subject is causality, the tool for reading causality is not a debug view. It is the game.

---

## 8 · Watching

This is the section that makes SHDOWPIT II a different game from its predecessor, and it is not a UI concern. It is a design pillar with a budget.

### One world, one camera

There is no god screen and no game screen. There is **the Pit**, and a camera that can be anywhere from high above it to over someone's shoulder. Zooming is continuous, and it is the primary navigation verb.

- **High** — the whole Pit. Bodies are motes of their accent colour. You read movement, mass, and where the light is.
- **Mid** — a district. Silhouettes with legible posture. You can tell a fight from a conversation from a march.
- **Close** — real, rigged bodies at real scale, animating properly, in the actual place the simulation says they are.

> LAW · Level of detail changes what is drawn, never what is simulated. A fight resolves identically whether the camera is on it or twelve hundred metres above it. The first game already simulated real duels offscreen; the difference here is that you can go and look.

### Following

Pick a body. The camera becomes their day. You go where they go, see what they see, and — critically — the **belief panel shows you what they think is going on**, which is frequently wrong and always more interesting than the truth.

Following is the bridge to descending. The player who has followed someone for twenty minutes is the player who will pay to inhabit them.

### Threads

A **thread** is the game's unit of story: a grudge, a rise, a bond under strain, a house coming apart. The game detects them from the simulation (§10) and offers them.

Follow a thread and the camera cuts between its beats as they happen — a director for one story, running live. This is the "just one more" surface, and it is made of things the world genuinely did.

### Time

Four controls, and the fourth is the important one:

- **Pause** — everything, including the world, stops. The Ledger still works.
- **Real time** — a body walks across a district in the time it takes to walk across a district.
- **Fast** — days per minute. The camera stays where you put it.
- **Next beat** — skip forward to the next thing *you* would care about, ranked by what you have marked, followed, prayed over, or invested in.

> WHY · "Next beat" is what makes a long world watchable. Fast-forward asks the player to keep watching for something to happen. Next-beat takes them to it.

### The chronicle is a place

Events are pinned in space and time. The chronicle is not a list you read — it is a layer you turn on over the world, and every entry is a location you can fly to and a moment you can scrub to.

### Replay

Because the world is a pure function of its seed and inputs (§12), **history is re-derivable**. This is not a recording; it is the world being run again.

- Scrub the timeline. Watch a fight you missed, from a different angle.
- Share a seed. Someone else gets your world, exactly, and can diverge from any point.
- **Export a thread as a replay** — a seed, a time range, a camera path. The smallest shareable unit of "look what happened in my world".

### Sound

The world is heard before it is seen. Distant fighting has a direction. Chanting rises where you are worshipped and stops where you are not. A named body's approach has a motif. Turning the camera changes the mix, because the mix is spatial and comes from the simulation.

> NOT · Ambient loops chosen by region type. The soundscape is generated from what is actually happening in earshot.

---

## 9 · Descending

Secondary by design, and better for it.

### What it is

You take a body. Not a spawned avatar with your own stats — **an existing person in the world**, with their capacities, their reputation, their enemies, their bonds and their unfinished business. If you inhabit a coward, you are driving a coward's body, and everyone who meets you meets the coward.

The alternative — **manifesting** a body of your own — exists, costs far more, and is the loudest possible theological event.

### What it costs

- A large amount of **attention**, and it does not regenerate while you are down there.
- **Weight**, immediately.
- Everything that happens to that body while you are in it is **permanent and public**. The world watched.

If you die in the flesh, the world watched a god die. Heresy spikes. A cult forms around the corpse. This is one of the most interesting states the world can be in and we are not going to protect players from reaching it.

### The shape of a descent

**An errand, not a career.** Ten to twenty minutes. One purpose, one place, one way back out. You go down because something can only be done with hands:

- Kill a person the world was never going to kill.
- Take a specific thing from a specific place.
- **Be seen.** A god who walks among them moves belief more than any omen — and everyone who witnesses it is changed by it.

### The action layer's laws

The first game earned these the hard way. They are design law, not tuning:

> LAW · **Colour is a channel with one meaning per colour, everywhere, in both layers.** A player learns cyan once.

> LAW · **Telegraph anticipation has a hard floor.** Below the time a human needs to see, decide and act, difficulty is a lie. Difficulty comes from combination and delay, never from taking reaction time away.

> LAW · **Movement is always an answer.** There is no attack that a correctly-timed dodge does not beat.

> LAW · **Posture, not health, is what breaks a fight open.** Chip damage is attrition; breaking someone's guard is the event.

> LAW · **Feel is tuned at full framerate on real hardware.** Numbers tuned inside a headless harness are unvalidated numbers.

### What it does to the god layer

A descent is not a side activity that resets. It writes conditions, memories, bonds and ground memory like anything else — more heavily, because everyone was watching. The god layer must be *visibly different* when you come back up. If a player cannot tell from the board that a descent happened, the descent was not worth building.

---

## 10 · Making emergence actually happen

The failure mode of a simulation game is not that it is too simple. It is that it accumulates authored systems that never influence anything, and nobody notices because there is no negative signal when a system silently does nothing.

This is not hypothetical. In the first game, an entire quest system assigned and completed errands that no decision function ever read — so the whole dungeon layer, several thousand lines of it, never fired once in a complete world. Separately, resurrection was gated on a counter that could not advance on the path it was checked from, so nobody ever came back from the dead outside one specific mode. Both had shipped. Both looked fine.

Three rules exist to make that class of bug impossible rather than unlikely.

### Derived over stored

Factions, wars, quests, dynasties, economies, rivalries — these are **readings** of bodies, ground, bonds and conditions. They are named at the display layer. They do not get their own parallel state that can drift out of sync with the thing it describes.

> LAW · A system may not store a fact that is derivable from the primitives. If a house has a treasury, the treasury is materials held by its members, not a number on the house.

A system that is a description cannot fail to fire, because there is nothing to fire.

### Every system feeds the decision engine

> LAW · Nothing enters the simulation that does not change what somebody decides. A subsystem with no path into a scoring function is cut, no matter how much of it is written.

Before a system is considered done, there is a demonstration: a body who decided differently because of it, with the Ledger open showing the term.

### Emergence is measured as a distribution

The world runs headless (§12), which means it runs a thousand times in CI. We do not test that a story happens; we test the **rate** at which each target story shape occurs across many worlds.

The shapes we are hunting — and the list is a design artefact, not a test file:

- A nobody becomes the thing everyone is afraid of.
- Someone who ran comes back for the person they ran from.
- An ally turns, for a reason you can trace.
- A house comes apart over an inheritance nobody agrees on.
- Your own investment becomes the problem.
- Someone rises specifically because you protected them, and it goes wrong.
- Two people who have never met end up in a war about you.
- A belief that was never true gets someone killed.
- Ground stays dangerous for three Ages because of one thing that happened there.
- Somebody is remembered wrong, and the wrong version is the one that lasts.

> LAW · If a shape stops occurring, we fix the simulation. We never fix the presentation to imply it happened.

---

## 11 · Look and sound

### Visual law

**Colour is a gameplay channel.** Scenery colours are ash, wet stone, cold metal, and dark — they may never compete with a signal. Signal colours mean exactly one thing each, in every layer of the game, forever.

The palette is small on purpose and its meanings are learned once. Adding a signal colour is a design decision with a cost, taken deliberately, never because something looked good.

### Bodies

Bodies are minimal, geometric, and built from one rig at one set of proportions. **Variety comes from what is attached, not from bone lengths** — heads, masks, horns, capes, scars, stolen gear. A player must be able to recognise a specific named person at mid-zoom by silhouette and accent alone, and that requirement drives the whole character art direction.

### The Pit

Vertical, layered, lit from a hole in the sky. The eye should always be able to find *up*. Districts read differently by material and silhouette, not by tint — a place is distinguished by what it is built of, not by being the blue area.

The most important environmental storytelling is **ground memory made visible**: a place where an Age ended looks like it. Ruins are literal, positioned, and dated.

### Audio

Three layers, all diegetic and all spatial:

1. **The Pit** — the room tone of a huge enclosed place. Distance, depth, water, wind through a hole.
2. **The crowd** — generated from what is happening. Fighting, chanting, work, silence. Silence is a signal.
3. **The signal** — the small set of sounds tied to mechanics: a bond breaking, a prayer arriving, weight settling. Rare and unmistakable.

> NOT · A soundtrack that tells the player how to feel about a thing they are watching. Music is scarce and reserved for the moments the world itself marks.

---

## 12 · Technical law

Only the parts that are design commitments. Architecture detail lives elsewhere; these six are here because breaking them breaks the game rather than the code.

**1. The simulation is a pure function.** `(state, seed, inputs) → next state`. It imports no renderer, no DOM, no clock, no unseeded randomness. This is what makes determinism, replay, seed sharing, headless emergence testing and the Ledger all the same feature instead of four features.

**2. One RNG, in named streams.** Every stochastic call draws from a named stream. Adding a new system must not shift the history of every existing world.

**3. The renderer is a subscriber.** It reads simulation state and draws it. It may not write. Turning off rendering entirely leaves a world that still runs — which is how we run a thousand of them.

**4. The simulation runs off the main thread.** The world thinking must never be able to stutter the world being watched.

**5. Generative AI is presentation only, in both directions.** It may name, describe, narrate, and illustrate. It may never decide anything mechanical, and nothing it produces may be read back into the simulation as fact. Every generated claim is validated against what the simulation actually recorded before a player sees it — a prompt instruction is a request, not a guarantee. Local-first, offline-capable, and the game must be complete and excellent with every AI feature switched off.

**6. Testability is a design constraint, not a phase.** A design that cannot be verified headlessly is a design that will rot in the dark. If a new system cannot be observed firing from a test, it is not finished.

---

## 13 · What compounds

The player returns to a world. Across worlds, three things compound — and none of them are a power upgrade, because a god who gets numerically stronger is a god playing a different game.

**The Book.** Every named body the Pit has ever produced, across every world, with what they did and how they are remembered. It is the player's actual save file in the sense that matters: a hundred hours in, this is the artefact they would be sad to lose.

**Understanding.** The real progression. A player who has run four worlds knows what marking someone does, knows the shape of the devotion band, knows that answering a prayer is never free. That is learned, not unlocked.

**Verbs, sparingly.** A small number of god verbs are earned by *doing something in a world*, not by spending points — LAW becomes available the first time a world reaches devotion without you having whispered to anyone, and so on. Every one of them is reachable in a player's **first** world; the trigger is an act of understanding, not an accumulation. What compounds is that a returning player knows how to reach them.

> NOT · Currency carried between worlds. Not a skill tree. No verb, stat or bonus that a first world cannot reach. World five is not easier than world one — only the player is better at it.

---

## 14 · First proof

The first thing built is not a slice of the game. It is the **argument** that the game works, and it must be falsifiable.

**Build:** forty bodies. One district. Bonds, the five pressures, belief, the decision engine, the Ledger, and a camera that goes from high to shoulder. No descending, no factions as a named system, no art beyond primitives and accent colour, no AI, no audio.

**Prove, with people who are not us:**

1. A player watches for twenty minutes without being told what to do, and does not get bored.
2. Unprompted, they name three characters and say what those characters want.
3. Something happens that surprises them, they open the Ledger, and afterwards they can explain why it happened — correctly.
4. They ask for a verb before they are given one. (This tells us which verb to build second.)

If 1–3 do not happen, the problem is the simulation and no amount of the rest of this document fixes it. **Nothing else gets built until they do.**

---

## 15 · Risks and known traps

Every one of these has already happened once. They are listed as things to watch for, with the countermeasure that actually worked.

**The dead system.** A subsystem that is written, wired, tested and never influences a single decision. → §10. Nothing enters the sim without a path into a scoring function, demonstrated with the Ledger open.

**The monolith.** Orchestration accretes into whichever file is easiest to reach until that file is a quarter of a megabyte and nothing can be tested in isolation. → The simulation may not import the renderer. That single rule prevents the specific way it happened before.

**Undetermined history.** Unseeded randomness scattered across dozens of files makes worlds unreproducible, bugs unrepeatable, and replay impossible to add later. → §12. This is unfixable retroactively, which is why it is law from the first commit.

**Tuning in the dark.** Feel numbers tuned inside a headless harness running at eight frames a second are numbers that have never been felt. → Simulation is tuned headless and tested headless. Feel is tuned at full framerate, on hardware, by a person with hands on it.

**The harness that lies.** A test suite that races the game rather than measuring it produces red checks on a healthy build and, worse, green checks on a broken one. Assert on events the simulation records, never on a sighting caught by a poll. Never sleep and hope. A red check is a hypothesis, not a finding.

**Legibility collapse.** Every new signal colour, overlay and simultaneous telegraph costs the player's ability to read the screen. Adding to the visual language requires taking something out.

**The spreadsheet god.** The slow drift toward a board of cards and a scrolling feed, because those are easier to build than a world you watch. → §8 has a budget. Watching is not the polish phase.

**Width instead of depth.** Twelve shallow systems always look more impressive in a changelog than three deep ones, and always produce a worse game. When in doubt, deepen the feedback loops in what exists.

---

## 16 · Glossary

**Age** — a generation of the world's cast. Ends when the crown or a crisis resolves. Ground and legend carry over; the living do not.

**Attention** — the god's spendable resource. Regenerates from being noticed.

**Belief** — a body's private, incomplete model of the world. What they act on. Frequently wrong.

**Body** — a person. Capacities, character, state, mind.

**Bond** — a directed relationship edge: loyalty, debt, grudge, awe, fear, kinship, rivalry.

**Condition** — a timed, sourced, inspectable fact attached to a body or ground that changes scoring. The only thing the god writes.

**Descent** — inhabiting a living body for a short, public, expensive errand in third person.

**Devotion band** — where the Pit's belief about the god sits, from unknown to heresy. Changes what verbs cost and how they land.

**Ground** — a place. Yield, danger, holding, memory.

**Ledger** — the always-available breakdown of any body's decision: what they did, what they wanted, what they believed, what they rejected.

**Legend** — what survives a dead body. A fixed point the living hold beliefs about.

**Pressure** — one of the five discomforts that drive a body: safety, standing, belonging, appetite, grievance.

**Prayer** — a request generated from a body's pressures and their belief about the god.

**Thread** — a detected story in progress. The unit of following.

**Weight** — accumulated bending of the world by the god. Makes the world stranger, not harder.

---

*SHDOWPIT II Design Bible v1.0. Amend this document rather than working around it.*
