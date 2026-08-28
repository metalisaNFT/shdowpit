/**
 * THE LONG GAME — progressive board.
 *
 * Flow: focus situation → stakes → interfere? → relevant interventions →
 * confirm cost/Chaos/uncertainty → advance → load-bearing consequence →
 * deeper inspect later. Full sim stays accessible; it does not compete.
 */

import { button, clear, div, esc, show } from './Dom';
import type { Nemesis } from '../nemesis/Nemesis';
import { fullName, rankIndex } from '../nemesis/Nemesis';
import { getPersonality } from '../data/personalities';
import { traitName } from '../data/traits';
import { SCAR_NAMES, MEMORY_TEXT } from '../nemesis/NemesisMemory';
import { AREA_NAMES } from '../data/names';
import { AREAS } from '../data/areas';
import type { GodRun } from '../god/GodRun';
import type { InterventionDef, SpendResult } from '../god/Interventions';
import { CONDITION_LABEL } from '../god/Conditions';
import { chaosTier } from '../god/Influence';
import { filterFeed, groupByCycle, PRIORITY_LABEL, beatToneClass, summariseCycle, threadFor } from '../god/Feed';
import { describeFaction, factionFor, livingFactions } from '../god/Factions';
import { simOf, type Beat, type BeatPriority, type Situation } from '../god/GodTypes';
import { startingConditions } from '../god/Unlocks';
import { CHAOS_HERESY_AT, type GuideEvent } from '../god/Teaching';
import { GodTeachRail, buildWhyPanel, type RailHandlers } from './GodTutorial';

export interface GodHooks {
  run(): GodRun;
  advance(cycles: number): void;
  intervene(id: string, aId: string | null, bId: string | null, areaId: string | null): SpendResult;
  openRoster(): void;
  openLegends(): void;
  abandon(): void;
  close(): void;
  portraitFor?(n: Nemesis): string;
  displayName?(n: Nemesis): string;
  dossierFor?(n: Nemesis): string;
  beatVoiceFor?(b: Beat): string | null;
  crisisVoiceFor?(): string | null;
  aftermathLinkFor?(cycle: number, label: string, text: string): string;
  situationVoiceFor?(s: Situation): string | null;
  inspectCharacter?(n: Nemesis): void;
  /** Acknowledge aftermath / descent return and continue. */
  clearAftermath?(): void;
  clearDescentReport?(): void;
  onTeach?(ev: GuideEvent): void;
  openSettings?(): void;
}

const PRIORITIES: BeatPriority[] = ['background', 'notable', 'major', 'legendary'];

type UiPhase = 'focus' | 'interfere' | 'confirm' | 'aftermath' | 'descent_return';

export class GodScreen {
  readonly root = div('screen hidden god-screen');
  private hooks: GodHooks | null = null;

  private headEl = div('god-head');
  private boardEl = div('god-col god-board');
  private actEl = div('god-col god-interfere');
  private feedEl = div('god-col god-feed');
  private footEl = div('god-foot');
  private inspectEl = div('god-inspect hidden');
  private flashEl = div('god-flash hidden');
  private overlayEl = div('god-overlay hidden');
  private flashTimer = 0;

  private selA: string | null = null;
  private selB: string | null = null;
  private selArea: string | null = null;
  private inspecting: string | null = null;
  private feedFloor: BeatPriority = 'notable';
  private expanded = new Set<string>();
  private suggested = new Set<string>();
  private note = '';
  private busy = false;
  private noticedId: string | null = null;
  private noticedHeadline = '';
  private noticedUntil = 0;
  private phase: UiPhase = 'focus';
  private pendingDef: InterventionDef | null = null;
  private showAllInterventions = false;
  private showFullBoard = false;
  private showFullFeed = false;
  private lastInspected: string | null = null;
  private lastInspectCycle = -1;
  readonly teach = new GodTeachRail();
  private whyBeat: Beat | null = null;
  /** ×N should not trap the player in the last cycle's aftermath modal. */
  private skipAftermath = false;

  constructor() {
    this.root.id = 'god-screen';
    const cols = div('god-cols');
    cols.append(this.boardEl, this.actEl, this.feedEl);
    this.root.append(this.headEl, this.teach.root, cols, this.inspectEl, this.flashEl, this.overlayEl, this.footEl);
  }

  bindTeach(handlers: RailHandlers): void {
    this.teach.bind(handlers);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(hooks: GodHooks): void {
    this.hooks = hooks;
    this.syncPhaseFromRun();
    show(this.root, true);
    this.render();
  }

  hide(): void {
    show(this.root, false);
    this.inspecting = null;
    this.lastInspected = null;
    this.lastInspectCycle = -1;
  }

  flash(text: string, tone: 'neutral' | 'hot' | 'gold' = 'neutral', ms = 3000): void {
    this.flashEl.textContent = text;
    this.flashEl.className = `god-flash tone-${tone}`;
    show(this.flashEl, true);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => show(this.flashEl, false), ms) as unknown as number;
  }

  markNoticed(id: string, headline: string): void {
    this.noticedId = id;
    this.noticedHeadline = headline;
    this.noticedUntil = performance.now() + 8000;
    this.flash(`SOMEONE NOTICED — ${headline}`, 'gold', 4500);
    if (this.visible) this.render();
  }

  inspect(id: string | null): void {
    this.inspecting = id;
    this.render();
  }

  expandBeat(id: string): void {
    this.expanded.add(id);
    this.showFullFeed = true;
    this.render();
  }

  refresh(): void {
    if (!this.visible) return;
    this.syncPhaseFromRun();
    this.render();
  }

  private syncPhaseFromRun(): void {
    const run = this.hooks?.run();
    if (!run) return;
    if (this.skipAftermath) {
      this.skipAftermath = false;
      if (run.god.lastAftermath) run.clearAftermath();
      this.showFullFeed = true;
    }
    if (run.god.lastDescentReport) {
      this.phase = 'descent_return';
      return;
    }
    if (run.god.lastAftermath) {
      this.phase = 'aftermath';
      return;
    }
    if (this.pendingDef) {
      this.phase = 'confirm';
      return;
    }
    if (!run.god.openingDone && run.god.focusSituationId) {
      this.phase = this.suggested.size || this.selA ? 'interfere' : 'focus';
      const focus = run.situations.find((s) => s.id === run.god.focusSituationId);
      if (focus && !this.selA) this.selectSituation(focus, false);
      return;
    }
    this.phase = this.selA || this.suggested.size ? 'interfere' : 'focus';
  }

  private render(): void {
    const h = this.hooks;
    if (!h) return;
    const run = h.run();
    this.renderHead(run);
    this.renderBoard(run);
    this.renderInterfere(run);
    this.renderFeed(run);
    this.renderInspect(run);
    this.renderFoot(run);
    this.renderOverlay(run);
  }

  private renderHead(run: GodRun): void {
    clear(this.headEl);
    const god = run.god;
    const tier = chaosTier(god.chaos);
    const act = run.act();
    const intent = run.intentionBlurb();

    const left = div('god-head-left');
    left.append(
      div('god-title', 'THE LONG GAME'),
      div('god-sub', `RUN ${god.run} · CYCLE ${god.cycle} · ${act.name}`),
      div('god-loop', 'FOCUS → INTERFERE? → ADVANCE → CONSEQUENCE')
    );

    const meters = div('god-meters');
    meters.append(
      meter('INFLUENCE', `${round1(god.influence)} / ${god.influenceMax}`, god.influence / god.influenceMax, 'good'),
      meter('CHAOS', `${Math.round(god.chaos)} · ${tier.name}`, god.chaos / 100, god.chaos > 60 ? 'hot' : 'gold')
    );
    if (god.chaos >= CHAOS_HERESY_AT - 8) {
      meters.append(div('god-meter-note', `HERESY FROM ${CHAOS_HERESY_AT} — THEY MAY SEE THE HAND`));
    }

    const right = div('god-head-right');
    const crisis = god.crisis;
    if (crisis && crisis.resolved === 'none') {
      right.append(
        div('god-crisis-label', crisis.title),
        div('god-crisis-body', `${run.cyclesLeft()} CYCLES LEFT`)
      );
    } else {
      right.append(div('god-intent-title', intent.title), div('god-act-blurb', intent.body));
    }

    this.headEl.append(left, meters, right);
  }

  private visibleSituations(run: GodRun): Situation[] {
    const sits = run.situations;
    if (this.showFullBoard || run.god.boardUnlocked) return sits;
    const focus = sits.find((s) => s.id === run.god.focusSituationId) ?? sits[0];
    if (!focus) return sits;
    if (!run.god.openingDone) return [focus];
    return sits.slice(0, 3);
  }

  private renderBoard(run: GodRun): void {
    clear(this.boardEl);
    const opening = !run.god.openingDone;
    this.boardEl.append(
      colHead('OBSERVE', opening ? 'YOUR OPENING — ONE THING THAT MATTERS' : 'WHAT IS ABOUT TO MATTER')
    );
    if (this.noticedId && performance.now() > this.noticedUntil) this.noticedId = null;

    const sits = this.visibleSituations(run);
    if (!sits.length) {
      this.boardEl.append(div('god-empty', 'The world is quiet. That will not last.'));
      return;
    }
    for (const s of sits) {
      const card = div('god-sit');
      card.classList.add('urg-' + urgencyBand(s.urgency));
      if (this.selA && s.actors.includes(this.selA)) card.classList.add('sel');
      if (run.god.focusSituationId === s.id) card.classList.add('focus');
      if (this.noticedId === s.id) card.classList.add('noticed');
      card.append(div('god-sit-kind', KIND_LABEL[s.kind] ?? s.kind.toUpperCase()));
      if (run.god.focusSituationId === s.id && opening) {
        card.append(div('god-sit-focus', 'FOCUS'));
      }
      const voice = this.hooks?.situationVoiceFor?.(s);
      card.append(div('god-sit-head', voice ?? s.headline));
      if (!voice) card.append(div('god-sit-detail', s.detail));
      if (this.noticedId === s.id) {
        card.prepend(div('god-sit-noticed', 'SOMEONE NOTICED'));
      }
      if (s.suggest.length) {
        card.append(div('god-sit-hint', `LEVERS · ${s.suggest.map((x) => x.toUpperCase()).join(' · ')}`));
      }
      card.addEventListener('click', () => this.selectSituation(s));
      this.boardEl.append(card);
    }

    if (!run.god.boardUnlocked && run.situations.length > sits.length) {
      this.boardEl.append(
        button(this.showFullBoard ? 'HIDE THE REST' : `SEE THE REST OF THE BOARD (${run.situations.length - sits.length})`, () => {
          this.showFullBoard = !this.showFullBoard;
          if (this.showFullBoard) run.markOpeningProgress(true);
          this.render();
        }, 'brut tiny')
      );
    }

    if (
      this.noticedId &&
      (this.noticedId.startsWith('cond:') || this.noticedId.startsWith('beat:')) &&
      !sits.some((s) => s.id === this.noticedId)
    ) {
      const banner = div('god-sit noticed');
      banner.append(div('god-sit-noticed', 'SOMEONE NOTICED'));
      banner.append(div('god-sit-head', this.noticedHeadline || 'THE CONDITION HOLDS'));
      this.boardEl.prepend(banner);
    }
  }

  private selectSituation(s: Situation, rerender = true): void {
    this.selA = s.actors[0] ?? null;
    this.selB = s.actors[1] ?? null;
    this.suggested = new Set(s.suggest);
    this.note = '';
    this.pendingDef = null;
    this.phase = 'interfere';
    const run = this.hooks?.run();
    if (run) run.god.focusSituationId = s.id;
    if (rerender) {
      this.hooks?.onTeach?.('situationSelected');
      this.render();
    }
  }

  private renderInterfere(run: GodRun): void {
    clear(this.actEl);
    const opening = !run.god.openingDone;
    this.actEl.append(
      colHead(
        'INTERFERE',
        opening ? 'FEW LEVERS — OR DO NOTHING AND ADVANCE' : 'CONDITIONS, NEVER OUTCOMES'
      )
    );

    const focus = run.situations.find((s) => s.id === run.god.focusSituationId) ?? run.situations[0];
    if (focus && (this.phase === 'focus' || opening)) {
      const stakes = div('god-stakes');
      stakes.append(
        div('god-stakes-label', 'STAKES'),
        div('god-stakes-body', focus.detail),
        div(
          'god-stakes-hint',
          'Interfere to write a condition. Or advance and let autonomy answer what is already true.'
        )
      );
      this.actEl.append(stakes);
    }

    const sel = div('god-sel');
    sel.append(
      this.slot('A', this.selA, run, () => {
        this.selA = null;
        this.render();
      })
    );
    sel.append(
      this.slot('B', this.selB, run, () => {
        this.selB = null;
        this.render();
      })
    );
    if (run.god.boardUnlocked || this.showAllInterventions) {
      const areaRow = div('god-area-row');
      areaRow.append(div('god-slot-label', 'GROUND'));
      for (const a of AREAS) {
        const b = div('god-area' + (this.selArea === a.id ? ' sel' : ''), AREA_NAMES[a.id] ?? a.name);
        b.addEventListener('click', () => {
          this.selArea = this.selArea === a.id ? null : a.id;
          this.render();
        });
        areaRow.append(b);
      }
      sel.append(areaRow);
    }
    this.actEl.append(sel);

    if (this.note) this.actEl.append(div('god-note', this.note));

    if (run.spentThisCycle) {
      const go = button('ADVANCE ▸', () => {
        this.hooks?.advance(1);
      });
      go.id = 'god-col-advance';
      go.classList.add('god-quiet-advance', 'ready');
      this.actEl.append(go);
      this.actEl.append(
        div('god-quiet-hint', 'Your marks are written. Advance to see what they do.')
      );
    } else {
      const quiet = button('DO NOTHING — ADVANCE ▸', () => {
        const h = this.hooks;
        if (!h) return;
        h.run().noteQuietAdvance();
        h.advance(1);
      });
      quiet.id = 'god-col-advance';
      quiet.classList.add('god-quiet-advance');
      this.actEl.append(quiet);
      this.actEl.append(
        div('god-quiet-hint', 'Autonomy is honest: they choose. You only change what it costs.')
      );
    }

    const grid = div('god-int-grid');
    const catalogue = run.interventions();
    const focused = catalogue.filter(({ def }) => {
      if (this.showAllInterventions || run.god.boardUnlocked) return true;
      if (this.suggested.size) return this.suggested.has(def.id);
      return ['bless', 'bounty', 'curse', 'descend', 'whisper'].includes(def.id);
    });
    for (const { def, affordable } of focused) {
      const card = div('god-int');
      card.dataset.id = def.id;
      if (this.suggested.has(def.id)) card.classList.add('suggested');
      const why = this.blockedReason(run, def);
      const usable = affordable && !why && !this.busy;
      if (!usable) card.classList.add('off');
      card.append(div('god-int-name', def.name));
      card.append(
        div(
          'god-int-cost',
          `${def.cost} INF · ${def.chaos >= 0 ? '+' : ''}${def.chaos} CHAOS · ${TARGET_LABEL[def.targeting]}`
        )
      );
      card.append(div('god-int-desc', def.desc));
      card.append(div('god-int-promise', def.promise));
      if (why) card.append(div('god-int-block', why));
      else if (!affordable) card.append(div('god-int-block', 'Not enough influence.'));
      card.addEventListener('click', () => {
        if (!usable) return;
        if (NEEDS_CONFIRM.has(def.id)) {
          this.pendingDef = def;
          this.phase = 'confirm';
          this.render();
        } else {
          this.fire(def);
        }
      });
      grid.append(card);
    }
    this.actEl.append(grid);

    if (!run.god.boardUnlocked) {
      this.actEl.append(
        button(this.showAllInterventions ? 'FEWER LEVERS' : 'SHOW ALL INTERVENTIONS', () => {
          this.showAllInterventions = !this.showAllInterventions;
          this.render();
        }, 'brut tiny')
      );
    }
  }

  private blockedReason(run: GodRun, def: InterventionDef): string {
    if (def.targeting === 'pair' && (!this.selA || !this.selB)) return 'Pick two characters.';
    if (def.targeting === 'nemesis' && !this.selA) return 'Pick a character.';
    if (def.targeting === 'area' && !this.selArea) return 'Pick ground.';
    if (def.targeting === 'dead') {
      const dead = run.mgr.dead();
      if (!dead.length) return 'Nobody is dead yet.';
      if (!this.selA || run.mgr.byId(this.selA)?.alive) return 'Pick one of the dead.';
    }
    return '';
  }

  private fire(def: InterventionDef): void {
    const h = this.hooks;
    if (!h) return;
    this.busy = true;
    this.pendingDef = null;
    this.phase = 'interfere';
    const res = h.intervene(def.id, this.selA, def.targeting === 'pair' ? this.selB : null, this.selArea);
    this.busy = false;
    this.note = res.ok ? '' : res.reason ?? 'Nothing happened.';
    this.suggested.clear();
    this.render();
  }

  private slot(label: string, id: string | null, run: GodRun, onClear: () => void): HTMLElement {
    const row = div('god-slot');
    row.append(div('god-slot-label', label));
    const n = run.mgr.byId(id);
    if (!n) {
      row.append(div('god-slot-empty', 'NOBODY — CLICK A SITUATION'));
      return row;
    }
    const name = div('god-slot-name', fullName(n) + (n.alive ? '' : ' (DEAD)'));
    name.addEventListener('click', () => {
      this.inspecting = n.id;
      this.render();
    });
    row.append(name, button('CLEAR', onClear, 'brut tiny'));
    return row;
  }

  private renderFeed(run: GodRun): void {
    clear(this.feedEl);
    this.feedEl.append(colHead('CONSEQUENCES', this.showFullFeed ? 'THE FEED' : 'LOAD-BEARING FIRST'));

    if (!this.showFullFeed && run.god.lastAftermath) {
      // Aftermath owns the overlay; keep a short teaser here.
      this.feedEl.append(div('god-empty', 'Read the consequence chain, then open the full feed.'));
      return;
    }

    const filter = div('god-filter');
    for (const p of PRIORITIES) {
      const b = div('god-filter-btn' + (this.feedFloor === p ? ' sel' : ''), PRIORITY_LABEL[p]);
      b.addEventListener('click', () => {
        this.feedFloor = p;
        this.showFullFeed = true;
        this.render();
      });
      filter.append(b);
    }
    this.feedEl.append(filter);

    const floor = this.showFullFeed || run.god.boardUnlocked ? this.feedFloor : 'notable';
    const feedSource = this.selA ? filterFeed(run.god.feed, floor, this.selA) : run.god.feed;
    const groups = groupByCycle(feedSource, this.selA ? 'background' : floor).slice(0, this.showFullFeed ? 14 : 4);
    if (!groups.length) {
      this.feedEl.append(div('god-empty', 'Nothing at this level yet. Advance once.'));
      return;
    }
    for (const g of groups) {
      this.feedEl.append(div('god-cycle-head', summariseCycle(g.cycle, g.beats)));
      for (const b of g.beats.slice().reverse()) this.feedEl.append(this.beatEl(b, run));
    }
    if (!this.showFullFeed) {
      this.feedEl.append(
        button('OPEN FULL FEED', () => {
          this.showFullFeed = true;
          this.render();
        }, 'brut tiny')
      );
    }
  }

  private beatEl(b: Beat, run: GodRun): HTMLElement {
    const el = div(`god-beat ${beatToneClass(b)} pr-${b.priority}`);
    const voice = this.hooks?.beatVoiceFor?.(b);
    const head = div('god-beat-head', voice && voice !== b.headline ? voice : b.headline);
    head.addEventListener('click', () => {
      if (this.expanded.has(b.id)) this.expanded.delete(b.id);
      else {
        this.expanded.add(b.id);
        this.hooks?.onTeach?.('beatOpened');
      }
      this.render();
    });
    el.append(head);
    if (this.expanded.has(b.id)) {
      const body = div('god-beat-body');
      for (const line of b.detail) body.append(div('god-beat-line', line));
      const voice = this.hooks?.beatVoiceFor?.(b);
      if (voice && voice !== b.headline) body.append(div('god-beat-line god-beat-voice', voice));
      const who = div('god-beat-actors');
      for (const id of b.actors) {
        const n = run.mgr.byId(id);
        if (!n) continue;
        const chip = div('god-chip', fullName(n));
        chip.addEventListener('click', () => {
          this.inspecting = n.id;
          this.selA = n.id;
          this.render();
        });
        who.append(chip);
      }
      if (who.childElementCount) body.append(who);
      if (b.why) {
        const whyBtn = button('WHY', () => {
          this.whyBeat = this.whyBeat?.id === b.id ? null : b;
          this.hooks?.onTeach?.('whyOpened');
          this.render();
        }, 'brut tiny');
        body.append(whyBtn);
        if (this.whyBeat?.id === b.id) {
          body.append(
            buildWhyPanel(b, () => {
              this.whyBeat = null;
              this.render();
            })
          );
        }
      }
      el.append(body);
    }
    return el;
  }

  private renderOverlay(run: GodRun): void {
    clear(this.overlayEl);
    const h = this.hooks;
    if (!h) return;

    if (run.god.lastDescentReport) {
      show(this.overlayEl, true);
      const r = run.god.lastDescentReport;
      const box = div('god-modal');
      box.append(div('god-modal-kicker', 'RETURN TO THE LONG GAME'));
      box.append(div('god-modal-title', r.targetName.toUpperCase()));
      box.append(div('god-modal-sub', `OUTCOME · ${r.outcome.replace('_', ' ').toUpperCase()} · ${r.cyclesElapsed} CYCLES PASSED`));
      for (const line of r.lines) box.append(div('god-modal-line', line));
      box.append(
        button('BACK TO THE BOARD ▸', () => {
          h.clearDescentReport?.();
          run.clearDescentReport();
          this.phase = 'focus';
          this.render();
        })
      );
      this.overlayEl.append(box);
      return;
    }

    if (run.god.lastAftermath && this.phase === 'aftermath') {
      show(this.overlayEl, true);
      const a = run.god.lastAftermath;
      const box = div('god-modal');
      box.append(div('god-modal-kicker', `CYCLE ${a.cycle} — CONSEQUENCE`));
      box.append(div('god-modal-title', aftermathHeadline(a.intention)));
      box.append(div('god-modal-sub', a.intention));
      for (const link of a.links) {
        const row = div('god-chain');
        const text =
          this.hooks?.aftermathLinkFor?.(a.cycle, link.label, link.text) ?? link.text;
        row.append(div('god-chain-label', link.label), div('god-chain-text', text));
        box.append(row);
      }
      box.append(div('god-modal-uncertainty', a.uncertainty));
      box.append(
        button('CONTINUE ▸', () => {
          h.clearAftermath?.();
          run.clearAftermath();
          this.showFullFeed = true;
          this.phase = 'focus';
          const whyBeat = run.god.feed.find((b) => b.why && b.cycle === a.cycle);
          if (whyBeat) this.whyBeat = whyBeat;
          this.render();
        })
      );
      this.overlayEl.append(box);
      return;
    }

    if (this.pendingDef && this.phase === 'confirm') {
      show(this.overlayEl, true);
      const def = this.pendingDef;
      const a = run.mgr.byId(this.selA);
      const b = run.mgr.byId(this.selB);
      const box = div('god-modal');
      box.append(div('god-modal-kicker', 'CONFIRM CONDITION'));
      box.append(div('god-modal-title', def.name));
      box.append(div('god-modal-sub', def.promise));
      box.append(
        div(
          'god-modal-line',
          `COST · ${def.cost} INFLUENCE · ${def.chaos >= 0 ? '+' : ''}${def.chaos} CHAOS`
        )
      );
      if (a) box.append(div('god-modal-line', `TARGET · ${fullName(a)}${b ? ` / ${fullName(b)}` : ''}`));
      if (def.id === 'descend' && a) {
        box.append(
          div(
            'god-modal-line hot',
            'You will enter 3D. Cycles continue without you. Kill, spare, retreat, or die — each writes the board.'
          )
        );
      }
      box.append(
        div(
          'god-modal-uncertainty',
          'This writes a condition, not an outcome. They still choose. Uncertainty is the game.'
        )
      );
      const row = div('god-modal-actions');
      row.append(
        button('CANCEL', () => {
          this.pendingDef = null;
          this.phase = 'interfere';
          this.render();
        }, 'brut tiny')
      );
      row.append(
        button(def.id === 'descend' ? 'DESCEND ▸' : 'WRITE THE CONDITION ▸', () => this.fire(def))
      );
      box.append(row);
      this.overlayEl.append(box);
      return;
    }

    show(this.overlayEl, false);
  }

  private renderInspect(run: GodRun): void {
    clear(this.inspectEl);
    const n = run.mgr.byId(this.inspecting);
    if (!n) {
      show(this.inspectEl, false);
      return;
    }
    show(this.inspectEl, true);
    const h = this.hooks;
    if (this.lastInspected !== n.id || this.lastInspectCycle !== run.god.cycle) {
      this.lastInspected = n.id;
      this.lastInspectCycle = run.god.cycle;
      h?.inspectCharacter?.(n);
    }
    const s = simOf(n);
    const p = getPersonality(n.personality);
    const f = factionFor(run.god, n);
    const showScores = startingConditions(run.mgr.data.godUnlocks ?? []).showScores;

    const head = div('god-ins-head');
    const shown = h?.displayName?.(n) ?? fullName(n);
    const portrait = h?.portraitFor?.(n);
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
        `${n.rank.toUpperCase()} · ${n.archetype.toUpperCase()} · ${p.name} · ${f ? f.name : 'UNSWORN'} · ${AREA_NAMES[n.territory] ?? n.territory.toUpperCase()}`
      )
    );
    if (f) names.append(div('god-ins-line', describeFaction(run.mgr, f)));
    names.append(div('god-ins-line', n.alive ? `POWER ${n.power} · LEVEL ${n.level}` : 'DEAD'));
    head.append(names);
    const closeBtn = button(
      'CLOSE',
      () => {
        this.inspecting = null;
        this.render();
      },
      'brut tiny'
    );
    head.append(closeBtn);
    this.inspectEl.append(head);

    const dossier = h?.dossierFor?.(n);
    if (dossier) this.inspectEl.append(div('god-ins-dossier', dossier));

    const grid = div('god-ins-grid');
    grid.append(
      bar('CONFIDENCE', s.confidence),
      bar('FEAR', s.fear),
      bar('AMBITION', s.ambition),
      bar('LOYALTY', s.loyalty),
      bar('WOUNDS', s.injury),
      bar('STANDING', Math.max(0, Math.min(100, 50 + n.playerRelationship / 2)))
    );
    this.inspectEl.append(grid);

    const facts = div('god-ins-facts');
    facts.append(
      div(
        'god-ins-fact',
        `GOAL — ${GOAL_LABEL[s.goal] ?? s.goal.toUpperCase()}${s.goalTargetId ? `: ${run.mgr.byId(s.goalTargetId) ? fullName(run.mgr.byId(s.goalTargetId)!) : '—'}` : ''} (held ${s.goalAge})`
      )
    );
    facts.append(
      div('god-ins-fact', `${s.wins}W ${s.losses}L · ${s.kills.length} KILLED · ${s.flights} FLED · ${n.returns} RETURNS`)
    );
    if (n.strengths.length) facts.append(div('god-ins-fact', 'STRENGTHS — ' + n.strengths.map(traitName).join(', ')));
    if (n.weaknesses.length) facts.append(div('god-ins-fact', 'WEAKNESSES — ' + n.weaknesses.map(traitName).join(', ')));
    if (n.scars.length) facts.append(div('god-ins-fact', 'SCARS — ' + n.scars.map((x) => SCAR_NAMES[x.id]).join(', ')));
    if (n.stolen.length) facts.append(div('god-ins-fact', 'CARRYING — ' + n.stolen.map((x) => x.name).join(', ')));
    const conds = run.god.conditions.filter((c) => c.targetId === n.id);
    if (conds.length) {
      facts.append(
        div(
          'god-ins-fact',
          'ON THEM — ' + conds.map((c) => `${CONDITION_LABEL[c.kind]} (${c.expiresCycle - run.god.cycle})`).join(', ')
        )
      );
    }
    this.inspectEl.append(facts);

    const thread = threadFor(run.god.feed, n.id).slice(-6).reverse();
    if (thread.length) {
      const sec = div('god-ins-thread');
      sec.append(div('god-ins-fact', 'RECENT CONSEQUENCES'));
      for (const b of thread) sec.append(div(`god-ins-thread-line ${beatToneClass(b)}`, b.headline));
      this.inspectEl.append(sec);
    }

    const crisisVoice = h?.crisisVoiceFor?.();
    if (crisisVoice && run.god.crisis?.bodyId === n.id) {
      this.inspectEl.append(div('god-ins-fact', crisisVoice));
    }

    const rel = div('god-ins-rel');
    if (s.revengeTargets.length) {
      rel.append(div('god-ins-fact hot', 'WANTS — ' + s.revengeTargets.map((id) => this.nameOf(run, id)).join(', ')));
    }
    if (n.rivalries.length) rel.append(div('god-ins-fact', 'RIVALS — ' + n.rivalries.map((id) => this.nameOf(run, id)).join(', ')));
    if (n.allies.length) rel.append(div('god-ins-fact', 'SWORN WITH — ' + n.allies.map((id) => this.nameOf(run, id)).join(', ')));
    if (n.master) rel.append(div('god-ins-fact', 'SERVES — ' + this.nameOf(run, n.master)));
    this.inspectEl.append(rel);

    const mem = div('god-ins-mem');
    mem.append(div('god-ins-fact', 'REMEMBERS'));
    for (const m of n.memory.slice(-8).reverse()) {
      mem.append(div('god-mem-line', `${MEMORY_TEXT[m.type]}${m.subject ? ' — ' + this.nameOf(run, m.subject) : ''}`));
    }
    this.inspectEl.append(mem);

    if (s.deeds.length) {
      const deeds = div('god-ins-deeds');
      deeds.append(div('god-ins-fact', 'DEEDS'));
      for (const d of s.deeds.slice(-6).reverse()) deeds.append(div('god-mem-line', `C${d.cycle} — ${d.text}`));
      this.inspectEl.append(deeds);
    }

    if (showScores) {
      const dec = run.god.decisions.find((d) => d.actorId === n.id);
      if (dec) {
        const box = div('god-ins-scores');
        box.append(div('god-ins-fact', 'THE READING — WHAT THEY WEIGHED LAST CYCLE'));
        for (const c of dec.considered.slice(0, 5)) {
          box.append(
            div(
              'god-mem-line' + (c.actionId === dec.chosen?.actionId && c.targetId === dec.chosen?.targetId ? ' hot' : ''),
              `${c.actionName}${c.targetName ? ' → ' + c.targetName : ''} · ${c.total}`
            )
          );
        }
        this.inspectEl.append(box);
      }
    }

    const acts = div('god-ins-actions');
    acts.append(
      button('SET A', () => {
        this.selA = n.id;
        this.render();
      }),
      button('SET B', () => {
        this.selB = n.id;
        this.render();
      })
    );
    this.inspectEl.append(acts);
  }

  private nameOf(run: GodRun, id: string): string {
    const n = run.mgr.byId(id);
    return n ? fullName(n) : '—';
  }

  private renderFoot(run: GodRun): void {
    clear(this.footEl);
    const h = this.hooks;
    if (!h) return;

    const stats = div('god-foot-stats');
    stats.append(
      div('god-stat', `${run.mgr.living().length} ALIVE`),
      div('god-stat', `${livingFactions(run.god).length} HOUSES`),
      div('god-stat', `${run.god.conditions.filter((c) => c.source === 'god').length} OF YOUR MARKS`)
    );
    this.footEl.append(stats);

    const controls = div('god-foot-controls');
    if (run.god.openingDone && !run.spentThisCycle) {
      for (const n of [5, 20]) {
        controls.append(
          button(`×${n}`, () => {
            this.skipAftermath = true;
            if (!h.run().spentThisCycle) h.run().noteQuietAdvance();
            h.advance(n);
          }, 'brut tiny')
        );
      }
    }
    controls.append(button('THE ROSTER', () => h.openRoster(), 'brut tiny'));
    controls.append(button('THE BOOK', () => h.openLegends(), 'brut tiny'));
    if (h.openSettings) controls.append(button('SETTINGS', () => h.openSettings?.(), 'brut tiny'));
    controls.append(button('LEAVE', () => h.close(), 'brut tiny'));
    controls.append(button('ABANDON', () => h.abandon(), 'brut tiny danger'));
    this.footEl.append(controls);
  }
}

function colHead(title: string, sub: string): HTMLElement {
  const el = div('god-col-head');
  el.append(div('god-col-title', title), div('god-col-sub', sub));
  return el;
}

function meter(label: string, value: string, frac: number, tone: string): HTMLElement {
  const el = div('god-meter');
  el.append(div('god-meter-label', label));
  el.append(div('god-meter-value', value));
  const track = div('god-meter-track');
  const fill = div('god-meter-fill ' + tone);
  fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  track.append(fill);
  el.append(track);
  return el;
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

function urgencyBand(u: number): string {
  return u > 0.75 ? 'high' : u > 0.5 ? 'mid' : 'low';
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

const KIND_LABEL: Record<string, string> = {
  rivalry: 'RIVALRY',
  ascendant: 'CLIMBING',
  wounded: 'BLEEDING',
  grudge: 'GRUDGE',
  faction_war: 'WAR',
  power_vacuum: 'VACUUM',
  underdog: 'UNDERDOG',
  revenge: 'REVENGE',
  betrayal_risk: 'DISLOYALTY',
  territory: 'GROUND',
  heresy: 'HERESY',
  crisis: 'CRISIS',
  condition: 'YOUR MARK',
};

const TARGET_LABEL: Record<string, string> = {
  none: 'NO TARGET',
  nemesis: 'ONE CHARACTER',
  pair: 'TWO CHARACTERS',
  area: 'GROUND',
  dead: 'ONE OF THE DEAD',
};

/** Irreversible or expensive — keep the confirm step. Cheap marks write on click. */
const NEEDS_CONFIRM = new Set(['descend', 'calamity', 'raise']);

function aftermathHeadline(intention: string): string {
  if (/spent Influence/i.test(intention)) return 'YOUR MARK';
  if (/did nothing/i.test(intention)) return 'YOU WAITED';
  return 'THE WORLD MOVED';
}

const GOAL_LABEL: Record<string, string> = {
  survive: 'STAY ALIVE',
  climb: 'CLIMB',
  revenge: 'REVENGE',
  protect: 'PROTECT',
  hoard: 'TAKE THINGS',
  conquer: 'TAKE EVERYTHING',
  hide: 'NOT BE FOUND',
  serve: 'SERVE',
  destroy_god: 'DESTROY YOU',
};

export { esc, rankIndex };
