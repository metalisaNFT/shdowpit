/**
 * Compact cast strip for THE LONG GAME — situation actors on screen.
 */

import { clear, div } from './Dom';
import { fullName } from '../nemesis/Nemesis';
import type { GodRun } from '../god/GodRun';
import type { GodHooks } from './GodScreen';

export class GodActorRail {
  readonly root = div('god-actor-rail');

  render(
    run: GodRun,
    hooks: GodHooks,
    actorIds: readonly string[],
    selA: string | null,
    selB: string | null,
    headLabel: string,
    spotlightId: string | null,
    onSelectA: (id: string) => void,
    onSelectB: (id: string) => void,
    onInspect: (id: string) => void
  ): void {
    clear(this.root);
    if (!actorIds.length) {
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.remove('hidden');
    this.root.append(div('god-actor-head', headLabel));

    for (const id of actorIds.slice(0, 4)) {
      const n = run.mgr.byId(id);
      if (!n) continue;
      const card = div('god-actor-chip');
      if (selA === id) card.classList.add('sel-a');
      if (selB === id) card.classList.add('sel-b');
      if (spotlightId === id) card.classList.add('spotlight');

      const portrait = hooks.portraitFor?.(n);
      if (portrait) {
        const img = document.createElement('img');
        img.className = 'god-actor-portrait';
        img.src = portrait;
        img.alt = '';
        card.append(img);
      }

      const meta = div('god-actor-meta');
      meta.append(div('god-actor-name', fullName(n)));
      meta.append(
        div(
          'god-actor-sub',
          `${n.alive ? n.rank.toUpperCase() : 'DEAD'} · ${(n.territory || 'NOWHERE').toUpperCase()}`
        )
      );
      card.append(meta);

      card.addEventListener('click', (ev) => {
        if (ev.shiftKey) onSelectB(id);
        else onSelectA(id);
      });
      card.addEventListener('dblclick', () => onInspect(id));
      this.root.append(card);
    }
  }
}
