/**
 * Character reference pack hooks — store refs against nemesis ID.
 * v1: capture-only / portrait URL stubs; IP-Adapter / LoRA plug in later.
 */

import type { CharacterRefPack } from './Types';

export class CharacterRefStore {
  private packs = new Map<string, CharacterRefPack>();

  get(nemesisId: string): CharacterRefPack | null {
    return this.packs.get(nemesisId) ?? null;
  }

  ensure(nemesisId: string): CharacterRefPack {
    let p = this.packs.get(nemesisId);
    if (!p) {
      p = { nemesisId, refs: [], notes: '', updatedAt: Date.now() };
      this.packs.set(nemesisId, p);
    }
    return p;
  }

  /** Attach a capture or portrait data URL as a reference. Dedupes exact URLs. */
  addRef(nemesisId: string, dataUrl: string, note = ''): CharacterRefPack {
    const p = this.ensure(nemesisId);
    if (dataUrl && !p.refs.includes(dataUrl)) {
      p.refs.push(dataUrl);
      // Cap memory — keep newest 6.
      if (p.refs.length > 6) p.refs.splice(0, p.refs.length - 6);
    }
    if (note) p.notes = note;
    p.updatedAt = Date.now();
    return p;
  }

  clear(nemesisId?: string): void {
    if (nemesisId) this.packs.delete(nemesisId);
    else this.packs.clear();
  }

  /** Snapshot for debug / save hooks later. */
  list(): CharacterRefPack[] {
    return [...this.packs.values()];
  }
}
