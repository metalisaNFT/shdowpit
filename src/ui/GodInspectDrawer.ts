/**
 * Character inspect slide-over for THE LONG GAME.
 */

import { button, clear, div, show } from './Dom';
import { fullName } from '../nemesis/Nemesis';
import { getPersonality } from '../data/personalities';
import { MEMORY_TEXT } from '../nemesis/NemesisMemory';
import { AREA_NAMES } from '../data/names';
import { describeFaction, factionFor } from '../god/Factions';
import { beatToneClass, threadFor } from '../god/Feed';
import { simOf } from '../god/GodTypes';
import { startingConditions } from '../god/Unlocks';
import type { GodRun } from '../god/GodRun';
import type { GodHooks } from './GodScreen';

export class GodInspectDrawer {
  readonly root = div('god-inspect-drawer hidden');
  private openId: string | null = null;
  private lastInspectId: string | null = null;
  private lastInspectVersion = -1;

  onClose: (() => void) | null = null;
  onSetA: ((id: string) => void) | null = null;
  onSetB: ((id: string) => void) | null = null;

  open(id: string | null): void {
    this.openId = id;
    show(this.root, !!id);
  }

  get id(): string | null {
    return this.openId;
  }

  render(run: GodRun, hooks: GodHooks): void {
    clear(this.root);
    const n = run.mgr.byId(this.openId);
    if (!n) {
      show(this.root, false);
      return;
    }
    show(this.root, true);

    const version = n.ai?.eventVersion ?? 0;
    if (this.lastInspectId !== n.id || this.lastInspectVersion !== version) {
      this.lastInspectId = n.id;
      this.lastInspectVersion = version;
      hooks.inspectCharacter?.(n);
    }

    const s = simOf(n);
    const p = getPersonality(n.personality);
    const f = factionFor(run.god, n);
    const showScores = startingConditions(run.mgr.data.godUnlocks ?? []).showScores;

    const head = div('god-ins-head');
    const shown = hooks.displayName?.(n) ?? fullName(n);
    const portrait = hooks.portraitFor?.(n);
    if (portrait) {
      const fig = div('god-ins-figure');
      const img = document.createElement('img');
      img.className = 'god-ins-portrait';
      img.alt = '';
      img.src = portrait;
      fig.append(img);
      head.append(fig);
    }
    const names = div('god-ins-names');
    names.append(div('god-ins-name', shown));
    names.append(
      div(
        'god-ins-line',
        `${n.rank.toUpperCase()} · ${p.name} · ${f ? f.name : 'UNSWORN'} · ${AREA_NAMES[n.territory] ?? n.territory.toUpperCase()}`
      )
    );
    if (f) names.append(div('god-ins-line', describeFaction(run.mgr, f)));
    head.append(names);
    head.append(
      button('CLOSE', () => {
        this.openId = null;
        this.onClose?.();
      }, 'brut tiny')
    );
    this.root.append(head);

    const dossier = hooks.dossierFor?.(n);
    if (dossier) this.root.append(div('god-ins-dossier', dossier));

    const chronicle = hooks.chronicleFor?.(n);
    if (chronicle) {
      const sec = div('god-ins-chronicle');
      sec.append(div('god-ins-fact', 'HISTORY'));
      sec.append(div('god-ins-chronicle-line', chronicle));
      this.root.append(sec);
    }

    const crisis = run.god.crisis;
    if (crisis && crisis.resolved === 'none' && crisis.bodyId === n.id) {
      const voice = hooks.crisisVoiceFor?.() ?? crisis.description;
      const sec = div('god-ins-crisis');
      sec.append(div('god-ins-fact', 'CRISIS'));
      sec.append(div('god-ins-crisis-title', crisis.title));
      sec.append(div('god-ins-crisis-line', voice));
      this.root.append(sec);
    }

    if (showScores) {
      const bars = div('god-ins-bars');
      bars.append(bar('FEAR', s.fear), bar('CONF', s.confidence), bar('AMB', s.ambition), bar('LOY', s.loyalty), bar('INJ', s.injury));
      this.root.append(bars);
    }

    const mem = div('god-ins-mem');
    mem.append(div('god-ins-fact', 'REMEMBERS'));
    for (const m of n.memory.slice(-6).reverse()) {
      mem.append(div('god-mem-line', `${MEMORY_TEXT[m.type]}${m.subject ? ' — ' + nameOf(run, m.subject) : ''}`));
    }
    this.root.append(mem);

    const thread = threadFor(run.god.feed, n.id).slice(-4).reverse();
    if (thread.length) {
      const sec = div('god-ins-thread');
      sec.append(div('god-ins-fact', 'RECENT'));
      for (const b of thread) {
        const row = div(`god-ins-thread-line ${beatToneClass(b)}`);
        row.append(div('god-ins-thread-head', b.headline));
        const voice = hooks.beatVoiceFor?.(b);
        if (voice && voice !== b.headline) row.append(div('god-ins-thread-voice', voice));
        sec.append(row);
      }
      this.root.append(sec);
    }

    const acts = div('god-ins-actions');
    acts.append(
      button('SET A', () => this.onSetA?.(n.id)),
      button('SET B', () => this.onSetB?.(n.id))
    );
    this.root.append(acts);
  }
}

function nameOf(run: GodRun, id: string): string {
  const n = run.mgr.byId(id);
  return n ? fullName(n) : '—';
}

function bar(label: string, value: number): HTMLElement {
  const el = div('god-bar');
  el.append(div('god-bar-label', label));
  const track = div('god-bar-track');
  const fill = div('god-bar-fill');
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  track.append(fill);
  el.append(track, div('god-bar-value', String(Math.round(value))));
  return el;
}
