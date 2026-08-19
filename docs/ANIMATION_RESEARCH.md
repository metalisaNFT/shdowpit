# SHADOW PIT — Animation Pipeline Research Report

Date: 2026-08-18 · Sprint: Animation pipeline + free VFX/animation resources
Status: research complete, implementation follows this document.

---

## 1. CURRENT ANIMATION PROBLEMS (audit)

The game animates code-built box rigs through a **9-value pose struct**
(`bodyX/Y/Z, torso, armR, armL, legR, legL, weapon` — `Player.ts:705`,
mirrored ad-hoc in `Enemy.animate`). Root causes of everything on the
complaint list:

| Symptom | Root cause |
|---|---|
| Weak attack readability | Limbs rotate on **one axis only** (`rotation.x`); a swing cannot arc sideways, chamber, or follow through on a curve |
| Poor weight / anticipation / follow-through | Poses are targets reached by a 0.11 s ease — no keyframed acceleration profile, no overshoot, no settle |
| Awkward movement / sliding | Locomotion is `sin(walkPhase)` on straight legs; no knees, no foot planting, stride never matches ground speed |
| Stiff transitions | Hard pose-key changes cross-faded by one global `BLEND_TIME`; a 32 rad/s arm rate-limiter exists purely to hide snaps from QA |
| Repetitive enemy motion | Every enemy shares the exact same sine gait and one attack pose pair |
| Attacks not matching hitboxes | Visual swing is an independent hand-tuned curve over `swingProgress()`; nothing structurally ties the blade path to the `active` window |
| Orientation issues | Fixed in the last sprint at the rig level (-Z), but every new pose is still hand-authored against that convention with no shared rig standard |

Also audited: `Particles.ts` pools its instanced chips but **allocates a new
material per ring/flash/pillar and a new geometry per slash**, every combat
event (`Particles.ts:184-235`). No weapon trails. Telegraph ring+fill on
enemies is good and is kept.

## 2. RECOMMENDED ANIMATION ARCHITECTURE

**Hybrid skeletal + procedural**, exactly as the brief prefers, in four layers:

1. **Skeletal clips** (CC0, retargeted offline onto our own rig) played through
   `THREE.AnimationMixer` with crossfades — idle, locomotion, dodges, hits,
   deaths, blocks, casts, taunts, knockdown/get-up.
2. **Combat-clocked attack clips**: attack animations do not run on their own
   clock. The mixer action's time is *scrubbed* from the combat state machine's
   phase (`windup/hold/active/recover` → canonical clip time). Hitboxes and the
   blade path can never drift apart, at any attack-speed multiplier, because
   they read the same clock. This is the structural fix for "attacks don't
   match hitboxes".
3. **Animation events**: each combat clip carries an event track
   (`HITBOX_ON/OFF, TRAIL_ON/OFF, SFX, VFX, FOOTSTEP, PROJECTILE_SPAWN,
   TELEGRAPH_START/END, COMBO_WINDOW_OPEN/CLOSE, CAMERA_IMPULSE`) expressed in
   phase space. Combat timing data (`attacks.ts`, `PlayerCombat.timings`)
   and the event track come from the same numbers — one source of truth.
4. **Procedural additive layers** applied after the mixer writes bones:
   torso/head aim at target, sprint lean, directional flinch, low-health
   posture, stagger wobble, breathing/idle variance, personality stances
   (coward lean-away, berserker forward, heavy exaggerated weight, assassin
   low stance, arrogant nemesis minimal reactions), recoil. These make ~30
   clips read as hundreds.

Root motion: source clips are in-place (verified — locomotion tracks have zero
XZ root drift). Lunges stay controller-driven from attack data (`lunge` m/s),
which is the brief's "extract displacement, apply through the controller"
model — displacement authored in data, applied by `PlayerController`/EnemyAI,
never by the clip. Dodge clips' baked root drift is stripped at bake time.

The old procedural system is **replaced**, not wrapped: `Pose`/`blendPose` and
the per-enemy sine gait are deleted. QA instruments (`qaRig()`, pose-snap
detection ≤1.2 rad/frame, `faceDirection()` anchors) are preserved on the new
rig.

## 3. RECOMMENDED FREE ANIMATION SOURCE (primary)

**KayKit — Character Animations (bundled in the Adventurers character pack)**

| Field | Value |
|---|---|
| SOURCE NAME | KayKit Adventurers 1.0 (Kay Lousberg) — includes the full humanoid animation set |
| URL / LOCATION | https://kaylousberg.itch.io/kaykit-adventurers · official mirror **github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0** (obtained from the official GitHub org; `LICENSE.txt` verified in-repo) |
| LICENSE | **CC0 1.0** ("free to use in personal, educational and commercial projects" — LICENSE.txt) |
| COMMERCIAL USE | Yes |
| ATTRIBUTION | Not required ("crediting Kay Lousberg … is not mandatory") — we credit voluntarily in THIRD_PARTY_ASSETS.md |
| REDISTRIBUTION | CC0 = no restriction; we redistribute only baked keyframe data, not the pack |
| FORMAT | GLB/GLTF (+FBX) |
| SKELETON | Clean 23-deform-bone game rig: `root, hips, spine, chest, head, upperarm/lowerarm/wrist/hand/handslot .l/.r, upperleg/lowerleg/foot/toes .l/.r` + baked IK helpers (ignored). **handslot.l/r are purpose-built weapon attachment bones.** Rest pose faces **+Z** (flipped once at bake to our -Z) |
| USEFUL ANIMATIONS | **76 clips in one GLB**, near-total coverage of the required list: `Idle`, `Walking_A/B/C`, `Walking_Backwards`, `Running_A/B`, `Running_Strafe_Left/Right`, `Dodge_Forward/Backward/Left/Right`, `1H_Melee_Attack_Slice_Horizontal/Slice_Diagonal/Chop/Stab`, `2H_Melee_Attack_Chop/Slice/Spin/Stab`, `Block`, `Blocking`, `Block_Attack`, `Block_Hit`, `Hit_A/B`, `Death_A/B`, `Lie_Down`, `Lie_StandUp`, `Spellcast_Raise/Long/Shoot`, `Throw`, `1H/2H_Ranged_Aiming/Shoot/Shooting`, `Cheer`, unarmed punches/kick, jumps |
| IMPORT DIFFICULTY | Low — single GLB, bones named consistently, in-place loops, 30 Hz linear keys |
| THREE.JS COMPATIBILITY | Native (glTF 2.0; verified parseable; three r169 in-repo) |
| RECOMMENDATION | **PRIMARY.** One coherent, stylistically-consistent set from one author; melee coverage (3 distinct 1H slashes, 2H chop/spin/stab, blocks, directional dodges, two hits, two deaths) is exactly this game's need |

Required-list coverage from this one source: IDLE ✓ WALK ✓ RUN ✓ SPRINT
(Running_A rate-matched) STRAFE L/R ✓ BACKPEDAL ✓ DODGE L/R/BACK ✓ ROLL
(Dodge_Forward) LIGHT 1/2/3 ✓ HEAVY ✓ CHARGED HEAVY (2H chop + hold layer)
OVERHEAD ✓ THRUST ✓ (1H stab) HAMMER SLAM ✓ (2H chop, time-warped by slam
data) SPEAR ✓ (stab) BOW ✓ CAST ✓ PARRY ✓ (Block_Attack) BLOCK ✓ PARRY
REACTION ✓ (Block_Hit) LIGHT/HEAVY HIT ✓ STAGGER (Hit_B slowed + wobble
layer) KNOCKBACK (Hit_B + controller shove) KNOCKDOWN ✓ (Lie_Down) GET UP ✓
EXECUTION ✓ (2H stab) DEATH F/B ✓ TAUNT ✓ (Cheer) ROAR (Cheer + head layer)
FLEE ✓ (Running_A + panic lean layer). Gaps are covered by additive layers,
never by disconnected extra clips.

## 4. BACKUP SOURCE + other sources surveyed

**Quaternius — Universal Animation Library (free tier)** — BACKUP

| Field | Value |
|---|---|
| URL | https://quaternius.com/packs/universalanimationlibrary.html · gltf mirror github.com/J-Ponzo/gltf-universal-animation-library (CC0 LICENSE in repo) |
| LICENSE / COMMERCIAL / ATTRIBUTION | **CC0**, commercial yes, attribution not required |
| FORMAT / SKELETON | Single glTF, 46 clips (free tier), 53-joint Rigify-style `DEF-*` mannequin, root-motion `_RM` variants of Roll/Sword_Attack |
| USEFUL ANIMATIONS | Excellent locomotion (walk/jog/sprint/crouch), Roll(+RM), Hit_Chest/Head, Death01, Sword_Attack(+RM), Spell_Simple_*, punches |
| IMPORT DIFFICULTY | Medium (denser skeleton, Rigify bone spaces) |
| RECOMMENDATION | Backup / supplementary locomotion. Melee coverage too thin (one sword attack, no blocks/dodge-directions) to be primary |

Also evaluated:

- **Mixamo (Adobe)** — huge library, auto-rigging. License (Adobe FAQ):
  royalty-free for commercial games, but requires an Adobe ID, is a
  service not a downloadable licensed pack, and redistribution of raw
  assets is not clearly permitted — the baked-keyframe redistribution step this
  pipeline uses would sit in a licensing grey zone. **Avoid** given equal-quality
  CC0 alternatives. (helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- **Kenney — Animated Characters 1/2/3 + Character Assets** (kenney.nl,
  CC0): blocky characters with basic loops; animation set too thin for combat.
  Kenney remains our VFX texture source of choice (§8).
- **Poly Pizza** (poly.pizza): aggregator, per-model CC0/CC-BY (filter
  https://poly.pizza/search/CC0); almost entirely static models — tertiary.
- **OpenGameArt** (opengameart.org): per-asset licenses; hosts mirrors of both
  KayKit animations and UAL — useful as a fallback distribution channel.
- **itch.io free packs**: KayKit/Quaternius official storefronts; per-pack
  licenses vary otherwise — only packs with explicit CC0/edited-license files
  should ever be imported.

**Rule applied:** no asset is imported until a license file or license
statement is verified (both chosen sources carry CC0 text in-repo).

## 5. RECOMMENDED HUMANOID RIG — "SHADOW PIT HUMANOID RIG"

One rig for the player, every enemy and every future nemesis. Documented in
`docs/RIG.md` (created in this sprint):

- **Bone names** (21): `Root, Hips, Spine, Chest, Head, UpperArm.L/R,
  LowerArm.L/R, Hand.L/R, HandSlot.L/R, UpperLeg.L/R, LowerLeg.L/R, Foot.L/R,
  Toes.L/R` — 1:1 with KayKit deform bones (wrist folded into hand at bake), so
  retargeting is a rename, not a remap.
- **Forward axis: -Z** (game-wide: yaw 0 ⇒ -Z, forward = (-sin yaw, 0, -cos yaw)).
  The KayKit +Z rest pose is rotated 180° **once, at bake time** — shipped clip
  data is natively -Z and no runtime compensation exists anywhere.
- **Up axis:** +Y. **Scale:** 1 unit = 1 m; source rest (hips 0.406 m) is
  scaled per-character (player hips ≈ 0.98 m). Proportions (per-segment bone
  lengths) stay seed-driven per nemesis; rotation tracks are proportion-independent.
- **Root bone:** `Root` at ground level (owns yaw). **Hip bone:** `Hips`
  (owns bob/crouch). **Head:** `Head` (aim layer target, faceAnchor lives here).
- **Weapon attachment:** `HandSlot.R` (main), `HandSlot.L` (off-hand/shield) —
  local +Y points along the character's forward at rest, blade axis documented
  in RIG.md.
- Procedural bodies (boxes, masks, horns, capes — the nemesis identity system)
  attach to these bones; `NemesisAppearance` keeps its whole seeded look.
- Debug forward arrow: already pooled in `DebugDraw` (logical lime, visual
  cyan, attack magenta) — extended with root-motion vector in the QA arena.

## 6. RECOMMENDED RETARGETING WORKFLOW

**Offline bake, zero runtime cost** (`tools/bakeclips.mjs`, plain Node, no new
dependencies — parses glTF JSON+BIN directly):

1. Read `Knight.glb` (checked into `tools/anim-src/` **no** — kept out of the
   repo; the baker clones/reads the CC0 source locally, only baked output is
   committed).
2. Select ~28 clips, sample each bone's local TRS at 24 Hz, rename bones,
   fold wrist→hand, rotate 180° to -Z, strip root XZ drift (kept as a
   separate per-clip root-motion curve where wanted), quantize to int16.
3. Emit `src/anim/clipData.ts` (~250–400 KB source, ~80–140 KB gzipped in
   bundle) + rest pose + per-clip metadata (loop, stride m/s, event track).
4. Runtime (`src/anim/`) rebuilds `THREE.AnimationClip`s from that data at
   load — no GLTFLoader, no SkeletonUtils, no network fetch, works offline.

Future drop-ins (more KayKit packs, UAL, artist clips): re-run the baker, or
use `SkeletonUtils.retargetClip` (verified present in three r169) for
runtime experiments — never shipped as a runtime dependency of the game loop.

## 7. THREE.JS TECHNIQUES (verified against the in-repo three r169)

- `THREE.AnimationMixer` + `AnimationAction` crossfades (`crossFadeTo`) — core.
- **Additive blending**: `THREE.AnimationUtils.makeClipAdditive` +
  `AdditiveAnimationBlendMode` (both present in r169) — used for the charged-
  heavy hold shiver; most additive layers are cheaper hand-applied quaternion
  offsets post-mixer (aim/lean/wobble need runtime targets anyway).
- `AnimationMixer` drives plain named `Object3D` bones — **no SkinnedMesh
  required**; rigid boxes bound to bones keep the game's silhouette style and
  skip skinning cost entirely.
- `InstancedMesh` particles (already in `Particles.ts`) extended with pooled
  ring/trail/flipbook meshes; trails via pooled ribbon strips updated from
  `weaponTip()` samples.
- Helper libraries evaluated: `three-stdlib` (duplicate of examples/jsm — not
  needed), animation state-machine libs (`xstate`, `three-anim-*`: 10–100 KB+,
  generic, no combat-clock concept — **rejected**; our ASM is ~300 lines),
  `@gltf-transform/core` (excellent, MIT, but only needed offline and manual
  parsing is 120 lines — **not added**).

## 8. RECOMMENDED VFX SOURCES

**Primary: procedural, generated in-code** (zero downloads, exact palette
control, pooled by construction):

- Canvas-generated sprite textures at boot (soft dot, spark streak, smoke puff,
  crack decal) — 4 small textures shared by every effect.
- Shader/geometry effects: contracting telegraph rings (the countdown IS the
  motion), shockwave tori, ground-crack glow decals, ribbon weapon trails,
  instanced debris chips (existing pool).

**External texture sources verified for optional enrichment** (documented, not
required by the build):

| Source | License | Use |
|---|---|---|
| Kenney Particle Pack — kenney.nl/assets/particle-pack | CC0 | smoke/flare/spark PNGs |
| Kenney Impact/Smoke audio packs | CC0 | impact SFX if audio sprint follows |
| OpenGameArt CC0 filter | per-asset CC0 | flipbooks (explosions) |
| ambientCG / Poly Haven textures | CC0 | crack/ground decals |

Unity/Unreal marketplace "free" packs are **rejected** — their EULAs bind
assets to the respective engine; exporting raw assets to a Three.js game is
exactly the illegal path the brief warns about.

**Toxic-neon adaptation:** all effects are tinted through `data/palette.ts`
signal colours (chartreuse/acid player, cyan parryable, red unblockable,
amber area, ultraviolet execute) — meaning stays king; green is the player's
colour, not the default.

## 9. DEPENDENCIES

- **TO ADD: none.** Runtime uses three r169 (already present). The baker is a
  dev-only Node script with zero packages.
- **TO AVOID:** any runtime GLTF/FBX loading for characters, animation
  frameworks, physics engines for hit reactions, three-stdlib, per-frame
  object allocation. AI runtimes remain forbidden in the bundle (§12).

## 10. ESTIMATED DOWNLOAD SIZE

- Baked clip data: **~250–400 KB source / ~80–140 KB gzipped** added to the
  bundle (measured after bake; hard ceiling 500 KB raw).
- New textures: 4 canvas-generated (0 bytes shipped). New code: ~60–90 KB.
- Nothing else. Total bundle growth target **< 0.5 MB**, no new requests.

## 11. EXPECTED PERFORMANCE IMPACT

- Mixer: ~21 bones × ~40 tracks × (1 player + ≤10 enemies) ≈ trivially cheap
  quaternion lerps; replaces the existing per-frame pose math. Budget: <0.4 ms.
- No skinning (rigid limbs). Shared geometries/materials preserved from
  `NemesisAppearance` caches.
- VFX pools eliminate today's per-event material/geometry allocation (rings,
  slashes, flashes all become pooled with preallocated materials).
- Target unchanged: 60 FPS desktop; regression suites re-run at the end.

## 12. AI SEPARATION CONFIRMATION

Verified in this codebase today:

- The browser bundle contains **no AI models, no AI runtime imports** — the
  game only calls HTTP endpoints (`/api/ai/*` on its own dev server, which in
  turn may call OpenAI or `http://127.0.0.1:11435/v1` locally). `src/ai/*` is
  interface/HTTP-client/settings code only.
- Model weights live outside the game code in `local-ai-engine/` whose
  `.gitignore` excludes `runtime/ models/ cache/ config/ logs/ *.part` — no
  GGUF/safetensors/checkpoints/binaries can enter the repo.
- Provider settings already expose **OFF / TEXT ONLY / FULL** modes and
  **OPENAI / LOCAL / AUTO** providers, "LOCAL AI — NOT INSTALLED" with a
  **DOWNLOAD & RUN LOCAL AI ENGINE** button, and "READY" states when installed.
- The game builds, runs and is fully playable with no key and no local engine
  (procedural names/titles/dialogue; deterministic combat). This sprint
  touches none of that architecture; the final regression re-verifies the
  bundle stays clean (grep of `dist/` for model/runtime references).

## 13. FIRST IMPLEMENTATION SLICE (what gets built now)

Clips wired end-to-end (animation + hitbox + telegraph + VFX + events + state
machine): IDLE, RUN (full locomotion set: walk/run/strafe/backpedal),
LIGHT ATTACK ×3, HEAVY ATTACK, DODGE ×4, PARRY (+parry reaction), HIT
REACTION (light/heavy, directional), STAGGER, DEATH ×2, HAMMER SLAM,
RANGED ATTACK (bow + cast). Plus: knockdown/get-up, execution, block, taunt —
they come free from the same source and existing combat states.

State machine priorities (high→low): DEATH > EXECUTION > KNOCKDOWN > STAGGER >
HIT_REACT > ATTACK/HEAVY_ATTACK/ABILITY > PARRY/BLOCK > DODGE > LOCOMOTION > IDLE.

Test plan: animation/combat QA arena (timescale 0.25/0.5/1× via the existing
`loop.timeScale` hook), on-screen anim state/time/forward/attack/hitbox/root-
motion readout, automated `tools/animtest.mjs` (facing agreement: RUN, ATTACK,
PROJECTILE, HAMMER all on -Z; event/hitbox sync; snap detection), then the
full existing regression suites.
