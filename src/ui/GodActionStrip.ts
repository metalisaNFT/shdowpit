/**
 * Collapsible intervention strip for THE LONG GAME.
 */

import { button, clear, div } from './Dom';
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
  readonly root = div('god-action-strip hidden');

  onChange: (() => void) | null = null;
  onConfirm: ((def: InterventionDef) => void) | null = null;
  onAdvance: (() => void) | null = null;
  onInspect: ((id: string) => void) | null = null;

  render(run: GodRun, hooks: GodHooks, state: ActionStripState): void {
    if (!state.expanded) {
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.remove('hidden');
    clear(this.root);

    const head = div('god-strip-head', 'INTERFERE — CONDITIONS, NEVER OUTCOMES');
    this.root.append(head);

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
        const b = div('god-area' + (state.selArea === a.id ? ' sel' : ''), AREA_NAMES[a.id] ?? a.name);
        b.addEventListener('click', () => {
          state.selArea = state.selArea === a.id ? null : a.id;
          this.onChange?.();
        });
        areaRow.append(b);
      }
      sel.append(areaRow);
    }
    this.root.append(sel);

    if (state.note) this.root.append(div('god-note', state.note));

    if (run.spentThisCycle) {
      const go = button('ADVANCE ▸', () => this.onAdvance?.());
      go.id = 'god-advance';
      go.classList.add('god-quiet-advance', 'ready');
      this.root.append(go);
    }

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
      card.append(div('god-int-name', def.name));
      card.append(
        div('god-int-cost', `${def.cost} INF · ${def.chaos >= 0 ? '+' : ''}${def.chaos} CHAOS · ${TARGET_LABEL[def.targeting]}`)
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
    this.root.append(grid);

    if (!run.god.boardUnlocked) {
      this.root.append(
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
    state.note = res.ok ? '' : res.reason ?? 'Nothing happened.';
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
    row.append(div('god-slot-empty', 'PICK FROM THE MAP OR NOW CARD'));
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
