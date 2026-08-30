/**
 * Developer overlay (F1).
 *
 * Emergent systems are almost impossible to test by playing normally, so this
 * panel can force any interesting world state on demand: promote someone,
 * scar them, make them escape, kill them, bring them back, hand them the crown.
 *
 * It also carries the live readout — including AI queue state — because the
 * game is mostly simulation and simulation is invisible.
 *
 * It never displays the API key. There is no code path here that could: the
 * key is not in the browser at all.
 */

import { button, clear, div, el, esc, show } from './Dom';
import type { Rank } from '../nemesis/Nemesis';
import { POWERS, type PowerId } from '../data/abilities';
import { AREAS } from '../data/areas';

export interface DebugLiveState {
  fps: number;
  playerState: string;
  playerHp: string;
  enemies: number;
  enemiesAlive: number;
  worldTurn: number;
  worldAge: number;
  ageName: string;
  area: string;
  namedAlive: number;
  mode: string;
  heat?: number;
}

export interface DebugAIState {
  provider: string;
  connection: string;
  mode: string;
  queue: number;
  active: number;
  cachedText: number;
  cachedPortraits: number;
  lastRequest: string;
  lastResult: string;
  latency: string;
  requests: string[];
}

/**
 * THE LONG GAME's developer readout.
 *
 * The brief is right that an emergent system is close to untestable without
 * this: the interesting failure is never "it crashed", it is "everyone chose
 * to hide for nine cycles and nobody can see why". So the panel shows the
 * actual utility scores that produced each decision, not a summary of them.
 */
export interface GodDebugDecision {
  actor: string;
  chosen: string;
  /** "ATTACK -> VORG  12.4  (per 3.2 rel 5.0 mem 1.1 need -0.4 dgr 2.0 opp 0 amb 1.5 noise 0.6)" */
  considered: string[];
}

export interface GodDebugState {
  run: number;
  cycle: number;
  act: string;
  phase: string;
  influence: string;
  chaos: string;
  living: number;
  factions: string[];
  crisis: string;
  conditions: string[];
  decisions: GodDebugDecision[];
}

export interface DebugCombatRow {
  uid: number;
  label: string;
  state: string;
  intent: string;
  combatState: string;
  attack: string;
  telegraph: number;
  posture: number;
  broken: boolean;
  staggerLeft: number;
  slowed: boolean;
  poisoned: boolean;
}

export type DebugDrawFlag = 'vectors' | 'hitboxes' | 'hurtboxes' | 'trajectories';

export interface DebugHooks {
  spawnNemesis(rank: Rank): void;
  spawnGrunt(): void;
  summonNemesis(id: string): void;
  killPlayer(): void;
  damagePlayer(amount: number): void;
  healPlayer(): void;
  killAllEnemies(): void;
  killTarget(id: string): void;
  advanceWorld(): void;
  advanceAge(): void;
  promote(id: string): void;
  demote(id: string): void;
  makeOverlord(id: string): void;
  scarTarget(id: string): void;
  forceEscape(id: string): void;
  forceBetrayal(id: string): void;
  forceResurrection(id: string): void;
  grantArmor(): boolean;
  openBook(id: string): void;
  giveAbility(id: PowerId): void;
  teleport(areaId: string): void;
  toggleInvulnerable(): boolean;
  toggleInfiniteSurge(): boolean;
  setTimeScale(s: number): void;
  getTimeScale(): number;
  toggleDraw(flag: DebugDrawFlag): boolean;
  drawFlags(): Record<DebugDrawFlag, boolean>;
  forceAttack(kind: 'any' | 'slam' | 'projectile'): string;
  grantStat(id: string, count: number): void;
  runStats(): Array<{ name: string; text: string; count: number }>;
  combatState(): DebugCombatRow[];
  /** animation QA readout: states, clip time, vectors, hitbox, root motion */
  animState(): Record<string, unknown>;
  resetRun(): void;
  resetSave(): void;
  listNemeses(): Array<{ id: string; label: string }>;
  inspect(id: string): string;
  inspectMemory(id: string): string;
  lastEncounter(): Record<string, unknown> | null;
  playEncounter(kind: string): void;
  stageNemesisLoop(id: string): void;
  /** Force the generative comic combat 4-panel vertical slice. */
  forceComicSlice(): Record<string, unknown>;
  worldSummary(): string;
  liveState(): DebugLiveState;
  aiState(): DebugAIState;
  regenerateAI(id: string): void;
  clearAICache(): void;
  saveNow(): void;
  depthAction(cmd: string): void;
  storyAction(cmd: string): string;
  resetSkillCooldowns(): void;
  freezeSkillCooldowns(): boolean;
  fillSurge(): void;
  forceUltimate(): void;
  unlockAllSkills(): void;
  equipSkill(slot: 0 | 1, id: string): void;
  equipUltimate(id: string): void;
  kitDump(): Record<string, unknown>;
  progressAction(cmd: string, arg?: string): string;

  /* ---- THE LONG GAME. Absent (or null) when no god run is live. ---- */
  godState?(): GodDebugState | null;
  /** accelerated simulation — 1 / 5 / 20 / 100 cycles, resolved synchronously */
  godAdvance?(cycles: number): void;
  godAddInfluence?(amount: number): void;
  godAddChaos?(amount: number): void;
  godForceCrisis?(): string;
  godEndRun?(): void;
  godStart?(): void;
}

export class DebugOverlay {
  readonly root = div('layer hidden');
  private panel = div();
  private perf = div();
  private live = el('pre');
  private aiPre = el('pre');
  private combatPre = el('pre');
  private animPre = el('pre');
  private select = el('select');
  private inspectPre = el('pre');
  private memPre = el('pre');
  private godPre = el('pre');
  private godDecPre = el('pre');
  private hooks: DebugHooks | null = null;
  private invuln = false;
  private infSurge = false;

  constructor() {
    this.panel.id = 'debug';
    this.perf.id = 'perf';
    this.root.append(this.panel, this.perf);
    this.root.style.pointerEvents = 'none';
    this.panel.style.pointerEvents = 'auto';
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(hooks: DebugHooks): boolean {
    if (this.visible) {
      show(this.root, false);
      return false;
    }
    this.hooks = hooks;
    this.build();
    show(this.root, true);
    return true;
  }

  refresh(): void {
    if (this.visible) this.build();
  }

  /** Cheap per-frame update of just the readouts, no DOM rebuild. */
  tick(): void {
    if (!this.visible || !this.hooks) return;
    this.renderLive();
    this.renderAI();
    this.renderCombat();
    this.renderAnim();
    this.renderGod();
  }

  private renderGod(): void {
    const g = this.hooks?.godState?.() ?? null;
    if (!g) {
      this.godPre.textContent = 'no run in progress';
      this.godDecPre.textContent = '';
      return;
    }
    this.godPre.textContent = [
      `run ${g.run}  cycle ${g.cycle}  ${g.act}  [${g.phase}]`,
      `influence ${g.influence}   chaos ${g.chaos}`,
      `living ${g.living}`,
      `crisis   ${g.crisis}`,
      `houses   ${g.factions.join(' | ') || '—'}`,
      `marks    ${g.conditions.length ? g.conditions.join(', ') : 'none'}`,
    ].join('\n');
    const lines: string[] = [];
    for (const d of g.decisions.slice(0, 10)) {
      lines.push(`${d.actor}  ->  ${d.chosen}`);
      for (const c of d.considered) lines.push('    ' + c);
    }
    this.godDecPre.textContent = lines.join('\n') || 'nothing decided yet';
  }

  /**
   * The animation QA display required by the test scene: animation state,
   * clip time, forward vs attack vector, live hitbox and root motion — for
   * the player and every enemy on stage.
   */
  private renderAnim(): void {
    const h = this.hooks;
    if (!h) return;
    const s = h.animState() as {
      player: {
        state: string;
        clip: string;
        clipTime: number;
        phase: string;
        forward: { x: number; z: number };
        attackVector: { x: number; z: number } | null;
        hitboxActive: boolean;
        rootMotion: { x: number; z: number };
      };
      enemies: Array<{ arch: string; state: string; clip: string; clipTime: number; combatState: string; attack: string | null }>;
      timeScale: number;
    };
    const p = s.player;
    const lines = [
      `YOU  ${p.state} ${p.clip} t=${p.clipTime.toFixed(2)} phase=${p.phase}${p.hitboxActive ? ' [HITBOX]' : ''}`,
      `     fwd(${p.forward.x.toFixed(2)},${p.forward.z.toFixed(2)})` +
        (p.attackVector ? ` atk(${p.attackVector.x.toFixed(2)},${p.attackVector.z.toFixed(2)})` : '') +
        ` rootMotion(${p.rootMotion.x.toFixed(1)},${p.rootMotion.z.toFixed(1)})  time x${s.timeScale}`,
    ];
    for (const e of s.enemies.slice(0, 6)) {
      lines.push(`${e.arch.padEnd(7)} ${e.state} ${e.clip} t=${e.clipTime.toFixed(2)} ${e.combatState}${e.attack ? ' ' + e.attack : ''}`);
    }
    this.animPre.textContent = lines.join('\n');
  }

  /** The combat QA readout: every live enemy's state, intent and timers. */
  private renderCombat(): void {
    const h = this.hooks;
    if (!h) return;
    const rows = h.combatState();
    if (!rows.length) {
      this.combatPre.textContent = '(no live enemies)';
      return;
    }
    const lines: string[] = [];
    for (const r of rows.slice(0, 14)) {
      const flags =
        (r.broken ? ' BROKEN' : '') +
        (r.staggerLeft > 0 ? ` STAGGER ${r.staggerLeft.toFixed(2)}s` : '') +
        (r.slowed ? ' SLOW' : '') +
        (r.poisoned ? ' POISON' : '');
      const tele = r.telegraph > 0 ? `  ⚠ ${r.attack} in ${r.telegraph.toFixed(2)}s` : r.attack ? `  ${r.attack}` : '';
      lines.push(`${r.label.padEnd(16).slice(0, 16)} ${r.state}/${r.intent} ${r.combatState}`);
      lines.push(`  posture ${String(r.posture).padStart(3)}%${tele}${flags}`);
    }
    this.combatPre.textContent = lines.join('\n');
  }

  private renderLive(): void {
    const h = this.hooks;
    if (!h) return;
    const s = h.liveState();
    this.live.textContent = [
      `FPS            ${s.fps.toFixed(0)}`,
      `MODE           ${s.mode.toUpperCase()}`,
      `PLAYER STATE   ${s.playerState.toUpperCase()}`,
      `PLAYER HP      ${s.playerHp}`,
      `ENEMY COUNT    ${s.enemiesAlive} alive / ${s.enemies}`,
      `NAMED ALIVE    ${s.namedAlive}`,
      `WORLD TURN     ${s.worldTurn}`,
      `WORLD AGE      ${s.worldAge} — ${s.ageName}`,
      `AREA           ${s.area}`,
    ].join('\n');
  }

  private renderAI(): void {
    const h = this.hooks;
    if (!h) return;
    const a = h.aiState();
    const lines = [
      `PROVIDER       ${a.provider.toUpperCase()}`,
      `CONNECTION     ${a.connection}`,
      `MODE           ${a.mode.toUpperCase()}`,
      `QUEUE          ${a.queue}`,
      `ACTIVE         ${a.active}`,
      `CACHED TEXT    ${a.cachedText}`,
      `CACHED IMAGES  ${a.cachedPortraits}`,
      `LAST REQUEST   ${a.lastRequest}`,
      `LAST RESULT    ${a.lastResult}`,
      `LATENCY        ${a.latency}`,
    ];
    if (a.requests.length) {
      lines.push('', 'IN FLIGHT');
      for (const r of a.requests) lines.push('  ' + r);
    }
    // No key, no prefix, no length. There is nothing here to leak.
    this.aiPre.textContent = lines.join('\n');
  }

  private build(): void {
    const h = this.hooks;
    if (!h) return;
    clear(this.panel);

    this.panel.append(el('h4', undefined, 'SHDOWPIT DEBUG'));

    this.panel.append(el('h4', undefined, 'LIVE'));
    this.panel.append(this.live);
    this.renderLive();

    this.panel.append(el('h4', undefined, 'AI STATUS'));
    this.panel.append(this.aiPre);
    this.renderAI();
    this.panel.append(button('CLEAR AI CACHE', () => { h.clearAICache(); this.build(); }, ''));

    if (h.godState) {
      this.panel.append(el('h4', undefined, 'THE LONG GAME'));
      this.panel.append(this.godPre);
      const live = !!h.godState();
      if (!live && h.godStart) this.panel.append(button('START A RUN', () => { h.godStart!(); this.build(); }, ''));
      if (live) {
        // Accelerated simulation. The whole reason the duel resolver is
        // headless is so a hundred cycles cost milliseconds — which is the
        // only way to find out whether interesting stories actually emerge.
        for (const n of [1, 5, 20, 100]) {
          this.panel.append(button(`SIM ×${n}`, () => { h.godAdvance?.(n); this.build(); }, ''));
        }
        this.panel.append(button('+10 INFLUENCE', () => { h.godAddInfluence?.(10); this.build(); }, ''));
        this.panel.append(button('+25 CHAOS', () => { h.godAddChaos?.(25); this.build(); }, ''));
        this.panel.append(button('-25 CHAOS', () => { h.godAddChaos?.(-25); this.build(); }, ''));
        this.panel.append(button('FORCE CRISIS', () => { h.godForceCrisis?.(); this.build(); }, ''));
        this.panel.append(button('END RUN', () => { h.godEndRun?.(); this.build(); }, ''));
        this.panel.append(el('h4', undefined, 'CONSIDERED ACTIONS (LAST CYCLE)'));
        this.panel.append(this.godDecPre);
      }
      this.renderGod();
    }

    const summary = el('pre');
    summary.textContent = h.worldSummary();
    this.panel.append(el('h4', undefined, 'WORLD'), summary);

    this.panel.append(el('h4', undefined, 'PLAYER'));
    this.panel.append(button('DAMAGE PLAYER (25)', () => h.damagePlayer(25), ''));
    this.panel.append(button('KILL PLAYER', () => h.killPlayer(), ''));
    this.panel.append(button('FULL HEAL', () => h.healPlayer(), ''));
    const invulnBtn = button(
      `INFINITE HP: ${this.invuln ? 'ON' : 'OFF'}`,
      () => {
        this.invuln = h.toggleInvulnerable();
        invulnBtn.textContent = `INFINITE HP: ${this.invuln ? 'ON' : 'OFF'}`;
      },
      ''
    );
    this.panel.append(invulnBtn);
    const surgeBtn = button(
      `INFINITE SURGE: ${this.infSurge ? 'ON' : 'OFF'}`,
      () => {
        this.infSurge = h.toggleInfiniteSurge();
        surgeBtn.textContent = `INFINITE SURGE: ${this.infSurge ? 'ON' : 'OFF'}`;
      },
      ''
    );
    this.panel.append(surgeBtn);
    this.panel.append(el('h4', undefined, 'SKILLS'));
    this.panel.append(button('RESET SKILL CDS', () => h.resetSkillCooldowns(), ''));
    this.panel.append(button('UNLOCK ALL SKILLS', () => { h.unlockAllSkills(); this.build(); }, ''));
    this.panel.append(button('FILL SURGE', () => h.fillSurge(), ''));
    this.panel.append(button('FORCE PIT ERUPTION', () => h.forceUltimate(), ''));
    this.panel.append(button('KIT DUMP (CONSOLE)', () => console.info('[kit]', h.kitDump()), ''));

    this.panel.append(el('h4', undefined, 'PROGRESSION'));
    const progPre = el('pre');
    const refreshProg = () => {
      progPre.textContent = h.progressAction('dump');
    };
    refreshProg();
    this.panel.append(progPre);
    const progRow = div('prog-row');
    for (const [label, cmd] of [
      ['GIVE HAMMER', 'hammer'],
      ['GIVE SPEAR', 'spear'],
      ['GIVE SUN SPEAR', 'sunspear'],
      ['GIVE RANDOM WEAPON', 'randWeapon'],
      ['GIVE RANDOM ARMOR', 'randArmor'],
      ['GIVE RELIC ANVIL', 'anvil'],
      ['GIVE TOXIC LENS', 'lens'],
      ['ADD 20 CINDERS', 'cinders'],
      ['UNLOCK RIPOSTE', 'unlock:riposte'],
      ['RESET TREE', 'respec'],
      ['MAX MASTERY', 'mastery'],
      ['BUILD A HAMMER', 'buildA'],
      ['BUILD B SPEAR', 'buildB'],
      ['BUILD C SWORD', 'buildC'],
      ['SPAWN VARK', 'vark'],
      ['FORCE STEAL', 'forceSteal'],
      ['FORCE TROPHY', 'trophy'],
      ['RUN LOOT', 'runLoot'],
      ['PROC LOG', 'procs'],
      ['ACTIVE EFFECTS', 'effects'],
    ] as Array<[string, string]>) {
      progRow.append(button(label, () => { progPre.textContent = h.progressAction(cmd); }, ''));
    }
    this.panel.append(progRow);

    /* ---- combat QA ---- */
    this.panel.append(el('h4', undefined, 'COMBAT QA'));
    this.panel.append(this.combatPre);
    this.panel.append(this.animPre);
    this.renderCombat();

    const drawRow = div();
    const drawLabels: Array<[DebugDrawFlag, string]> = [
      ['vectors', 'VECTORS'],
      ['hitboxes', 'HITBOXES'],
      ['hurtboxes', 'HURTBOXES'],
      ['trajectories', 'TRAJECTORIES'],
    ];
    const flags = h.drawFlags();
    for (const [flag, label] of drawLabels) {
      const b = button(`${label}: ${flags[flag] ? 'ON' : 'OFF'}`, () => {
        const on = h.toggleDraw(flag);
        b.textContent = `${label}: ${on ? 'ON' : 'OFF'}`;
      }, '');
      drawRow.append(b);
    }
    this.panel.append(drawRow);

    const timeRow = div();
    for (const [label, scale] of [
      ['0.25x', 0.25],
      ['0.5x', 0.5],
      ['1x', 1],
    ] as Array<[string, number]>) {
      timeRow.append(button(`TIME ${label}`, () => h.setTimeScale(scale), ''));
    }
    this.panel.append(timeRow);

    const forceRow = div();
    forceRow.append(
      button('FORCE ENEMY ATTACK', () => h.forceAttack('any'), ''),
      button('FORCE HAMMER SLAM', () => h.forceAttack('slam'), ''),
      button('FORCE PROJECTILE', () => h.forceAttack('projectile'), '')
    );
    this.panel.append(forceRow);

    /* ---- run stats ---- */
    this.panel.append(el('h4', undefined, 'RUN STATS'));
    const statsPre = el('pre');
    const renderStats = () => {
      statsPre.textContent = h
        .runStats()
        .map((s) => `${s.name.padEnd(18)} ${s.text}${s.count > 0 ? `  (+${s.count})` : ''}`)
        .join('\n');
    };
    renderStats();
    this.panel.append(statsPre);

    this.panel.append(el('h4', undefined, 'SPAWN'));
    this.panel.append(button('SPAWN ENEMY', () => h.spawnGrunt(), ''));
    for (const r of ['elite', 'captain', 'warlord', 'overlord'] as Rank[]) {
      this.panel.append(
        button(`SPAWN NEMESIS — ${r.toUpperCase()}`, () => { h.spawnNemesis(r); this.build(); }, '')
      );
    }

    this.panel.append(el('h4', undefined, 'GIVE POWER'));
    const powerSel = el('select');
    for (const p of POWERS) {
      const o = el('option');
      o.value = p.id;
      o.textContent = p.name;
      powerSel.append(o);
    }
    this.panel.append(powerSel);
    this.panel.append(button('GRANT', () => h.giveAbility(powerSel.value as PowerId), ''));

    this.panel.append(el('h4', undefined, 'TELEPORT'));
    const areaSel = el('select');
    for (const a of AREAS) {
      const o = el('option');
      o.value = a.id;
      o.textContent = a.name;
      areaSel.append(o);
    }
    this.panel.append(areaSel);
    this.panel.append(button('GO', () => h.teleport(areaSel.value), ''));

    this.panel.append(el('h4', undefined, 'WORLD CONTROL'));
    this.panel.append(button('ADVANCE WORLD', () => { h.advanceWorld(); this.build(); }, ''));
    this.panel.append(button('ADVANCE AGE', () => { h.advanceAge(); this.build(); }, ''));
    this.panel.append(button('KILL ALL ENEMIES HERE', () => h.killAllEnemies(), ''));
    this.panel.append(button('RESET RUN', () => h.resetRun(), ''));
    const wipe = button('RESET SAVE', () => h.resetSave(), '');
    wipe.classList.add('danger');
    this.panel.append(wipe);
    this.panel.append(button('SAVE NOW', () => h.saveNow(), ''));

    this.panel.append(el('h4', undefined, 'TARGET'));
    clear(this.select);
    for (const n of h.listNemeses()) {
      const o = el('option');
      o.value = n.id;
      o.textContent = n.label;
      this.select.append(o);
    }
    this.select.addEventListener('change', () => this.doInspect());
    this.panel.append(this.select);
    this.panel.append(button('SUMMON HERE', () => h.summonNemesis(this.select.value), ''));
    this.panel.append(button('KILL TARGET', () => { h.killTarget(this.select.value); this.build(); }, ''));
    this.panel.append(button('PROMOTE TARGET', () => { h.promote(this.select.value); this.build(); }, ''));
    this.panel.append(button('DEMOTE TARGET', () => { h.demote(this.select.value); this.build(); }, ''));
    this.panel.append(
      button('MAKE TARGET OVERLORD', () => { h.makeOverlord(this.select.value); this.build(); }, '')
    );
    this.panel.append(button('SCAR TARGET', () => { h.scarTarget(this.select.value); this.build(); }, ''));
    this.panel.append(button('FORCE ESCAPE', () => h.forceEscape(this.select.value), ''));
    this.panel.append(
      button('FORCE REVIVAL', () => { h.forceResurrection(this.select.value); this.build(); }, '')
    );
    this.panel.append(button('FORCE BETRAYAL', () => { h.forceBetrayal(this.select.value); this.build(); }, ''));
    this.panel.append(el('h4', undefined, 'DEPTH'));
    this.panel.append(button('HEAT +20', () => h.depthAction('heat+'), ''));
    this.panel.append(button('HEAT 100', () => h.depthAction('heatmax'), ''));
    this.panel.append(button('REMNANTS +3', () => h.depthAction('remnants'), ''));
    this.panel.append(button('UNLOCK EXTRACT', () => h.depthAction('extract'), ''));
    this.panel.append(button('ACCEPT VENDETTA', () => h.depthAction('vendetta'), ''));
    this.panel.append(button('COMPLETE VENDETTA', () => h.depthAction('vendettaDone'), ''));
    this.panel.append(button('GRANT TECHNIQUE', () => h.depthAction('tech'), ''));
    this.panel.append(button('LIBERATE AREA', () => h.depthAction('liberate'), ''));
    this.panel.append(button('BLOCK FAKE DEATH', () => h.depthAction('fakedeath'), ''));
    this.panel.append(button('FORCE SURRENDER', () => h.depthAction('surrender'), ''));
    this.panel.append(button('TOWER SLICE', () => h.depthAction('verticalSlice'), ''));
    this.panel.append(button('REGENERATE AI CONTENT', () => h.regenerateAI(this.select.value), ''));
    this.panel.append(el('h4', undefined, 'STORY'));
    this.panel.append(button('OPEN WEB', () => h.storyAction('openWeb'), ''));
    this.panel.append(button('OPEN TIMELINE', () => h.storyAction('openTimeline'), ''));
    this.panel.append(button('OPEN THREADS', () => h.storyAction('openThreads'), ''));
    this.panel.append(button('FOCUS TARGET', () => h.storyAction('focus'), ''));
    this.panel.append(button('STEAL WEAPON ONTO TARGET', () => h.storyAction('steal'), ''));
    this.panel.append(button('TRANSFER TERRITORY TO TARGET', () => h.storyAction('territory'), ''));
    this.panel.append(button('GENERATE RECAP', () => { this.inspectPre.textContent = h.storyAction('recap'); }, ''));
    this.panel.append(button('INSPECT STORY', () => { this.inspectPre.textContent = h.storyAction('inspect'); }, ''));
    this.panel.append(button('RUN STORY TESTS', () => { this.inspectPre.textContent = h.storyAction('selftest'); }, ''));
    this.panel.append(button('STRESS 100 TURNS', () => { this.inspectPre.textContent = h.storyAction('stress'); }, ''));
    this.panel.append(button('CLEAR STORY VIEW', () => h.storyAction('clearLayout'), ''));
    this.panel.append(el('h4', undefined, 'ENCOUNTER'));
    this.panel.append(button('STAGE NEMESIS LOOP', () => h.stageNemesisLoop(this.select.value), ''));
    const kinds = [
      'FIRST_MEETING',
      'RETURNING_RIVAL',
      'REVENGE_ENCOUNTER',
      'AMBUSH',
      'INTERRUPTION',
      'PROMOTION_REVEAL',
      'OVERLORD_ENCOUNTER',
      'ESCAPE',
      'PLAYER_DEFEATED',
      'NEMESIS_DEFEATED',
      'FAKE_DEATH',
      'RESURRECTION_RETURN',
    ];
    const kindSel = el('select');
    for (const k of kinds) {
      const o = el('option');
      o.value = k;
      o.textContent = k;
      kindSel.append(o);
    }
    this.panel.append(kindSel);
    this.panel.append(button('PLAY ENCOUNTER', () => h.playEncounter(kindSel.value), ''));
    this.panel.append(button('COMIC SLICE (4 PANELS)', () => {
      const r = h.forceComicSlice();
      console.info('[comic]', r);
      this.build();
    }, ''));

    this.panel.append(el('h4', undefined, 'NEMESIS STATE'));
    this.panel.append(this.inspectPre);
    this.panel.append(el('h4', undefined, 'NEMESIS MEMORY'));
    this.panel.append(this.memPre);
    this.doInspect();
  }

  private doInspect(): void {
    if (!this.hooks) return;
    const id = this.select.value;
    if (!id) return;
    this.inspectPre.textContent = this.hooks.inspect(id);
    this.memPre.textContent = this.hooks.inspectMemory(id);
  }

  /** The currently selected nemesis id, surfaced for the readout. */
  get selectedId(): string {
    return this.select.value;
  }

  setPerf(fps: number, enemies: number, draws: number, tris: number): void {
    if (!this.visible) return;
    this.perf.innerHTML =
      `${fps.toFixed(0)} FPS<br>${enemies} ENEMIES<br>${draws} DRAW CALLS<br>${(tris / 1000).toFixed(1)}K TRIS`;
    void esc;
  }
}
