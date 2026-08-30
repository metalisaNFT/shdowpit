/**
 * Collapsible intervention strip for THE LONG GAME.
 */

import { button, clear, div, el } from './Dom';
import { AREAS } from '../data/areas';
import { AREA_NAMES } from '../data/names';
import { fullName } from '../nemesis/Nemesis';
import type { GodRun } from '../god/GodRun';
import type { InterventionDef, SpendResult } from '../god/Interventions';
import type { GodHooks } from './GodScreen';

export interface ActionStripState {
  selA: string | null;
  selB: string | null;
  selArea: string | null;
  suggested: Set<string>;
  showAllInterventions: boolean;
  pendingDef: InterventionDef | null;
  note: string;
  busy: boolean;
  expanded: boolean;
}

export class GodActionStrip {
  readonly root = div('god-action-strip');
  private collapsedEl = div('god-strip-collapsed');
  private expandedEl = div('god-strip-expanded');

  onChange: (() => void) | null = null;
  onConfirm: ((def: InterventionDef) => void) | null = null;
  onAdvance: (() => void) | null = null;
  onInspect: ((id: string) => void) | null = null;
  onExpand: (() => void) | null = null;

  constructor() {
    this.root.append(this.collapsedEl, this.expandedEl);
    this.collapsedEl.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('#god-advance')) return;
      this.onExpand?.();
    });
  }

  render(run: GodRun, hooks: GodHooks, state: ActionStripState): void {
    this.root.classList.toggle('expanded', state.expanded);
    clear(this.expandedEl);
    clear(this.collapsedEl);
    this.collapsedEl.append(
      div('god-strip-collapsed-label', 'INTERFERE'),
      div('god-strip-collapsed-hint', 'WRITE CONDITIONS · NEVER OUTCOMES')
    );

    const spent = run.spentThisCycle;
    const advanceLabel = spent ? 'ADVANCE ▸' : 'LET TIME PASS ▸';
    const appendAdvance = (parent: HTMLElement, cls = 'brut tiny god-strip-collapsed-advance') => {
      const go = button(advanceLabel, () => this.onAdvance?.(), cls);
      go.id = 'god-advance';
      if (spent) go.classList.add('ready');
      parent.append(go);
    };
    if (!state.expanded) {
      appendAdvance(this.collapsedEl);
      return;
    }

    const head = div('god-strip-head');
    head.append(div('god-strip-head-label', 'INTERFERE'));
    head.append(
      button('COLLAPSE', () => {
        state.expanded = false;
        this.onChange?.();
      }, 'brut tiny')
    );
    this.expandedEl.append(head);

    const sel = div('god-sel');
    sel.append(slot('A', state.selA, run, () => {
      state.selA = null;
      this.onChange?.();
    }, () => state.selA && this.onInspect?.(state.selA)));
    sel.append(slot('B', state.selB, run, () => {
      state.selB = null;
      this.onChange?.();
    }, () => state.selB && this.onInspect?.(state.selB)));

    if (run.god.boardUnlocked || state.showAllInterventions) {
      const areaRow = div('god-area-row');
      areaRow.append(div('god-slot-label', 'GROUND'));
      for (const a of AREAS) {
        const b = el('button', 'god-area' + (state.selArea === a.id ? ' sel' : ''), AREA_NAMES[a.id] ?? a.name);
        b.type = 'button';
        b.addEventListener('click', () => {
          state.selArea = state.selArea === a.id ? null : a.id;
          this.onChange?.();
        });
        areaRow.append(b);
      }
      sel.append(areaRow);
    }
    this.expandedEl.append(sel);

    if (state.note) {
      const note = div('god-note', state.note);
      if (!state.note.includes('Nothing') && !state.note.includes('Pick')) note.classList.add('ok');
      this.expandedEl.append(note);
    }

    appendAdvance(this.expandedEl, 'brut tiny god-quiet-advance');

    const scroll = div('god-int-scroll');
    const grid = div('god-int-grid');
    const catalogue = run.interventions();
    const focused = catalogue.filter(({ def }) => {
      if (state.showAllInterventions || run.god.boardUnlocked) return true;
      if (state.suggested.size) return state.suggested.has(def.id);
      return ['bless', 'bounty', 'curse', 'descend', 'whisper'].includes(def.id);
    });
    for (const { def, affordable } of focused) {
      const card = div('god-int');
      card.dataset.id = def.id;
      if (state.suggested.has(def.id)) card.classList.add('suggested');
      const why = blockedReason(run, def, state);
      const usable = affordable && !why && !state.busy;
      if (!usable) card.classList.add('off');
      if (NEEDS_CONFIRM.has(def.id)) card.classList.add('danger');
      const headRow = div('god-int-head');
      headRow.append(div('god-int-name', def.name));
      headRow.append(
        div('god-int-badge', `${def.cost} INF`)
      );
      card.append(headRow);
      card.append(
        div('god-int-cost', `${def.chaos >= 0 ? '+' : ''}${def.chaos} CHAOS · ${TARGET_LABEL[def.targeting]}`)
      );
      card.append(div('god-int-desc', def.desc));
      if (why) card.append(div('god-int-block', why));
      card.addEventListener('click', () => {
        if (!usable) return;
        if (NEEDS_CONFIRM.has(def.id)) this.onConfirm?.(def);
        else this.fire(hooks, def, state);
      });
      grid.append(card);
    }
    scroll.append(grid);
    this.expandedEl.append(scroll);

    if (!run.god.boardUnlocked) {
      this.expandedEl.append(
        button(state.showAllInterventions ? 'FEWER LEVERS' : 'SHOW ALL INTERVENTIONS', () => {
          state.showAllInterventions = !state.showAllInterventions;
          this.onChange?.();
        }, 'brut tiny')
      );
    }
  }

  private fire(hooks: GodHooks, def: InterventionDef, state: ActionStripState): void {
    state.busy = true;
    state.pendingDef = null;
    const res: SpendResult = hooks.intervene(
      def.id,
      state.selA,
      def.targeting === 'pair' ? state.selB : null,
      state.selArea
    );
    state.busy = false;
    state.note = res.ok ? 'CONDITION WRITTEN — ADVANCE WHEN READY' : res.reason ?? 'Nothing happened.';
    state.suggested.clear();
    this.onChange?.();
  }
}

function slot(
  label: string,
  id: string | null,
  run: GodRun,
  onClear: () => void,
  onInspect: () => void
): HTMLElement {
  const row = div('god-slot');
  row.append(div('god-slot-label', label));
  const n = run.mgr.byId(id);
  if (!n) {
    row.append(div('god-slot-empty', 'CLICK CAST · SHIFT+CLICK FOR B'));
    return row;
  }
  const name = div('god-slot-name', fullName(n) + (n.alive ? '' : ' (DEAD)'));
  name.addEventListener('click', onInspect);
  row.append(name, button('CLEAR', onClear, 'brut tiny'));
  return row;
}

function blockedReason(run: GodRun, def: InterventionDef, state: ActionStripState): string {
  if (def.targeting === 'pair' && (!state.selA || !state.selB)) return 'Pick two characters.';
  if (def.targeting === 'nemesis' && !state.selA) return 'Pick a character.';
  if (def.targeting === 'area' && !state.selArea) return 'Pick ground.';
  if (def.targeting === 'dead') {
    const dead = run.mgr.dead();
    if (!dead.length) return 'Nobody is dead yet.';
    if (!state.selA || run.mgr.byId(state.selA)?.alive) return 'Pick one of the dead.';
  }
  return '';
}

const TARGET_LABEL: Record<string, string> = {
  none: 'NO TARGET',
  nemesis: 'ONE CHARACTER',
  pair: 'TWO CHARACTERS',
  area: 'GROUND',
  dead: 'ONE OF THE DEAD',
};

const NEEDS_CONFIRM = new Set(['descend', 'calamity', 'raise']);

export { NEEDS_CONFIRM, blockedReason };
