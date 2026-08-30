/**
 * THE BOOK OF LEGENDS, and the screen that writes into it.
 *
 * The point of both is the same: prove that the roguelite reset does not erase
 * history. A run ends, the world can be rebuilt, and these people are still
 * here — with their deeds, their scars, what they thought of you, and one
 * thing each that reaches into the next world.
 */

import { button, clear, div, show } from './Dom';
import { describeLegend, legendHome } from '../god/Legends';
import { UNLOCK_MAP, unlockName, type UnlockKind } from '../god/Unlocks';
import type { LegendRecord, RunOutcome } from '../god/GodTypes';
import { enter } from './motion';

const LEGACY_LINE: Record<string, string> = {
  relic: 'THEIR STEEL IS STILL OUT THERE',
  bloodline: 'SOMEONE CARRIES THEIR NAME',
  rumour: 'THE STORY OUTLIVED THEM',
  grudge: 'THEIR OPINION OF YOU WAS INHERITED',
  title: 'SOMEONE ELSE WEARS THEIR TITLE',
};

export interface LegendViewHooks {
  voiceFor?(l: LegendRecord): string;
  portraitFor?(l: LegendRecord): string;
}

export class LegendsScreen {
  readonly root = div('screen hidden');
  private bodyEl = div('body');
  private actionsEl = div('actions');
  private toastEl = div('legend-unlock-toast hidden');
  private selected: string | null = null;
  private legends: LegendRecord[] = [];
  private onClose: () => void = () => void 0;
  private view: LegendViewHooks = {};
  private seenLegendIds = new Set<string>();
  private toastTimer = 0;

  constructor() {
    this.root.id = 'legends-screen';
    const h1 = document.createElement('h1');
    h1.className = 'screen-headline';
    h1.textContent = 'THE BOOK';
    const h2 = document.createElement('h2');
    h2.textContent = 'WHAT SURVIVED THE RESET';
    this.root.append(h1, h2, this.toastEl, this.bodyEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(legends: readonly LegendRecord[], onClose: () => void, view: LegendViewHooks = {}): void {
    const incoming = legends.slice().reverse();
    const newOnes = incoming.filter((l) => !this.seenLegendIds.has(l.id));
    for (const l of incoming) this.seenLegendIds.add(l.id);

    this.legends = incoming;
    this.onClose = onClose;
    this.view = view;
    this.selected = this.legends[0]?.id ?? null;
    show(this.root, true);
    this.render();
    if (newOnes.length) this.showUnlockToast(newOnes);
  }

  refresh(): void {
    if (this.visible) this.render();
  }

  hide(): void {
    window.clearTimeout(this.toastTimer);
    show(this.root, false);
    this.toastEl.classList.add('hidden');
  }

  private showUnlockToast(newOnes: LegendRecord[]): void {
    window.clearTimeout(this.toastTimer);
    const names = newOnes.map((l) => l.name.toUpperCase()).join(' · ');
    this.toastEl.textContent = newOnes.length === 1 ? `NEW CHAPTER — ${names}` : `${newOnes.length} NEW CHAPTERS — ${names}`;
    this.toastEl.classList.remove('hidden');
    enter(this.toastEl, 'slide-up');
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, 4200);
  }

  private render(): void {
    clear(this.bodyEl);
    clear(this.actionsEl);

    if (!this.legends.length) {
      this.bodyEl.append(
        div('god-empty', 'Nothing yet. Finish a run and whoever mattered in it will be written down here.')
      );
    } else {
      const wrap = div('legend-wrap');
      const list = div('legend-list');
      const chapterTotal = this.legends.length;
      this.legends.forEach((l, i) => {
        const chapter = chapterTotal - i;
        const row = div('legend-row' + (l.id === this.selected ? ' sel' : ''));
        row.append(div('legend-chapter', String(chapter).padStart(2, '0')));
        row.append(div('legend-name', `${l.name}${l.title ? ' ' + l.title : ''}`));
        row.append(div('legend-meta', `RUN ${l.run} · ${l.finalRank} · ${l.faction}`));
        row.addEventListener('click', () => {
          this.selected = l.id;
          this.render();
        });
        list.append(row);
      });
      const detail = div('legend-detail');
      const l = this.legends.find((x) => x.id === this.selected) ?? this.legends[0];
      if (l) {
        const chapter = chapterTotal - this.legends.findIndex((x) => x.id === l.id);
        detail.append(div('legend-chapter-head', `CHAPTER ${String(chapter).padStart(2, '0')}`));
        const portrait = this.view.portraitFor?.(l);
        if (portrait) {
          const img = document.createElement('img');
          img.className = 'legend-portrait';
          img.alt = '';
          img.src = portrait;
          detail.append(img);
        }
        detail.append(div('legend-title', `${l.name}${l.title ? ' ' + l.title : ''}`));
        detail.append(div('legend-meta', `HOME — ${legendHome(l)}`));
        const lines = describeLegend(l);
        const voice = this.view.voiceFor?.(l);
        if (voice && lines.length) lines[lines.length - 1] = voice;
        for (const line of lines) detail.append(div('legend-line', line));
        if (l.deeds.length) {
          detail.append(div('legend-sub', 'WHAT THEY DID'));
          for (const d of l.deeds) detail.append(div('legend-deed', d));
        }
        detail.append(div('legend-sub', 'WHAT THEY LEFT'));
        detail.append(div('legend-legacy', LEGACY_LINE[l.legacy] ?? l.legacy.toUpperCase()));
      }
      wrap.append(list, detail);
      this.bodyEl.append(wrap);
    }

    this.actionsEl.append(button('BACK', () => this.onClose()));
  }
}

/* ============================================================
   the end of a run
   ============================================================ */

export interface RunEndHandlers {
  onNext: () => void;
  onBook: () => void;
  onTitle: () => void;
}

const ENDING_SUB: Record<string, string> = {
  triumph: 'SOMEBODY IN THERE WAS ENOUGH',
  collapse: 'NOBODY IN THERE WAS ENOUGH',
  stalemate: 'IT NEVER CAME TO ANYTHING',
  abandoned: 'YOU STOPPED',
};

export class RunEndScreen {
  readonly root = div('screen hidden');
  private h1 = document.createElement('h1');
  private h2 = document.createElement('h2');
  private bodyEl = div('body');
  private actionsEl = div('actions');
  private outcome: RunOutcome | null = null;
  private handlers: RunEndHandlers | null = null;
  private voice = '';
  private thesisVoice = '';

  constructor() {
    this.root.id = 'god-end-screen';
    this.h1.className = 'screen-headline';
    this.root.append(this.h1, this.h2, this.bodyEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(outcome: RunOutcome, handlers: RunEndHandlers, voice = '', thesisVoice = ''): void {
    this.outcome = outcome;
    this.handlers = handlers;
    this.voice = voice;
    this.thesisVoice = thesisVoice;
    this.render();
    show(this.root, true);
  }

  refreshVoice(voice: string, thesisVoice?: string): void {
    if (!this.visible || !this.outcome || !this.handlers) return;
    this.voice = voice;
    if (thesisVoice !== undefined) this.thesisVoice = thesisVoice;
    this.render();
  }

  private render(): void {
    const outcome = this.outcome;
    const handlers = this.handlers;
    if (!outcome || !handlers) return;
    clear(this.bodyEl);
    clear(this.actionsEl);
    this.h1.textContent = HEADLINE[outcome.ending] ?? 'IT ENDED';
    this.h2.textContent = this.voice || ENDING_SUB[outcome.ending] || '';

    for (const line of outcome.highlights) this.bodyEl.append(div('god-end-line', line));

    const recap = outcome.recapChain ?? [];
    if (recap.length) {
      this.bodyEl.append(div('god-end-sub', 'WHY IT ENDED THIS WAY'));
      for (const line of recap) this.bodyEl.append(div('god-end-recap', line));
    }

    const story = outcome.runStory;
    if (story?.acts.length) {
      this.bodyEl.append(div('god-end-sub', 'THE RUN STORY'));
      this.bodyEl.append(div('god-end-line god-end-thesis', this.thesisVoice || story.thesis));
      for (const act of story.acts) {
        const block = div('god-end-act');
        block.append(div('god-end-act-name', act.name));
        for (const beat of act.beats) {
          block.append(div('god-end-beat', `${beat.headline}. ${beat.line}`));
        }
        this.bodyEl.append(block);
      }
    }

    this.bodyEl.append(div('god-end-sub', 'THE RUN'));
    this.bodyEl.append(
      div(
        'god-end-stats',
        `${outcome.cycles} CYCLES · ${outcome.interventions} INTERVENTIONS · ${outcome.influenceSpent} INFLUENCE SPENT · PEAK CHAOS ${outcome.chaosPeak} · ${outcome.revengeChains} LIVE REVENGE CHAINS`
      )
    );
    this.bodyEl.append(div('god-end-stats', outcome.crisis));

    if (outcome.legendsMade.length) {
      this.bodyEl.append(div('god-end-sub', 'INTO THE BOOK'));
      for (const l of outcome.legendsMade) this.bodyEl.append(div('god-end-legend', l));
    }

    if (outcome.unlocked.length) {
      this.bodyEl.append(div('god-end-sub', 'NEW VERBS FOR THE NEXT WORLD'));
      for (const id of outcome.unlocked) {
        const def = UNLOCK_MAP.get(id);
        const card = div('god-end-unlock-card');
        card.append(div('god-end-unlock-name', def?.name ?? unlockName(id)));
        if (def) {
          card.append(div('god-end-unlock-kind', UNLOCK_KIND[def.kind] ?? def.kind.toUpperCase()));
          card.append(div('god-end-unlock-desc', def.desc));
        }
        this.bodyEl.append(card);
      }
    }

    this.bodyEl.append(div('god-end-sub', 'BANKED'));
    this.bodyEl.append(div('god-end-stats', `${outcome.essence} ESSENCE`));

    this.actionsEl.append(button('ANOTHER WORLD  ▸', handlers.onNext));
    this.actionsEl.append(button('THE BOOK', handlers.onBook, 'brut tiny'));
    this.actionsEl.append(button('TITLE', handlers.onTitle, 'brut tiny'));
    show(this.root, true);
  }

  hide(): void {
    show(this.root, false);
  }
}

const HEADLINE: Record<string, string> = {
  triumph: 'THE WORLD HELD',
  collapse: 'THE WORLD DID NOT HOLD',
  stalemate: 'NOTHING CAME OF IT',
  abandoned: 'YOU LET GO',
};

const UNLOCK_KIND: Record<UnlockKind, string> = {
  intervention: 'NEW INTERVENTION',
  world: 'WORLD MODIFIER',
  start: 'STARTING CONDITION',
  insight: 'NEW READ ON THE BOARD',
};
