import { HEAT, clamp } from '../data/balance';
import type { RunState } from '../run/RunState';

export function addHeat(run: RunState, amount: number): number {
  const next = clamp(run.heat + amount, 0, HEAT.max);
  run.heat = next;
  if (next > run.heatPeak) run.heatPeak = next;
  return next;
}

export function heatLabel(heat: number): string {
  let label = 'COLD';
  for (let i = 0; i < HEAT.thresholds.length; i++) {
    if (heat >= HEAT.thresholds[i]) label = HEAT.labels[i];
  }
  return label;
}

export function crossedThreshold(prev: number, next: number): number | null {
  for (const t of HEAT.thresholds) {
    if (prev < t && next >= t) return t;
  }
  return null;
}

export function heatRewardMul(heat: number): number {
  return 1 + Math.floor(heat / 10) * HEAT.rewardBonusPer10;
}

export function canSpendSpawn(run: RunState): boolean {
  return run.spawnBudget >= 1 && run.heatCooldown <= 0;
}

export function spendSpawn(run: RunState): boolean {
  if (!canSpendSpawn(run)) return false;
  run.spawnBudget -= 1;
  run.heatCooldown = HEAT.pulseCooldown;
  return true;
}

export function tickHeatEconomy(run: RunState, dt: number, inCombat: boolean, sameArea: boolean, carryingRelic: boolean, dampen: boolean): void {
  if (run.heatCooldown > 0) run.heatCooldown -= dt;
  run.spawnBudgetRegen += dt * HEAT.spawnBudgetRegen;
  if (run.spawnBudgetRegen >= 1 && run.spawnBudget < HEAT.spawnBudget) {
    run.spawnBudget += 1;
    run.spawnBudgetRegen = 0;
  }
  if (inCombat) {
    run.loudCombatTimer += dt;
    if (run.loudCombatTimer > 2) addHeat(run, HEAT.loudCombatPerSecond * dt * (dampen ? 0.45 : 1));
  } else {
    run.loudCombatTimer = Math.max(0, run.loudCombatTimer - dt * 0.5);
  }
  if (sameArea) {
    run.areaDwell += dt;
    if (run.areaDwell > 25) addHeat(run, HEAT.dwellPerSecond * dt * (dampen ? 0.4 : 1));
  }
  if (carryingRelic) addHeat(run, HEAT.relicCarry * dt);
}

export function spawnSafeOffset(px: number, pz: number, facing: number, behind: boolean, dist: number): { x: number; z: number } {
  const yaw = behind ? facing + Math.PI : facing;
  const d = Math.max(dist, HEAT.spawnMinDistance);
  return { x: px - Math.sin(yaw) * d, z: pz - Math.cos(yaw) * d };
}
