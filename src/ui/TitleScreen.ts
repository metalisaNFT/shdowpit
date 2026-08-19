/**
 * Title screen. Also the only place the player can destroy a world, so the
 * reset button asks twice.
 */

import { button, clear, div, esc, show } from './Dom';

export interface TitleInfo {
  hasSave: boolean;
  age: number;
  ageName: string;
  turn: number;
  overlord: string;
  livingNamed: number;
  runs: number;
  deaths: number;
}

export interface TitleHandlers {
  onContinue: () => void;
  onNewWorld: () => void;
  onReset: () => void;
}

const CONTROLS: Array<[string, string]> = [
  ['WASD', 'MOVE'],
  ['MOUSE', 'LOOK'],
  ['LMB', 'LIGHT ATTACK'],
  ['RMB', 'HEAVY ATTACK'],
  ['SPACE', 'DODGE'],
  ['Q', 'PARRY'],
  ['R / MMB', 'VOID NEEDLE'],
  ['1 / C', 'SKILL 1'],
  ['2 / V', 'SKILL 2'],
  ['3 / G', 'PIT ERUPTION'],
  ['E', 'INTERACT / EXECUTE'],
  ['SHIFT', 'SPRINT'],
  ['F', 'LOCK ON'],
  ['TAB', 'THE WEB'],
  ['ESC', 'PAUSE'],
  ['F1', 'DEBUG'],
];

export class TitleScreen {
  readonly root = div('screen hidden');
  private worldEl = div('title-world');
  private actionsEl = div('actions');
  private confirmingReset = false;

  constructor() {
    this.root.id = 'title-screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'SHDOWPIT';
    const sub = div('title-sub', 'THEY REMEMBER YOU');
    this.root.append(h1, sub, this.worldEl, this.actionsEl);

    const grid = div('controls-grid');
    for (const [k, v] of CONTROLS) {
      const b = document.createElement('b');
      b.textContent = k;
      grid.append(b, document.createTextNode(v));
    }
    this.root.append(grid);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(info: TitleInfo, handlers: TitleHandlers): void {
    this.confirmingReset = false;
    clear(this.actionsEl);

    if (info.hasSave) {
      this.worldEl.innerHTML =
        `AGE <b>${info.age}</b> — <b>${esc(info.ageName)}</b><br>` +
        `WORLD TURN <b>${info.turn}</b> &nbsp; NAMED ENEMIES <b>${info.livingNamed}</b><br>` +
        `OVERLORD <b>${esc(info.overlord || '—')}</b><br>` +
        `RUNS <b>${info.runs}</b> &nbsp; DEATHS <b>${info.deaths}</b>`;
      this.actionsEl.append(button('CONTINUE', handlers.onContinue));
    } else {
      this.worldEl.innerHTML = 'NO WORLD EXISTS YET.<br>ONE WILL BE MADE FOR YOU.';
      this.actionsEl.append(button('NEW WORLD', handlers.onNewWorld));
    }

    if (info.hasSave) {
      const resetBtn = button('RESET WORLD', () => {
        if (!this.confirmingReset) {
          this.confirmingReset = true;
          resetBtn.textContent = 'ERASE EVERYTHING?';
          resetBtn.classList.add('danger');
          return;
        }
        handlers.onReset();
      });
      resetBtn.classList.add('danger');
      this.actionsEl.append(resetBtn);
    }

    show(this.root, true);
  }

  hide(): void {
    show(this.root, false);
  }
}
