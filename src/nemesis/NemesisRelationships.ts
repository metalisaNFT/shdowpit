/**
 * Relationships between nemeses. Kept as plain id lists on each record so they
 * serialise trivially; these helpers keep both sides in sync.
 */

import type { Nemesis, RelationKind } from './Nemesis';

export function makeRivals(a: Nemesis, b: Nemesis): boolean {
  if (a.id === b.id) return false;
  let changed = false;
  if (!a.rivalries.includes(b.id)) {
    a.rivalries.push(b.id);
    changed = true;
  }
  if (!b.rivalries.includes(a.id)) {
    b.rivalries.push(a.id);
    changed = true;
  }
  // Rivalry cancels friendship.
  removeFrom(a.allies, b.id);
  removeFrom(b.allies, a.id);
  return changed;
}

export function makeAllies(a: Nemesis, b: Nemesis): boolean {
  if (a.id === b.id) return false;
  let changed = false;
  if (!a.allies.includes(b.id)) {
    a.allies.push(b.id);
    changed = true;
  }
  if (!b.allies.includes(a.id)) {
    b.allies.push(a.id);
    changed = true;
  }
  removeFrom(a.rivalries, b.id);
  removeFrom(b.rivalries, a.id);
  return changed;
}

export function breakBond(a: Nemesis, b: Nemesis): void {
  removeFrom(a.allies, b.id);
  removeFrom(b.allies, a.id);
  if (a.master === b.id) a.master = null;
  if (b.master === a.id) b.master = null;
}

export function setMaster(follower: Nemesis, master: Nemesis | null): void {
  follower.master = master ? master.id : null;
  if (master && !master.allies.includes(follower.id)) master.allies.push(follower.id);
  if (master && !follower.allies.includes(master.id)) follower.allies.push(master.id);
}

/** Sever every reference to `id` across the roster (used when someone dies for good). */
export function purgeReferences(all: Nemesis[], id: string): void {
  for (const n of all) {
    removeFrom(n.rivalries, id);
    removeFrom(n.allies, id);
    if (n.master === id) n.master = null;
  }
}

export function relationBetween(a: Nemesis, b: Nemesis): RelationKind {
  if (a.master === b.id) return 'master';
  if (b.master === a.id) return 'follower';
  if (a.rivalries.includes(b.id)) return 'rival';
  if (a.allies.includes(b.id)) return 'ally';
  return 'neutral';
}

export function describeRelation(k: RelationKind): string {
  switch (k) {
    case 'master':
      return 'SERVES';
    case 'follower':
      return 'COMMANDS';
    case 'rival':
      return 'RIVAL OF';
    case 'ally':
      return 'ALLIED WITH';
    case 'enemy':
      return 'ENEMY OF';
    case 'friend':
      return 'FRIEND OF';
    default:
      return '';
  }
}

function removeFrom(arr: string[], id: string): void {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}
