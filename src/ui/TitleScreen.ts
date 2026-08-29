/**
 * Title screen. Also the only place the player can destroy a world, so the
 * reset button asks twice.
 *
 * THE LONG GAME is the main product. DESCEND ALONE is a secondary sandbox.
 * `#title-start` is the primary Long Game CTA (harnesses updated accordingly).
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
  legendCount?: number;
  /** Permanent pit starting perks unlocked across runs */
  startingPerks?: string[];
}

export interface TitleHandlers {
  onContinue: () => void;
  onNewWorld: () => void;
  onReset: () => void;
  onBuild?: () => void;
  /** THE LONG GAME — the god layer (primary path) */
  onLongGame?: () => void;
  /** Optional alone descent (sandbox / harnesses) */
  onDescendAlone?: () => void;
  /** the Book of Legends, which outlives every world */
  onLegends?: () => void;
  /** Settings (incl. AI connect / mode) — same panel as in-run pause */
  onSettings?: () => void;
  /** true when a god-layer run is suspended in the save */
  hasGodRun?: boolean;
}

export class TitleScreen {
  readonly root = div('screen hidden');
  private worldEl = div('title-world');
  private actionsEl = div('actions');
  private confirmingReset = false;
  private confirmingNewWorld = false;

  constructor() {
    this.root.id = 'title-screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'SHDOWPIT';
    const sub = div('title-sub', 'YOU ARRANGE THE WORLD');
    this.root.append(h1, sub, this.worldEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(info: TitleInfo, handlers: TitleHandlers): void {
    this.confirmingReset = false;
    this.confirmingNewWorld = false;
    clear(this.actionsEl);

    const longGame = () => {
      if (handlers.onLongGame) handlers.onLongGame();
      else handlers.onContinue();
    };
    const alone = () => {
      if (handlers.onDescendAlone) handlers.onDescendAlone();
      else handlers.onContinue();
    };

    const primaryBlock = div('title-mode title-mode-primary');
    primaryBlock.append(div('title-kicker', 'THE CAMPAIGN'));
    const primary = button(
      info.hasSave
        ? handlers.hasGodRun
          ? 'CONTINUE THE LONG GAME'
          : 'BEGIN THE LONG GAME'
        : 'BEGIN THE LONG GAME',
      longGame
    );
    primary.id = 'title-start';
    primary.classList.add('primary');
    primary.setAttribute('data-long-game', '1');
    primary.setAttribute('aria-pressed', 'true');
    primary.setAttribute('aria-controls', 'title-long-game');
    primaryBlock.append(primary);
    const alias = document.createElement('span');
    alias.id = 'title-long-game';
    alias.hidden = true;
    alias.addEventListener('click', longGame);
    primaryBlock.append(alias);
    primaryBlock.append(
      div(
        'title-hint',
        info.hasSave
          ? 'ONE SITUATION · INTERFERE OR ADVANCE · SOMEONE NOTICES'
          : 'ARRANGE CONDITIONS. LET THEM ACT. WATCH WHO NOTICES.'
      )
    );

    const secondaryBlock = div('title-mode title-mode-secondary');
    secondaryBlock.append(div('title-kicker', 'ONE RUN'));
    const descend = button('DESCEND ALONE', alone);
    descend.id = 'title-descend';
    descend.classList.add('secondary');
    descend.setAttribute('aria-pressed', 'false');
    secondaryBlock.append(descend);
    secondaryBlock.append(
      div(
        'title-hint title-hint-secondary',
        info.hasSave
          ? 'FIGHT IT YOURSELF. NOT THE CAMPAIGN.'
          : 'DROP INTO A FRESH WORLD WITH A SWORD.'
      )
    );

    if (info.hasSave) {
      const perks =
        info.startingPerks && info.startingPerks.length
          ? `<br>STARTING PERKS <b>${esc(info.startingPerks.join(' · '))}</b>`
          : '';
      this.worldEl.innerHTML =
        `AGE <b>${info.age}</b> — <b>${esc(info.ageName)}</b><br>` +
        `WORLD TURN <b>${info.turn}</b> &nbsp; NAMED ENEMIES <b>${info.livingNamed}</b><br>` +
        `OVERLORD <b>${esc(info.overlord || '—')}</b><br>` +
        `RUNS <b>${info.runs}</b> &nbsp; DEATHS <b>${info.deaths}</b>${perks}`;
    } else {
      this.worldEl.innerHTML = 'NO WORLD EXISTS YET.<br>THE LONG GAME WILL MAKE ONE.';
    }

    this.actionsEl.append(primaryBlock, div('title-or', 'OR'), secondaryBlock);

    if (info.hasSave) {
      const utilities = div('title-utilities');
      const newWorld = button('NEW WORLD', () => {
        if (!this.confirmingNewWorld) {
          this.confirmingNewWorld = true;
          newWorld.textContent = 'START FRESH WORLD?';
          newWorld.classList.add('danger');
          return;
        }
        handlers.onNewWorld();
      }, 'brut tiny');
      newWorld.id = 'title-new-world';
      utilities.append(newWorld);
      if (handlers.onBuild) utilities.append(button('PREPARE BUILD', handlers.onBuild, 'brut tiny'));
      if (handlers.onLegends && (info.legendCount ?? 0) > 0) {
        utilities.append(button('THE BOOK', handlers.onLegends, 'brut tiny'));
      }
      this.actionsEl.append(utilities);
      this.appendSettings(handlers);

      const resetBtn = button('RESET WORLD', () => {
        if (!this.confirmingReset) {
          this.confirmingReset = true;
          resetBtn.textContent = 'ERASE EVERYTHING?';
          resetBtn.classList.add('danger');
          return;
        }
        handlers.onReset();
      }, 'brut tiny danger');
      this.actionsEl.append(resetBtn);
    } else {
      this.appendSettings(handlers);
    }

    show(this.root, true);
  }

  hide(): void {
    show(this.root, false);
  }

  /** Secondary control — never competes with THE LONG GAME primary CTA. */
  private appendSettings(handlers: TitleHandlers): void {
    if (!handlers.onSettings) return;
    const b = button('SETTINGS', handlers.onSettings, 'brut tiny');
    b.id = 'title-settings';
    this.actionsEl.append(b);
  }
}
