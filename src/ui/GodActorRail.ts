/**
 * Compact cast strip for THE LONG GAME — situation actors on screen.
 */

import { clear, div, el } from './Dom';
import { fullName } from '../nemesis/Nemesis';
import { paletteFor } from '../nemesis/NemesisAppearance';
import type { GodRun } from '../god/GodRun';
import type { GodHooks } from './GodScreen';
import { enter } from './motion';

export class GodActorRail {
  readonly root = div('god-actor-rail');
  private lastSelA: string | null = null;

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
      const card = el('button', 'god-actor-chip');
      card.type = 'button';
      const accent = paletteFor(n.appearanceSeed).accent;
      const hex = `#${((accent >> 16) & 255).toString(16).padStart(2, '0')}${((accent >> 8) & 255).toString(16).padStart(2, '0')}${(accent & 255).toString(16).padStart(2, '0')}`;
      card.style.setProperty('--actor-accent', hex);
      if (selA === id) card.classList.add('sel-a');
      if (selB === id) card.classList.add('sel-b');
      if (spotlightId === id) card.classList.add('spotlight');

      const frame = div('god-actor-frame');
      const portrait = hooks.portraitFor?.(n);
      if (portrait) {
        const img = document.createElement('img');
        img.className = 'god-actor-portrait';
        img.src = portrait;
        img.alt = '';
        frame.append(img);
      } else {
        frame.append(div('god-actor-glyph', n.name.charAt(0).toUpperCase()));
      }
      card.append(frame);

      const meta = div('god-actor-meta');
      const nameEl = div('god-actor-name', fullName(n));
      if (selA === id && this.lastSelA !== id) enter(nameEl, 'slide-left');
      meta.append(nameEl);
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

    this.lastSelA = selA;
  }
}
