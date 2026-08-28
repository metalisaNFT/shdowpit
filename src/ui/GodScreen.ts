/**
 * THE LONG GAME — oracle UI.
 *
 * Single-focus narrative surface over the live 3D viewport: hybrid clock,
 * territory map, NOW card, collapsible intervene strip, and drawers.
 */

import { button, clear, div, show } from './Dom';
import type { Nemesis } from '../nemesis/Nemesis';
import { fullName } from '../nemesis/Nemesis';
import type { GodRun } from '../god/GodRun';
import type { InterventionDef, SpendResult } from '../god/Interventions';
import { chaosTier } from '../god/Influence';
import { type Beat, type Situation } from '../god/GodTypes';
import type { GodClockState } from '../god/Clock';
import { CHAOS_HERESY_AT, type GuideEvent } from '../god/Teaching';
import { livingFactions } from '../god/Factions';
import { GodTeachRail, type RailHandlers } from './GodTutorial';
import { GodNowCard, type NowCardModel } from './GodNowCard';
import { GodActionStrip, type ActionStripState, blockedReason } from './GodActionStrip';
import { GodFeedDrawer } from './GodFeedDrawer';
import { GodInspectDrawer } from './GodInspectDrawer';
import { GodMap, situationAreaId, topUrgentAreas } from './GodMap';
import { GodActorRail } from './GodActorRail';

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
  chronicleFor?(n: Nemesis): string;
  beatVoiceFor?(b: Beat): string | null;
  crisisVoiceFor?(): string | null;
  aftermathLinkFor?(cycle: number, label: string, text: string): string;
  situationVoiceFor?(s: Situation): string | null;
  inspectCharacter?(n: Nemesis): void;
  clearAftermath?(): void;
  clearDescentReport?(): void;
  onTeach?(ev: GuideEvent): void;
  openSettings?(): void;
  onAreaFocus?(areaId: string): void;
  onClockToggle?(): void;
  onClockDismiss?(): void;
}

type UiPhase = 'observe' | 'interfere' | 'confirm' | 'aftermath' | 'descent_return' | 'beat_pause';

export class GodScreen {
  readonly root = div('screen hidden god-screen oracle');
  private hooks: GodHooks | null = null;

  private topBar = div('god-topbar');
  private clockEl = div('god-clock');
  private clockFill = div('god-clock-fill');
  private clockLabel = div('god-clock-label');
  private bodyEl = div('god-oracle-body');
  private footEl = div('god-oracle-foot');
  private flashEl = div('god-flash hidden');
  private overlayEl = div('god-overlay hidden');
  private flashTimer = 0;

  readonly map = new GodMap();
  readonly actors = new GodActorRail();
  readonly now = new GodNowCard();
  readonly action = new GodActionStrip();
  readonly feed = new GodFeedDrawer();
  readonly inspectDrawer = new GodInspectDrawer();
  readonly teach = new GodTeachRail();

  private stripState: ActionStripState = {
    selA: null,
    selB: null,
    selArea: null,
    suggested: new Set(),
    showAllInterventions: false,
    pendingDef: null,
    note: '',
    busy: false,
    expanded: false,
  };

  private phase: UiPhase = 'observe';
  private pauseBeat: Beat | null = null;
  private aftermathLinkIdx = 0;
  private pendingDef: InterventionDef | null = null;
  private spectacleBeat: Beat | null = null;
  private liveCaption = '';
  private clockState: GodClockState = 'paused';
  private boardOpen = false;

  constructor() {
    this.root.id = 'god-screen';
    this.clockEl.append(this.clockFill, this.clockLabel);
    this.bodyEl.append(this.actors.root, this.now.root, this.action.root, this.feed.root, this.inspectDrawer.root);
    this.root.append(this.topBar, this.teach.root, this.bodyEl, this.footEl, this.flashEl, this.overlayEl);

    this.action.onChange = () => this.render();
    this.action.onConfirm = (def) => this.confirmIntervention(def);
    this.action.onAdvance = () => this.hooks?.advance(1);
    this.action.onInspect = (id) => this.openInspect(id);

    this.now.onInterfere = () => this.openInterfere();
    this.now.onDismiss = () => this.hooks?.onClockDismiss?.();
    this.now.onWhy = () => this.hooks?.onTeach?.('whyOpened');
    this.feed.onBeatClick = () => this.hooks?.onTeach?.('beatOpened');

    this.inspectDrawer.onClose = () => {
      this.inspectDrawer.open(null);
      this.render();
    };
    this.inspectDrawer.onSetA = (id) => {
      this.stripState.selA = id;
      this.stripState.expanded = true;
      this.render();
    };
    this.inspectDrawer.onSetB = (id) => {
      this.stripState.selB = id;
      this.stripState.expanded = true;
      this.render();
    };

    this.map.onAreaClick = (areaId) => {
      const run = this.hooks?.run();
      if (run) {
        const sit = run.situations.find((s) => situationAreaId(run, s.actors) === areaId);
        if (sit) this.selectSituation(sit);
        else run.god.focusSituationId = null;
      }
      this.map.setFocus(areaId);
      this.hooks?.onAreaFocus?.(areaId);
      this.render();
    };
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
    document.body.classList.add('god-oracle-active');
    this.render();
  }

  hide(): void {
    show(this.root, false);
    document.body.classList.remove('god-oracle-active');
    this.inspectDrawer.open(null);
    this.stripState.expanded = false;
    this.spectacleBeat = null;
    this.liveCaption = '';
  }

  setClock(state: GodClockState, frac: number, label: string): void {
    this.clockState = state;
    this.clockLabel.textContent = label;
    this.clockFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.clockEl.dataset.state = state;
  }

  setPauseBeat(b: Beat | null): void {
    this.pauseBeat = b;
    if (b) this.phase = 'beat_pause';
    this.render();
  }

  setCaption(text: string): void {
    this.liveCaption = text;
    this.now.setCaption(text);
  }

  setSpectacleBeat(b: Beat | null): void {
    this.spectacleBeat = b;
    if (b) this.phase = 'observe';
    this.render();
  }

  isSpectating(): boolean {
    return !!this.spectacleBeat;
  }

  tickMap(dt: number): void {
    this.map.tick(dt);
  }

  flash(text: string, tone: 'neutral' | 'hot' | 'gold' = 'neutral', ms = 3000): void {
    this.flashEl.textContent = text;
    this.flashEl.className = `god-flash tone-${tone}`;
    show(this.flashEl, true);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => show(this.flashEl, false), ms) as unknown as number;
  }

  markNoticed(_id: string, headline: string): void {
    this.flash(`SOMEONE NOTICED — ${headline}`, 'gold', 4500);
  }

  inspect(id: string | null): void {
    this.openInspect(id);
  }

  expandBeat(_id: string): void {
    this.feed.toggle();
    this.render();
  }

  refresh(): void {
    if (!this.visible) return;
    this.syncPhaseFromRun();
    this.render();
    this.map.sync();
  }

  private openInspect(id: string | null): void {
    this.inspectDrawer.open(id);
    this.render();
  }

  private openInterfere(): void {
    this.ensureSituationTargets();
    this.stripState.expanded = true;
    this.phase = 'interfere';
    this.render();
  }

  private ensureSituationTargets(): void {
    const run = this.hooks?.run();
    if (!run || this.phase === 'confirm') return;
    const sit = this.primarySituation(run);
    if (!sit) return;
    this.stripState.selA = sit.actors[0] ?? this.stripState.selA;
    this.stripState.selB = sit.actors[1] ?? null;
    if (!this.stripState.suggested.size && sit.suggest.length) {
      this.stripState.suggested = new Set(sit.suggest);
    }
  }

  private confirmIntervention(def: InterventionDef): void {
    this.ensureSituationTargets();
    this.pendingDef = def;
    this.phase = 'confirm';
    this.render();
  }

  private syncPhaseFromRun(): void {
    const run = this.hooks?.run();
    if (!run) return;
    if (run.god.lastDescentReport) {
      this.phase = 'descent_return';
      return;
    }
    if (run.god.lastAftermath && this.phase !== 'beat_pause') {
      this.phase = 'aftermath';
      return;
    }
    if (this.pendingDef) {
      this.phase = 'confirm';
      return;
    }
    if (this.pauseBeat) {
      this.phase = 'beat_pause';
      return;
    }
    if (!run.god.openingDone && run.god.focusSituationId) {
      const focus = run.situations.find((s) => s.id === run.god.focusSituationId);
      if (focus && !this.stripState.selA) this.selectSituation(focus, false);
    }
  }

  private render(): void {
    const h = this.hooks;
    if (!h) return;
    const run = h.run();
    this.map.bind(run);
    this.map.draw();

    this.renderTop(run, h);
    this.renderActors(run, h);
    this.renderNow(run, h);
    this.action.render(run, h, { ...this.stripState, pendingDef: this.pendingDef });
    this.root.classList.toggle('god-strip-open', this.stripState.expanded);
    this.feed.render(run, h);
    this.inspectDrawer.render(run, h);
    this.renderFoot(run, h);
    this.renderOverlay(run, h);
  }

  private renderTop(run: GodRun, h: GodHooks): void {
    clear(this.topBar);
    const god = run.god;
    const act = run.act();
    const tier = chaosTier(god.chaos);
    const left = div('god-top-left');
    left.append(
      div('god-title', 'THE LONG GAME'),
      div('god-sub', `RUN ${god.run} · CYCLE ${god.cycle} · ${act.name}`)
    );
    const meters = div('god-meters compact');
    meters.append(meter('INF', `${Math.round(god.influence)}/${god.influenceMax}`, god.influence / god.influenceMax, 'good'));
    meters.append(meter('CHAOS', `${Math.round(god.chaos)} ${tier.name}`, god.chaos / 100, god.chaos > 60 ? 'hot' : 'gold'));
    if (god.chaos >= CHAOS_HERESY_AT - 8) {
      meters.append(div('god-meter-note', 'HERESY NEAR'));
    }
    const clockWrap = div('god-clock-wrap');
    this.clockEl.onclick = () => this.hooks?.onClockToggle?.();
    clockWrap.append(this.clockEl, div('god-clock-hint', clockHint(this.clockState)));
    const right = div('god-top-right');
    const crisis = god.crisis;
    if (crisis && crisis.resolved === 'none') {
      const voice = h.crisisVoiceFor?.() ?? crisis.description;
      right.append(
        div('god-crisis-label', crisis.title),
        div('god-crisis-body', voice),
        div('god-crisis-meta', `${run.cyclesLeft()} LEFT`)
      );
    } else {
      const intent = run.intentionBlurb();
      right.append(div('god-intent-title', intent.title));
    }
    this.topBar.append(left, meters, clockWrap, right);
  }

  private renderActors(run: GodRun, h: GodHooks): void {
    const sit = this.primarySituation(run);
    const ids = sit?.actors ?? [];
    this.actors.render(
      run,
      h,
      ids,
      this.stripState.selA,
      this.stripState.selB,
      (id) => {
        if (this.stripState.selA !== id) this.stripState.selA = id;
        else if (this.stripState.selB !== id) this.stripState.selB = id;
        this.render();
      },
      (id) => this.openInspect(id)
    );
  }

  private renderNow(run: GodRun, h: GodHooks): void {
    let model: NowCardModel;

    if (this.spectacleBeat?.spectacle) {
      const b = this.spectacleBeat;
      model = {
        mode: 'spectacle',
        kicker: 'COMBAT · LIVE',
        headline: b.headline,
        body: b.detail[0],
        beat: b,
        tone: b.tone === 'gold' ? 'gold' : b.tone === 'bad' ? 'hot' : 'neutral',
        caption: this.liveCaption,
      };
    } else if (this.phase === 'beat_pause' && this.pauseBeat) {
      const b = this.pauseBeat;
      const voice = h.beatVoiceFor?.(b);
      model = {
        mode: 'beat',
        kicker: `${b.priority.toUpperCase()} · CYCLE ${b.cycle}`,
        headline: b.headline,
        caption: voice && voice !== b.headline ? voice : undefined,
        beat: b,
        tone: b.tone === 'gold' ? 'gold' : b.tone === 'bad' ? 'hot' : 'neutral',
        showDismiss: true,
      };
    } else if (this.phase === 'aftermath' && run.god.lastAftermath) {
      const a = run.god.lastAftermath;
      const link = a.links[this.aftermathLinkIdx] ?? a.links[0];
      const text = link ? h.aftermathLinkFor?.(a.cycle, link.label, link.text) ?? link.text : a.intention;
      model = {
        mode: 'aftermath',
        kicker: `CYCLE ${a.cycle} · CONSEQUENCE`,
        headline: aftermathHeadline(a.intention),
        body: text,
        showDismiss: true,
      };
    } else {
      const sit = this.primarySituation(run);
      const voice = sit ? h.situationVoiceFor?.(sit) : null;
      model = {
        mode: 'situation',
        kicker: sit ? (KIND_LABEL[sit.kind] ?? sit.kind.toUpperCase()) : 'OBSERVE',
        headline: voice ?? sit?.headline ?? 'THE WORLD TURNS',
        body: sit && !voice ? sit.detail : undefined,
        situation: sit ?? undefined,
        showInterfere: !!sit,
      };
      if (sit) {
        this.ensureSituationTargets();
        this.map.setFocus(situationAreaId(run, sit.actors));
        run.god.focusSituationId = sit.id;
      }
    }

    this.now.render(model, run);
    const sit = model.situation;
    if (sit?.suggest.includes('descend') && this.stripState.selA && !this.spectacleBeat) {
      const row = run.interventions().find((x) => x.def.id === 'descend');
      if (row?.affordable && !blockedReason(run, row.def, this.stripState)) {
        this.now.appendAction('DESCEND ▸', () => this.confirmIntervention(row.def));
      }
    }
  }

  private primarySituation(run: GodRun): Situation | undefined {
    if (this.boardOpen) return run.situations[0];
    const focus = run.god.focusSituationId
      ? run.situations.find((s) => s.id === run.god.focusSituationId)
      : null;
    return focus ?? run.situations[0];
  }

  private selectSituation(s: Situation, rerender = true): void {
    this.stripState.selA = s.actors[0] ?? null;
    this.stripState.selB = s.actors[1] ?? null;
    this.stripState.suggested = new Set(s.suggest);
    this.stripState.note = '';
    this.pendingDef = null;
    const run = this.hooks?.run();
    if (run) {
      run.god.focusSituationId = s.id;
      this.map.setFocus(situationAreaId(run, s.actors));
      this.hooks?.onAreaFocus?.(situationAreaId(run, s.actors));
    }
    if (rerender) {
      this.hooks?.onTeach?.('situationSelected');
      this.render();
    }
  }

  private renderFoot(run: GodRun, h: GodHooks): void {
    clear(this.footEl);
    const stats = div('god-foot-stats');
    stats.append(
      div('god-stat', `${run.mgr.living().length} ALIVE`),
      div('god-stat', `${livingFactions(run.god).length} HOUSES`),
      div('god-stat', `${run.god.conditions.filter((c) => c.source === 'god').length} MARKS`)
    );
    const controls = div('god-foot-controls');
    controls.append(
      button(this.boardOpen ? 'FOCUS ONE' : 'OPEN BOARD', () => {
        this.boardOpen = !this.boardOpen;
        this.render();
      }, 'brut tiny'),
      button(this.feed.isOpen() ? 'CLOSE FEED' : 'OPEN FEED', () => {
        this.feed.toggle();
        this.render();
      }, 'brut tiny'),
      button('INTERFERE', () => this.openInterfere(), 'brut tiny'),
      button('ROSTER', () => h.openRoster(), 'brut tiny'),
      button('BOOK', () => h.openLegends(), 'brut tiny')
    );
    if (h.openSettings) controls.append(button('SETTINGS', () => h.openSettings?.(), 'brut tiny'));
    controls.append(button('LEAVE', () => h.close(), 'brut tiny'));
    this.footEl.append(stats, this.map.root, controls);
  }

  private renderOverlay(run: GodRun, h: GodHooks): void {
    clear(this.overlayEl);
    if (run.god.lastDescentReport) {
      show(this.overlayEl, true);
      const r = run.god.lastDescentReport;
      const box = div('god-modal');
      box.append(div('god-modal-kicker', 'RETURN'));
      box.append(div('god-modal-title', r.targetName.toUpperCase()));
      for (const line of r.lines) box.append(div('god-modal-line', line));
      box.append(
        button('BACK ▸', () => {
          h.clearDescentReport?.();
          run.clearDescentReport();
          this.phase = 'observe';
          this.render();
        })
      );
      this.overlayEl.append(box);
      return;
    }
    if (this.pendingDef && this.phase === 'confirm') {
      show(this.overlayEl, true);
      const def = this.pendingDef;
      const box = div('god-modal');
      box.append(div('god-modal-title', def.name));
      box.append(div('god-modal-sub', def.promise));
      const row = div('god-modal-actions');
      row.append(
        button('CANCEL', () => {
          this.pendingDef = null;
          this.phase = 'interfere';
          this.render();
        }, 'brut tiny'),
        button(confirmLabel(def), () => {
          this.ensureSituationTargets();
          const res = h.intervene(def.id, this.stripState.selA, def.targeting === 'pair' ? this.stripState.selB : null, this.stripState.selArea);
          if (!res.ok) {
            this.stripState.note = res.reason ?? '';
            this.render();
            return;
          }
          this.pendingDef = null;
          this.stripState.note = '';
          this.stripState.suggested.clear();
          this.phase = 'interfere';
          this.render();
        })
      );
      box.append(row);
      this.overlayEl.append(box);
      return;
    }
    show(this.overlayEl, false);
  }

  /** Aftermath stepped via NOW card dismiss. */
  advanceAftermathStep(): boolean {
    const run = this.hooks?.run();
    if (!run?.god.lastAftermath) return false;
    const a = run.god.lastAftermath;
    if (this.aftermathLinkIdx < a.links.length - 1) {
      this.aftermathLinkIdx++;
      this.render();
      return true;
    }
    this.hooks?.clearAftermath?.();
    run.clearAftermath();
    this.aftermathLinkIdx = 0;
    this.phase = 'observe';
    this.render();
    return false;
  }

  dismissPauseBeat(): void {
    this.pauseBeat = null;
    this.phase = 'observe';
    this.render();
  }

  get urgentAreas(): string[] {
    const run = this.hooks?.run();
    return run ? topUrgentAreas(run) : ['pit'];
  }
}

function meter(label: string, value: string, frac: number, tone: string): HTMLElement {
  const el = div('god-meter compact');
  el.append(div('god-meter-label', label), div('god-meter-value', value));
  const track = div('god-meter-track');
  const fill = div('god-meter-fill ' + tone);
  fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  track.append(fill);
  el.append(track);
  return el;
}

function confirmLabel(def: InterventionDef): string {
  if (def.id === 'descend') return 'DESCEND ▸';
  if (def.id === 'calamity') return 'UNLEASH ▸';
  if (def.id === 'raise') return 'RAISE ▸';
  return 'WRITE ▸';
}

function clockHint(state: GodClockState): string {
  switch (state) {
    case 'running':
      return 'TIME MOVES · CLICK TO PAUSE';
    case 'paused':
      return 'PAUSED · CLICK TO RESUME';
    case 'intervening':
      return 'YOUR MARK IS WRITTEN · ADVANCE WHEN READY';
    case 'spectating':
      return 'WATCHING';
    case 'modal':
      return 'HELD';
    default:
      return '';
  }
}

function aftermathHeadline(intention: string): string {
  if (/spent Influence/i.test(intention)) return 'YOUR MARK';
  if (/did nothing/i.test(intention)) return 'YOU WAITED';
  return 'THE WORLD MOVED';
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

export { fullName };
