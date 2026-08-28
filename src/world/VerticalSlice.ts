/**
 * Deterministic Tower Commander scenario. Simulation facts only — no AI.
 */

import { remember } from '../nemesis/NemesisMemory';
import { fullName } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { ensureSignature } from '../data/signatures';
import { addHeat } from './Heat';
import { makeEvent } from './WorldEvent';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { World } from './World';
import type { Player } from '../player/Player';
import type { RNG } from '../core/RNG';
import type { Arena } from './Arena';
import type { VendettaInstance } from '../nemesis/Vendetta';

export function applyVerticalSlice(args: {
  mgr: NemesisManager;
  world: World;
  player: Player;
  rng: RNG;
  arena: Arena;
}): Record<string, unknown> {
  const { mgr, world, player, rng, arena } = args;

  let commander = mgr.living().find((n) => n.persistent && n.rank !== 'overlord' && n.archetype === 'commander') ?? null;
  if (!commander) {
    commander = mgr.living().find((n) => n.persistent && n.rank !== 'overlord' && n.rank !== 'grunt') ?? mgr.recruit('warlord', false);
  }
  commander.archetype = 'commander';
  commander.personality = 'ambitious';
  commander.weapon = 'spear';
  if (commander.rank === 'grunt' || commander.rank === 'elite') commander.rank = 'captain';
  commander.territory = 'tower';
  commander.alive = true;
  commander.persistent = true;
  commander.playerRelationship = Math.max(commander.playerRelationship, 55);
  commander.killsAgainstPlayer = Math.max(1, commander.killsAgainstPlayer);
  commander.stolen = [{ name: 'YOUR SPEAR', kind: 'weapon', weaponId: 'spear' }];
  remember(commander, 'I_KILLED_PLAYER', mgr.turn);
  remember(commander, 'I_STOLE_PLAYER_WEAPON', mgr.turn);
  if (!mgr.data.playerMeta.lostWeapons.includes('spear')) mgr.data.playerMeta.lostWeapons.push('spear');
  commander.signatureId = 'order_pulse';
  commander.signatureKnown = false;
  ensureSignature(commander);
  recomputePower(commander);

  let loyal = mgr.living().find((n) => n.id !== commander!.id && n.personality === 'loyalist' && n.rank !== 'overlord') ?? null;
  if (!loyal) loyal = mgr.recruit('elite', false);
  loyal.personality = 'loyalist';
  if (loyal.archetype === 'commander') loyal.archetype = 'fighter';
  if (loyal.rank === 'overlord') loyal.rank = 'captain';
  loyal.territory = 'tower';
  loyal.alive = true;
  loyal.persistent = true;
  loyal.master = commander.id;
  if (!commander.allies.includes(loyal.id)) commander.allies.push(loyal.id);
  if (!loyal.allies.includes(commander.id)) loyal.allies.push(commander.id);
  ensureSignature(loyal);
  recomputePower(loyal);

  mgr.data.territories.tower = commander.id;

  const vendetta: VendettaInstance = {
    pattern: 'defeat_recovered_weapon',
    targetId: commander.id,
    targetName: commander.name,
    title: `TAKE THE SPEAR FROM ${commander.name.toUpperCase()}`,
    desc: 'Recover what they stole. The Tower still answers to them.',
    progress: 0,
    goal: 1,
    failed: false,
    complete: false,
    committed: true,
    reward: { kind: 'weapon', text: 'YOUR SPEAR RETURNED' },
    healed: false,
  };
  world.run.vendetta = vendetta;
  addHeat(world.run, 28);

  const pt = arena.spawnPoint('tower', rng, 0.55, 0.88);
  player.position.set(pt.x, 0, pt.z);

  world.refreshOccupancy();
  world.spawnNamed(commander, player, true);
  world.spawnNamed(loyal, player, false);

  mgr.log(
    makeEvent(
      mgr.turn,
      mgr.age,
      'vendetta',
      `${fullName(commander)} HOLDS THE TOWER AND YOUR SPEAR.`,
      [commander.id, loyal.id],
      true,
      'bad',
      { known: true, witnessed: true, payload: { areaId: 'tower', weaponId: 'spear' } }
    )
  );
  mgr.persist();

  return {
    commander: commander.id,
    commanderName: commander.name,
    loyalist: loyal.id,
    loyalistName: loyal.name,
    territory: mgr.data.territories.tower,
    stolen: commander.stolen.map((s) => s.weaponId),
    signature: commander.signatureId,
    heat: world.run.heat,
    vendetta: world.run.vendetta,
  };
}
