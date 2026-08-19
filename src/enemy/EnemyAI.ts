/**
 * Enemy behaviour: a plain state machine, no pathfinding.
 *
 * Deliberately simple, per the brief — good *encounters* matter far more than
 * clever navigation. The interesting behaviour comes from personality,
 * relationships and who else happens to be standing there.
 */

import * as THREE from 'three';
import type { Arena } from '../world/Arena';
import type { Player } from '../player/Player';
import { getPersonality } from '../data/personalities';
import { Enemy } from './Enemy';
import { chooseAttack } from '../data/attacks';
import { anticipationFor, ENEMY } from '../data/balance';
import type { CombatDirector } from '../combat/CombatDirector';
import { rankIndex } from '../nemesis/Nemesis';

export interface AIContext {
  player: Player;
  enemies: Enemy[];
  arena: Arena;
  /** seconds */
  dt: number;
  /** gates how many enemies may commit to an attack at once */
  director: CombatDirector;
  /** drives telegraph pressure as the world gets older */
  worldAge: number;
}

const SEPARATION_RADIUS = 2.4;

const tmpMove = new THREE.Vector3();
const tmpPos = { x: 0, z: 0 };

export function updateEnemyAI(e: Enemy, ctx: AIContext): void {
  if (!e.alive) return;
  const { player, arena, dt } = ctx;
  const pers = getPersonality(e.nemesis.personality);

  const staggered = e.combat.state === 'stagger' || e.combat.state === 'knockdown';
  const swinging = e.combat.attacking;

  /* ---------------- target selection ---------------- */
  if (e.rivalTarget && (!e.rivalTarget.alive || dist(e, e.rivalTarget) > 40)) e.rivalTarget = null;
  if (e.protectTarget && !e.protectTarget.alive) e.protectTarget = null;

  const targetPos = e.rivalTarget ? e.rivalTarget.position : player.position;
  const d = Math.hypot(targetPos.x - e.position.x, targetPos.z - e.position.z);
  const toPlayer = Math.hypot(player.position.x - e.position.x, player.position.z - e.position.z);

  // Head/chest tracking for the animation layer: watch whoever we fight.
  e.aimAt = d < 26 && (player.alive || e.rivalTarget) ? targetPos : null;

  /* ---------------- should they break? ---------------- */
  const hpFrac = e.hp / e.maxHp;
  const flee = e.fleeThreshold;
  if (e.huntedByPlayer) {
    e.escaping = false;
  }
  if (!e.escaping && !e.huntedByPlayer && flee > 0 && hpFrac <= flee && e.stateTime > 1 && !e.introHold) {
    // Give it a moment of hesitation so it does not look scripted.
    if (Math.random() < 0.6 * pers.survival * dt * 4) e.escaping = true;
  }

  /* ---------------- state resolution ---------------- */
  if (staggered) {
    e.state = 'stagger';
  } else if (e.escaping) {
    e.state = 'escape';
  } else if (e.introHold || e.pendingIntro) {
    if (e.pendingIntro && e.entranceKind !== 'immediate' && e.entranceKind !== 'resurrection') {
      e.state = 'approach_intro';
    } else {
      e.state = 'idle';
    }
  } else if (swinging) {
    e.state = 'attack';
  } else if (e.rivalTarget) {
    e.state = 'attack_rival';
  } else if (e.protectTarget && toPlayer > 6) {
    e.state = 'protect_ally';
  } else {
    const aggro = aggroRange(e);
    if (toPlayer < aggro && player.alive) {
      e.state = e.named && e.nemesis.personality === 'hunter' ? 'hunt_player' : 'chase';
    } else if (e.state === 'chase' || e.state === 'hunt_player') {
      if (toPlayer > aggro * 1.9 || !player.alive) e.state = 'patrol';
    } else if (e.state !== 'patrol') {
      e.state = 'patrol';
    }
  }

  /* ---------------- movement ---------------- */
  tmpMove.set(0, 0, 0);
  let wantSpeed = 0;
  let faceTarget: { x: number; z: number } | null = null;

  switch (e.state) {
    case 'stagger':
      e.intent = 'none';
      break;

    case 'attack': {
      // Small committed step during the swing; tracking depends on adaptation.
      const track = e.mods.trackStrength;
      e.intent = 'pressure';

      // A planned feint fires partway through anticipation: the telegraph
      // starts honestly, then nothing arrives. Only ever pre-planned at
      // startSwing — never a reaction to what the player is doing.
      if (e.feintPlanned && e.combat.state === 'windup' && e.combat.windupProgress() > 0.45) {
        e.feintPlanned = false;
        if (e.combat.feint()) {
          ctx.director.release(e.uid);
          e.hesitateTimer = 0.25 + Math.random() * 0.3;
        }
      }

      if (e.combat.state === 'windup') {
        e.faceToward(targetPos.x, targetPos.z, dt, 3.5 * track * 2);
        if (!e.weapon.ranged && d > e.weapon.reach * 0.8) {
          tmpMove.set(targetPos.x - e.position.x, 0, targetPos.z - e.position.z).normalize();
          wantSpeed = e.effectiveSpeed * 0.4;
        }
      } else if (e.combat.state === 'active') {
        const lunge = e.combat.current?.lunge ?? 0;
        tmpMove.set(-Math.sin(e.facing), 0, -Math.cos(e.facing));
        if (lunge !== 0) {
          // A charge or a backstep is the attack. Sign carries the direction.
          if (lunge < 0) tmpMove.multiplyScalar(-1);
          wantSpeed = Math.abs(lunge);
        } else {
          wantSpeed = e.weapon.ranged ? 0 : e.effectiveSpeed * 0.7;
        }
      } else if (e.combat.state === 'hold') {
        // Deliberately still. The stillness is the tell.
        wantSpeed = 0;
      } else if (e.combat.state === 'recover') {
        // Recovery is the player's window; the enemy drifts, not presses.
        wantSpeed = 0;
      }

      // The moment an attack ends, schedule a step back out of the pocket.
      if (e.combat.justRecovered && !e.weapon.ranged) {
        e.backoffTimer = ENEMY.backoffTime[0] + Math.random() * (ENEMY.backoffTime[1] - ENEMY.backoffTime[0]);
      }
      break;
    }

    case 'escape': {
      e.intent = 'flee';
      let dx: number;
      let dz: number;
      if (e.hasEscapeAim) {
        dx = e.escapeAim.x - e.position.x;
        dz = e.escapeAim.z - e.position.z;
      } else {
        dx = e.position.x - player.position.x;
        dz = e.position.z - player.position.z;
      }
      const len = Math.hypot(dx, dz) || 1;
      tmpMove.set(dx / len, 0, dz / len);
      wantSpeed = e.effectiveSpeed * 1.24;
      faceTarget = { x: e.position.x + dx, z: e.position.z + dz };
      if (toPlayer > 55) e.escapedAway = true;
      break;
    }

    case 'approach_intro': {
      e.intent = 'approach';
      const dx = player.position.x - e.position.x;
      const dz = player.position.z - e.position.z;
      const len = Math.hypot(dx, dz) || 1;
      tmpMove.set(dx / len, 0, dz / len);
      wantSpeed = e.effectiveSpeed * (e.nemesis.personality === 'hunter' ? 1.05 : 0.72);
      faceTarget = { x: player.position.x, z: player.position.z };
      break;
    }

    case 'protect_ally': {
      const ally = e.protectTarget!;
      e.intent = 'reposition';
      // Stand between the ally and the player.
      const mx = (ally.position.x + player.position.x) / 2;
      const mz = (ally.position.z + player.position.z) / 2;
      const ddx = mx - e.position.x;
      const ddz = mz - e.position.z;
      const dl = Math.hypot(ddx, ddz);
      if (dl > 2) {
        tmpMove.set(ddx / dl, 0, ddz / dl);
        wantSpeed = e.effectiveSpeed * 1.1;
      }
      faceTarget = { x: player.position.x, z: player.position.z };
      if (toPlayer < e.weapon.reach + 1.2 && e.combat.state === 'ready' && e.combat.cooldown <= 0) {
        startSwing(e, pers.aggression, ctx, toPlayer);
      }
      break;
    }

    case 'attack_rival':
    case 'hunt_player':
    case 'chase': {
      faceTarget = { x: targetPos.x, z: targetPos.z };
      const speed = e.effectiveSpeed;

      if (e.weapon.ranged) {
        // Archers hold a band and reposition constantly.
        if (d < 8) {
          e.intent = 'reposition';
          tmpMove.set(e.position.x - targetPos.x, 0, e.position.z - targetPos.z).normalize();
          wantSpeed = speed * 1.1;
        } else if (d > 26) {
          e.intent = 'approach';
          tmpMove.set(targetPos.x - e.position.x, 0, targetPos.z - e.position.z).normalize();
          wantSpeed = speed;
        } else {
          e.intent = 'circle';
          if (e.strafeTimer <= 0) {
            e.strafeTimer = 1.2 + Math.random() * 1.6;
            e.strafeDir = Math.random() < 0.5 ? -1 : 1;
          }
          const ax = targetPos.x - e.position.x;
          const az = targetPos.z - e.position.z;
          const l = Math.hypot(ax, az) || 1;
          tmpMove.set((-az / l) * e.strafeDir, 0, (ax / l) * e.strafeDir);
          wantSpeed = speed * 0.6;
        }
        if (
          d > 7 &&
          d < e.weapon.reach &&
          e.combat.state === 'ready' &&
          e.combat.cooldown <= 0 &&
          arena.lineOfSight(e.position.x, e.position.z, targetPos.x, targetPos.z)
        ) {
          startSwing(e, pers.aggression, ctx, d);
        }
        break;
      }

      /* ---- melee engagement bands ----
         APPROACH (run) → PRESSURE/CIRCLE/WAIT (walk, hold, orbit) → swing →
         BACK OFF. The old behaviour was one band: sprint until touching, so
         every fight read as being chased by traffic. Distance now has
         grammar: running means far, walking means intent, stillness means a
         decision — and the director decides how many may press at once. */
      const swingRange = e.weapon.reach * 0.82;
      const pressureEdge = swingRange + ENEMY.pressureBand;
      const heavy = e.nemesis.archetype === 'heavy';

      // The attack decision is independent of the movement band: any time
      // they are ready and inside the WIDEST band, roll. chooseAttack filters
      // by actual distance, which is how thrusts and charges launch from
      // range while a quick slash still needs the pocket.
      if (
        e.combat.state === 'ready' &&
        e.combat.cooldown <= 0 &&
        e.hesitateTimer <= 0 &&
        d <= e.weapon.reach * 3.3 &&
        Math.random() < pers.aggression * 1.6 * dt * 9
      ) {
        startSwing(e, pers.aggression, ctx, d);
      }

      if (e.backoffTimer > 0 && d < pressureEdge * 0.9) {
        // Step back out of the pocket after an attack. Readable rhythm.
        e.intent = 'backoff';
        tmpMove.set(e.position.x - targetPos.x, 0, e.position.z - targetPos.z).normalize();
        wantSpeed = speed * ENEMY.backoffSpeed * (heavy ? 0.7 : 1);
      } else if (e.hesitateTimer > 0) {
        // Standing still, watching. The pause IS the behaviour.
        e.intent = 'wait';
        wantSpeed = 0;
      } else if (d > pressureEdge) {
        e.intent = 'approach';
        tmpMove.set(targetPos.x - e.position.x, 0, targetPos.z - e.position.z).normalize();
        wantSpeed = speed * ENEMY.approachSpeed * (e.state === 'hunt_player' ? 1.15 : 1);
        // Arriving at the edge of the fight is a decision point, not a
        // collision — sometimes they pull up and take stock.
        if (d < pressureEdge + 1.6 && Math.random() < ENEMY.hesitateChance * dt * 4) {
          e.hesitateTimer = ENEMY.hesitateTime[0] + Math.random() * (ENEMY.hesitateTime[1] - ENEMY.hesitateTime[0]);
        }
      } else if (d > swingRange) {
        // Mid band: press in only when a swing is actually coming — the
        // director has room and the cooldown is nearly done. Everyone else
        // orbits the fight instead of stacking onto the player's face.
        const wantsIn =
          e.combat.state === 'ready' &&
          e.combat.cooldown <= (heavy ? 0.7 : 0.3) &&
          ctx.director.couldClaim(e.uid, false);
        if (wantsIn) {
          e.intent = 'pressure';
          tmpMove.set(targetPos.x - e.position.x, 0, targetPos.z - e.position.z).normalize();
          wantSpeed = speed * ENEMY.pressureSpeed;
        } else {
          e.intent = 'circle';
          if (e.strafeTimer <= 0) {
            e.strafeTimer = 0.9 + Math.random() * 1.5;
            e.strafeDir = Math.random() < 0.5 ? -1 : 1;
            if (Math.random() < ENEMY.hesitateChance * 0.6) {
              e.hesitateTimer =
                ENEMY.hesitateTime[0] + Math.random() * (ENEMY.hesitateTime[1] - ENEMY.hesitateTime[0]);
            }
          }
          const ax = targetPos.x - e.position.x;
          const az = targetPos.z - e.position.z;
          const l = Math.hypot(ax, az) || 1;
          // Orbit, drifting gently toward the middle of the band.
          const bandMid = (swingRange + pressureEdge) / 2;
          const radial = (d - bandMid) / ENEMY.pressureBand; // + = too far
          let mx = (-az / l) * e.strafeDir * (heavy ? 0.4 : 1) + (ax / l) * radial * 0.8;
          let mz = (ax / l) * e.strafeDir * (heavy ? 0.4 : 1) + (az / l) * radial * 0.8;
          const ml = Math.hypot(mx, mz);
          if (ml > 0.001) {
            mx /= ml;
            mz /= ml;
          }
          tmpMove.set(mx, 0, mz);
          wantSpeed = speed * ENEMY.circleSpeed;
        }
      } else {
        // In swing range and not attacking yet: circle tight.
        e.intent = 'circle';
        if (e.strafeTimer <= 0) {
          e.strafeTimer = 0.8 + Math.random() * 1.4;
          e.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        const ax = targetPos.x - e.position.x;
        const az = targetPos.z - e.position.z;
        const l = Math.hypot(ax, az) || 1;
        const spacing = pers.spacing;
        // Circle the target, drifting in or out according to personality.
        const approach = (0.5 - spacing) * 1.2;
        let mx = (-az / l) * e.strafeDir + (ax / l) * approach;
        let mz = (ax / l) * e.strafeDir + (az / l) * approach;
        const ml = Math.hypot(mx, mz);
        if (ml > 0.001) {
          mx /= ml;
          mz /= ml;
        }
        tmpMove.set(mx, 0, mz);
        wantSpeed = speed * (heavy ? 0.35 : 0.55);
      }
      break;
    }

    case 'patrol':
    default: {
      e.intent = 'none';
      if (e.stateTime > 3 || e.patrolTarget.distanceToSquared(e.position) < 4) {
        e.stateTime = 0;
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 14;
        e.patrolTarget.set(e.position.x + Math.cos(a) * r, 0, e.position.z + Math.sin(a) * r);
      }
      const dx = e.patrolTarget.x - e.position.x;
      const dz = e.patrolTarget.z - e.position.z;
      const l = Math.hypot(dx, dz);
      if (l > 1) {
        tmpMove.set(dx / l, 0, dz / l);
        wantSpeed = e.effectiveSpeed * 0.34;
        faceTarget = { x: e.patrolTarget.x, z: e.patrolTarget.z };
      }
      break;
    }
  }

  /* ---------------- separation ---------------- */
  if (wantSpeed > 0 || e.state === 'chase') {
    let sx = 0;
    let sz = 0;
    for (const other of ctx.enemies) {
      if (other === e || !other.alive) continue;
      const dx = e.position.x - other.position.x;
      const dz = e.position.z - other.position.z;
      const dd = dx * dx + dz * dz;
      const min = SEPARATION_RADIUS + e.radius + other.radius;
      if (dd < min * min && dd > 0.0001) {
        const dl = Math.sqrt(dd);
        const push = (min - dl) / min;
        sx += (dx / dl) * push;
        sz += (dz / dl) * push;
      }
    }
    if (sx !== 0 || sz !== 0) {
      tmpMove.x += sx * 1.4;
      tmpMove.z += sz * 1.4;
      const l = Math.hypot(tmpMove.x, tmpMove.z);
      if (l > 0.001) {
        tmpMove.x /= l;
        tmpMove.z /= l;
      }
      if (wantSpeed <= 0) wantSpeed = e.effectiveSpeed * 0.4;
    }
  }

  /* ---------------- integrate ---------------- */
  let nx = e.position.x + (tmpMove.x * wantSpeed + e.velocity.x) * dt;
  let nz = e.position.z + (tmpMove.z * wantSpeed + e.velocity.z) * dt;
  arena.resolve(nx, nz, e.radius, tmpPos);
  nx = tmpPos.x;
  nz = tmpPos.z;
  const moved = Math.hypot(nx - e.position.x, nz - e.position.z);
  e.position.x = nx;
  e.position.z = nz;

  // Feed the animation system a sense of speed.
  if (dt > 0) {
    const vx = (tmpMove.x * wantSpeed) * 0.6;
    const vz = (tmpMove.z * wantSpeed) * 0.6;
    e.velocity.x = e.velocity.x * 0.6 + vx * 0.4;
    e.velocity.z = e.velocity.z * 0.6 + vz * 0.4;
  }
  void moved;

  if (faceTarget && e.combat.state !== 'windup' && !e.combat.committed) {
    e.faceToward(faceTarget.x, faceTarget.z, dt, e.state === 'escape' ? 5 : 8);
  }
}

/**
 * Ask the director for a permit, then pick an attack that actually suits the
 * current distance. Returns false when the enemy should keep repositioning —
 * which is most of the time in a crowd, and is exactly the point.
 */
function startSwing(e: Enemy, aggression: number, ctx: AIContext, distance: number): boolean {
  if (e.introHold || e.pendingIntro) return false;
  if (!ctx.director.claim(e.uid, !!e.weapon.ranged)) return false;

  const def = chooseAttack({
    archetype: e.nemesis.archetype,
    rankIndex: rankIndex(e.nemesis.rank),
    distance,
    reach: e.weapon.reach,
    aggression,
    // PARRY BREAKER and friends decide whether this enemy is allowed to throw
    // attacks the player simply cannot turn aside.
    allowUnblockable: e.mods.unblockable || rankIndex(e.nemesis.rank) >= 2,
    // Delayed strikes are a Captain-and-above trick; they are unfair against a
    // player who has not yet learned the honest timings.
    allowDelayed: rankIndex(e.nemesis.rank) >= 2 || e.mods.windupJitter > 0,
    rand: Math.random,
  });

  if (!def) {
    ctx.director.release(e.uid);
    return false;
  }
  e.combat.startAttack(def, e.weapon, e.mods, anticipationFor(def.anticipation, ctx.worldAge));

  // Captains and above sometimes plan a feint here — decided up front, never
  // as a reaction, so it cannot read as input-sniffing.
  e.feintPlanned =
    rankIndex(e.nemesis.rank) >= 2 &&
    def.interruptible &&
    !def.ranged &&
    Math.random() < ENEMY.feintChance;
  return true;
}

function aggroRange(e: Enemy): number {
  const p = getPersonality(e.nemesis.personality);
  let r = e.weapon.ranged ? 30 : 20;
  r *= 0.8 + p.hunt * 0.25;
  if (e.named) r *= 1.2;
  return r;
}

function dist(a: Enemy, b: Enemy): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}
