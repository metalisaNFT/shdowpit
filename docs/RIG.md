# THE SHADOW PIT HUMANOID RIG

One skeleton for every humanoid in the game — the player, every enemy
archetype, every Nemesis, and every future character. Implemented in
`src/anim/Rig.ts`; animated by `src/anim/Animator.ts` with clips baked by
`tools/bakeclips.mjs` into `src/anim/clips.json`.

## Hierarchy and bone names

```
Root                          ground level; owns yaw + uniform scale
 └─ Hips                      clips write position (bob) and rotation
     ├─ Spine ─ Chest ─ Head
     │            ├─ UpperArm_L ─ LowerArm_L ─ Hand_L ─ HandSlot_L
     │            └─ UpperArm_R ─ LowerArm_R ─ Hand_R ─ HandSlot_R
     ├─ UpperLeg_L ─ LowerLeg_L ─ Foot_L ─ Toes_L
     └─ UpperLeg_R ─ LowerLeg_R ─ Foot_R ─ Toes_R
```

20 bones. Names are the contract: `THREE.AnimationMixer` binds tracks by
these exact node names. Bones are plain `Object3D`s (rigid attachment, no
skinning cost — the game's box-limb style needs none).

- **Root bone:** `Root` — position + facing yaw + character scale. Nothing
  else ever rotates the character.
- **Hip bone:** `Hips` — the only bone with an animated position (vertical
  bob, weight shifts). Parent is `Root`, so hips-space == character space.
- **Head bone:** `Head` — aim/look layer target; `faceAnchor`/`nose` QA
  markers hang here at local -Z.
- **Hand attachment:** `Hand_L` / `Hand_R` (wrist folded in at bake).
- **Weapon attachment points:** `HandSlot_R` (main hand), `HandSlot_L`
  (off-hand: bows, shields). At rest, slot-local **+Y points along the
  character's forward** — a weapon modelled with its blade along +Y sits
  correctly. Enemy bows mount on `HandSlot_L`.
- **Foot bones:** `Foot_L/R` + `Toes_L/R` (foot roll in locomotion clips).

## Axes, forward, scale

- **FORWARD IS -Z.** Game-wide convention: yaw 0 ⇒ facing -Z, forward =
  `(-sin yaw, 0, -cos yaw)`, yaw toward a point = `atan2(-dx, -dz)`. The
  player model, enemy models, animation data, attack arcs, projectiles and
  hitboxes all share this one convention (`combat/Hitbox.ts`).
- **Up is +Y.** Ground plane is XZ, y=0 at the feet.
- **Scale:** source rig units; head top at rest = 1.40 units. `Root.scale`
  is the ONLY size control: player 1.5 (≈2.1 m), enemies
  `1.42 × archetype × seeded variation × rank`. Weapon meshes divide by the
  rig scale so their WORLD size always equals the weapon def's blade length
  — the visual never lies about gameplay reach.
- **Bone offsets are identical for every character.** That is what makes
  every baked clip valid on every body. Character variety (chunky heavies,
  thin archers, heads, masks, horns, capes, scars) lives entirely in the
  meshes attached to the bones — `NemesisAppearance.buildEnemyRig` — never
  in moving the bones.

## The one 180° — and where it lives

The CC0 source pack (KayKit) is authored facing **+Z**. The flip to -Z
happens **once, in `tools/bakeclips.mjs`**, as a *conjugation* of every
joint (`q' = F q F⁻¹`, `t' = F t`, F = 180° about Y). Conjugating the whole
skeleton — not just rotating the hips — turns the geometry AND keeps every
bone's local axes aligned with the character, so head-local -Z still points
out of the face and mesh authoring needs no compensation.

**Nothing at runtime compensates for orientation. Never add a 180° yaw
anywhere else.** If a new feature needs a "front", it goes on -Z in bone
space. The regression tests that keep this honest: `tools/animtest.mjs`
section A (run/attack/projectile/hammer-slam facing agreement, asserted
against the rendered scene graph via `faceDirection()`), plus `tools/qa.mjs`.

## Animation layers (src/anim/Animator.ts)

1. **Locomotion** — Idle / Walk / WalkProud / Run / StrafeL / StrafeR /
   WalkBack blended by velocity in the character frame, all phase-locked to
   one shared gait cycle whose rate tracks ground speed (feet grip the
   floor). `WalkProud` is the arrogant-nemesis walk.
2. **Actions** — full-body states with strict priorities
   (DEATH > EXECUTION > KNOCKDOWN > BROKEN > STAGGER > HIT_REACT >
   HEAVY_ATTACK/ATTACK/ABILITY > PARRY > DODGE > BLOCK > TAUNT >
   LOCOMOTION > IDLE). A lower state can never interrupt a higher one.
   **Combat actions are scrubbed**: the combat state machine's phase drives
   clip time through the baked strike anchor (`impactT`), so the blade and
   the hitbox share one clock at any attack speed — see
   `Animator.scrubAttack` and `clips.json` metadata.
3. **Additive** — procedural offsets applied after the mixer: chest/head aim
   at target, velocity lean, directional hit flinch (spring), personality
   stances (coward lean-away, berserker forward+twitch, assassin crouch,
   heavy weight, arrogant `proudWalk` + reduced flinch), low-health slump,
   stagger wobble, held-attack shiver, breathing, the Void-Needle off-hand
   throw overlay.
4. **Events** — `src/anim/AnimEvents.ts` defines the reusable attack
   timeline (TELEGRAPH → WHOOSH → TRAIL/HITBOX_ON → HITBOX_OFF →
   COMBO_WINDOW) built from the same timing numbers combat runs on, plus
   gait footstep phases. `tools/animtest.mjs` asserts the timeline equals
   the live combat windows.

## Root motion policy

Clips are baked in-place (source root/hips XZ drift is stripped; dodge root
curves are kept per-clip as `rootMotion` data but not applied by the mixer).
All displacement — dodge bursts, attack lunges, knockback — goes through the
character controllers, driven by combat data. Controlled root motion, never
clip-driven position.

## Adding a clip

1. Drop the CC0 source GLB in `assets-src/` (license file beside it, entry
   in `THIRD_PARTY_ASSETS.md`).
2. Map it in `CLIP_MAP` in `tools/bakeclips.mjs`; run
   `node tools/bakeclips.mjs`.
3. Reference the baked name from `Animator`/`Player`/`Enemy` state mapping.
4. `npm run build && node tools/animtest.mjs` — facing + sync tests must
   stay green.
