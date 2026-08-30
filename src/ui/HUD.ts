/**
 * The in-game HUD. Minimal by design: health, powers, where you are, and who
 * is about to kill you.
 */

import { div, el, clear, show } from './Dom';
import { AREAS, WORLD_HALF } from '../data/areas';
import type { Enemy } from '../enemy/Enemy';
import type { Player } from '../player/Player';
import { rankName } from '../nemesis/NemesisManager';
import { accentColorFor } from '../nemesis/NemesisAppearance';
import { relationshipLabel } from '../nemesis/EncounterCopy';
import { pickLine } from '../data/dialogue';
import { css, SIGNAL } from '../data/palette';
import type { SkillHudState } from '../abilities/AbilityRuntime';
import { ResourceMeter, setMeterRatio } from './primitives/ResourceMeter';
import type { LaneTiming, OverlayLane } from './OverlayGate';

export interface HudWorldInfo {
  areaName: string;
  ageName: string;
  age: number;
  turn: number;
  overlordName: string;
  worldPulse?: string;
  heat?: number;
  heatLabel?: string;
  remnants?: number;
  essence?: number;
  vendetta?: string;
  territory?: string;
  holderName?: string;
  purpose?: string[];
  showPurpose?: boolean;
  inCombat?: boolean;
  tutorial?: { title: string; body: string; glyphs: string } | null;
  landmarks?: Array<{ x: number; z: number }>;
  areaColors?: Record<string, string>;
}

const SURGE_SEGMENTS = 4;
const ARCH_GLYPH: Record<string, string> = {
  fighter: '⚔',
  heavy: '▣',
  archer: '◁',
  duelist: '◇',
  commander: '★',
};

export class HUD {
  readonly root = div('layer');

  private vitalityMeter: HTMLElement;
  private hpText = el('span');
  private powerList = div();

  private areaLabel = el('div', 'hud-tl');
  private worldLabel = el('div', 'hud-tr');
  private purpose = el('div', 'hud-purpose');
  private tutorialBox = el('div', 'hud-tutorial hidden');

  private plate = div('panel hidden plate-frame');
  private plateGlyph = div('tglyph');
  private plateName = div('tname');
  private plateTitle = div('ttitle');
  private plateKickers = div('tkickers');
  private plateQuote = div('tquote');
  private plateBarFill = div('fill');
  private platePostureFill = div('fill');
  private platePosture = div('tbar posture');
  private plateMeta = div('tmeta hidden');
  private plateBroken = div('tbroken hidden', 'POSTURE BROKEN  ·  E TO EXECUTE');

  private surgePips: HTMLElement[] = [];
  private surgeWrap = div('surge');
  private skillRow = div('skill-row');
  private skillSlots: HTMLElement[] = [];
  private lastSurgeFull = false;

  /** VOID NEEDLE charge pips */
  private needleWrap = div('needles');
  private needlePips: HTMLElement[] = [];

  private toasts = div();
  private prompt = div('hidden');
  private vignette = div();
  private flash = div();

  private banner = div('hidden');
  private bannerTimer = 0;
  private nextEl = div('overlay-next hidden');

  private minimap = el('canvas');
  private minimapLegend = div('minimap-legend');
  private mmCtx: CanvasRenderingContext2D | null;

  private ghostTimer = 0;
  private ghostRatio = 1;
  private lastHp = 1;
  private combatFocusOn = false;
  private plateTargetUid = -1;
  private plateQuoteFull = '';
  private plateQuoteIdx = 0;
  private plateQuoteTimer = 0;
  private tauntLineFor: ((n: import('../nemesis/Nemesis').Nemesis, salt: number) => string) | null = null;

  /** Optional AI-backed taunt line; falls back to template dialogue. */
  bindTauntLine(fn: (n: import('../nemesis/Nemesis').Nemesis, salt: number) => string): void {
    this.tauntLineFor = fn;
  }
  private wasPostureBroken = false;
  private pulseT = 0;

  constructor() {
    this.root.id = 'hud';

    /* health — ResourceMeter primitive with ghost on damage */
    const bl = div('hud-bl');
    this.vitalityMeter = ResourceMeter({
      label: 'VITALITY',
      value: '',
      ratio: 1,
      ghostRatio: 1,
      tone: 'hot',
      id: 'hp-bar',
      fillId: 'hp-fill',
    });
    const valEl = this.vitalityMeter.querySelector('.resource-meter-value');
    if (valEl) valEl.replaceWith(this.hpText);
    else this.vitalityMeter.querySelector('.hud-label')?.append(this.hpText);
    bl.append(this.vitalityMeter);

    /* SURGE — segmented pips earned under pressure */
    const surgeLabel = div('hud-label');
    surgeLabel.append(el('span', undefined, 'SURGE'));
    const surgeRow = div('surge-pips');
    for (let i = 0; i < SURGE_SEGMENTS; i++) {
      const pip = div('surge-pip');
      surgeRow.append(pip);
      this.surgePips.push(pip);
    }
    this.surgeWrap.append(surgeLabel, surgeRow);
    bl.append(this.surgeWrap);

    const needleLabel = div('hud-label');
    needleLabel.append(el('span', undefined, 'VOID NEEDLE'));
    this.needleWrap.append(needleLabel);
    bl.append(this.needleWrap, this.skillRow);
    this.root.append(bl);

    /* powers */
    const br = div('hud-br');
    br.append(this.powerList);
    this.root.append(br);

    /* corners */
    this.root.append(this.areaLabel, this.worldLabel, this.purpose, this.tutorialBox, this.nextEl);

    /* target plate — framed nemesis drama */
    this.plate.id = 'target-plate';
    const body = div('plate-body');
    const tbar = div('tbar health');
    tbar.append(this.plateBarFill);
    this.platePosture.append(this.platePostureFill);
    this.platePostureFill.style.background = css(SIGNAL.posture);
    body.append(this.plateName, this.plateTitle, this.plateKickers, this.plateQuote, tbar, this.platePosture, this.plateMeta, this.plateBroken);
    this.plate.append(this.plateGlyph, body);
    this.root.append(this.plate);

    /* toasts + prompt */
    this.toasts.id = 'toasts';
    this.prompt.id = 'prompt';
    this.root.append(this.toasts, this.prompt);

    /* screen feedback */
    this.vignette.id = 'vignette';
    this.flash.id = 'flash';
    this.root.append(this.vignette, this.flash);

    /* area banner */
    this.banner.id = 'area-banner';
    this.root.append(this.banner);

    /* minimap + legend */
    this.minimap.id = 'minimap';
    this.minimap.width = 150;
    this.minimap.height = 150;
    this.mmCtx = this.minimap.getContext('2d');
    this.minimapLegend.innerHTML =
      '<span class="mm-key you">YOU</span><span class="mm-key foe">FOE</span><span class="mm-key named">NAMED</span><span class="mm-key land">LAND</span>';
    this.root.append(this.minimap, this.minimapLegend);
  }

  setVisible(v: boolean): void {
    show(this.root, v);
  }

  setMinimapVisible(v: boolean): void {
    show(this.minimap, v);
    show(this.minimapLegend, v);
  }

  setScale(scale: number): void {
    this.root.style.setProperty('--hud-local-scale', String(scale));
  }

  /** Overlay lane choreography — enter/exit timing for intro → plate → execute. */
  setOverlayLane(lane: OverlayLane, timing: LaneTiming, emphasizePlate: boolean, hidePlate: boolean): void {
    this.root.dataset.overlayLane = lane;
    this.root.style.setProperty('--overlay-enter-ms', `${timing.enterMs}ms`);
    this.root.style.setProperty('--overlay-exit-ms', `${timing.exitMs}ms`);
    this.root.style.setProperty('--plate-delay-ms', `${timing.plateDelayMs}ms`);
    this.plate.classList.toggle('plate-emphasis', emphasizePlate);
    this.plate.classList.toggle('plate-lane-hidden', hidePlate);
  }

  /* ============================================================
     per-frame
     ============================================================ */

  update(
    dt: number,
    player: Player,
    world: HudWorldInfo,
    target: Enemy | null,
    enemies: Enemy[],
    shrines: Array<{ position: { x: number; z: number }; used: boolean }>
  ): void {
    this.pulseT += dt;
    const frac = Math.max(0, player.stats.hp / player.stats.maxHp);
    setMeterRatio(this.vitalityMeter, frac, this.ghostTimer > 0 ? this.ghostRatio : frac);
    this.hpText.textContent = `${Math.ceil(player.stats.hp)} / ${player.stats.maxHp}`;
    if (frac < this.lastHp) {
      this.ghostRatio = this.lastHp;
      this.ghostTimer = 0.55;
      this.vitalityMeter.classList.add('meter-hit');
      window.setTimeout(() => this.vitalityMeter.classList.remove('meter-hit'), 220);
    }
    if (this.ghostTimer > 0) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) this.ghostRatio = frac;
    }
    this.lastHp = frac;

    const sf = player.stats.surgeFrac;
    show(this.surgeWrap, sf > 0.001 || player.stats.surgeMax <= 0);
    const filled = sf * SURGE_SEGMENTS;
    for (let i = 0; i < this.surgePips.length; i++) {
      const pip = this.surgePips[i];
      const seg = Math.max(0, Math.min(1, filled - i));
      pip.classList.toggle('ready', seg >= 0.995);
      pip.classList.toggle('partial', seg > 0.05 && seg < 0.995);
      pip.style.setProperty('--fill', String(seg));
    }
    this.surgeWrap.classList.toggle('full', sf >= 0.995);
    if (sf >= 0.995 && !this.lastSurgeFull) this.surgeWrap.classList.add('ready-flash');
    else if (sf < 0.995) this.surgeWrap.classList.remove('ready-flash');
    this.lastSurgeFull = sf >= 0.995;

    /* needle charges: filled pips are ready, the charging one shows progress */
    const maxCharges = player.stats.maxRangedCharges;
    while (this.needlePips.length < maxCharges) {
      const pip = div('needle-pip');
      this.needleWrap.append(pip);
      this.needlePips.push(pip);
    }
    const charges = player.stats.rangedCharges;
    for (let i = 0; i < this.needlePips.length; i++) {
      const pip = this.needlePips[i];
      const fill = Math.max(0, Math.min(1, charges - i));
      pip.classList.toggle('ready', fill >= 1);
      pip.style.setProperty('--fill', String(fill));
    }

    this.areaLabel.innerHTML = `${world.areaName}<br><span style="opacity:.6">${world.ageName}</span>`;
    const turnLine = world.worldPulse
      ? `<span class="hud-world-pulse">${world.worldPulse}</span><br>`
      : `<span style="opacity:.45">TURN ${world.turn}</span><br>`;
    if (world.inCombat) {
      this.worldLabel.innerHTML =
        turnLine + (world.heat !== undefined ? `HEAT <b>${Math.round(world.heat)}</b> ${world.heatLabel ?? ''}` : '');
    } else {
      this.worldLabel.innerHTML =
        turnLine +
        (world.heat !== undefined ? `HEAT <b>${Math.round(world.heat)}</b> ${world.heatLabel ?? ''}<br>` : '') +
        (world.remnants !== undefined ? `REMNANTS <b>${world.remnants}</b> <span style="opacity:.55">run</span><br>` : '') +
        (world.essence !== undefined ? `ESSENCE <b>${world.essence}</b> <span style="opacity:.55">keep</span>` : '');
    }
    const lines = world.showPurpose === false ? [] : world.purpose ?? [];
    if (lines.length) {
      this.purpose.innerHTML = `<div class="hud-label">NOW</div>${lines.map((l) => `<div>${l}</div>`).join('')}`;
      this.purpose.classList.remove('hidden');
    } else {
      this.purpose.classList.add('hidden');
    }
    if (world.tutorial) {
      this.tutorialBox.classList.remove('hidden');
      const body = world.tutorial.body
        ? `<div class="ttitle">${world.tutorial.body}</div>`
        : '';
      this.tutorialBox.innerHTML = `<div class="tname">${world.tutorial.title}</div>${body}<div class="tmeta">${world.tutorial.glyphs}</div>`;
    } else {
      this.tutorialBox.classList.add('hidden');
    }

    this.tickPlateQuote(dt);
    this.updateTargetPlate(target);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) show(this.banner, false);
    }

    this.drawMinimap(player, enemies, shrines, world);
  }

  private tickPlateQuote(dt: number): void {
    if (this.plateQuoteTimer <= 0 || this.plateQuoteIdx >= this.plateQuoteFull.length) return;
    this.plateQuoteTimer -= dt;
    while (this.plateQuoteTimer <= 0 && this.plateQuoteIdx < this.plateQuoteFull.length) {
      this.plateQuoteIdx++;
      this.plateQuote.textContent = this.plateQuoteFull.slice(0, this.plateQuoteIdx);
      this.plateQuoteTimer += 0.032;
    }
    if (this.plateQuoteIdx >= this.plateQuoteFull.length) this.plateQuote.classList.remove('typing');
  }

  private updateTargetPlate(t: Enemy | null): void {
    if (!t || !t.alive || this.plate.classList.contains('plate-lane-hidden')) {
      show(this.plate, false);
      this.plateTargetUid = -1;
      return;
    }
    show(this.plate, true);
    const pf = t.combat.postureFrac;
    this.platePostureFill.style.transform = `scaleX(${pf})`;
    this.platePostureFill.style.background = pf > 0.8 ? '#ffffff' : css(SIGNAL.posture);
    const broken = t.combat.broken;
    show(this.plateBroken, broken);
    show(this.platePosture, !broken);
    if (broken && !this.wasPostureBroken) {
      this.platePosture.classList.add('posture-break');
      window.setTimeout(() => this.platePosture.classList.remove('posture-break'), 680);
    }
    this.wasPostureBroken = broken;

    const n = t.nemesis;
    this.plateBarFill.style.transform = `scaleX(${Math.max(0, t.hp / t.maxHp)})`;
    this.plateGlyph.textContent = ARCH_GLYPH[n.archetype] ?? '▽';
    this.plateGlyph.style.color = t.named ? accentColorFor(n) : '#6d6a63';

    if (t.uid !== this.plateTargetUid) {
      this.plateTargetUid = t.uid;
      this.plate.classList.remove('plate-enter');
      void this.plate.offsetWidth;
      this.plate.classList.add('plate-enter');
      const raw = t.named ? (this.tauntLineFor?.(n, n.appearanceSeed) ?? pickLine(n, 'taunt', n.appearanceSeed)) : '';
      this.plateQuoteFull = raw ? `"${raw.toUpperCase()}"` : '';
      this.plateQuoteIdx = 0;
      this.plateQuote.textContent = '';
      this.plateQuoteTimer = raw ? 0.18 : 0;
      this.plateQuote.classList.toggle('typing', !!raw);
      show(this.plateQuote, !!raw);
    }

    if (t.named) {
      this.plateName.textContent = n.name.toUpperCase();
      this.plateTitle.textContent = n.title;
      const rel = relationshipLabel(n);
      const kickers: string[] = [rankName(n.rank), `LVL ${n.level}`];
      const steel = n.stolen.find((s) => s.kind === 'weapon');
      if (steel) kickers.push(`HAS YOUR ${steel.name}`);
      else if (rel) kickers.push(rel);
      else if (n.killsAgainstPlayer > 0) kickers.push(`KILLED YOU ${n.killsAgainstPlayer}`);
      if (n.signatureKnown && n.signatureId && n.signatureId !== 'none') {
        kickers.push(n.signatureId.replace(/_/g, ' ').toUpperCase());
      }
      this.plateKickers.textContent = kickers.join('  ·  ');
      this.plateMeta.textContent = '';
      this.plateName.style.color = accentColorFor(n);
    } else {
      this.plateName.textContent = n.archetype.toUpperCase();
      this.plateTitle.textContent = '';
      this.plateKickers.textContent = t.poisoned ? 'POISONED' : t.slowTimer > 0 ? 'CRIPPLED' : '';
      this.plateMeta.textContent = '';
      this.plateName.style.color = '#9aa1ad';
    }
  }

  /* ============================================================
     one-shots
     ============================================================ */

  setSkills(slots: SkillHudState[], surgeFrac: number): void {
    while (this.skillSlots.length < slots.length) {
      const slot = div('skill-slot');
      slot.append(div('skill-icon'), div('skill-cd'), div('skill-ready-ring'), div('skill-bind'), div('skill-name'));
      this.skillRow.append(slot);
      this.skillSlots.push(slot);
    }
    for (let i = 0; i < this.skillSlots.length; i++) {
      const elSlot = this.skillSlots[i];
      const s = slots[i];
      if (!s) {
        elSlot.classList.add('hidden');
        continue;
      }
      elSlot.classList.remove('hidden');
      const frac = s.surgeNeed > 0 ? surgeFrac : 1 - s.cooldown / s.cooldownMax;
      const ready = s.slot === 'ultimate' ? surgeFrac >= 0.995 : s.ready;
      elSlot.classList.toggle('ready', ready);
      elSlot.classList.toggle('fail', s.failed > 0);
      elSlot.classList.toggle('flash', s.flash > 0);
      elSlot.classList.toggle('ult', s.slot === 'ultimate');
      elSlot.classList.toggle('empowered', s.empowered);
      (elSlot.querySelector('.skill-cd') as HTMLElement).style.setProperty('--cd', String(ready ? 1 : Math.max(0, frac)));
      (elSlot.querySelector('.skill-bind') as HTMLElement).textContent = s.bind;
      (elSlot.querySelector('.skill-name') as HTMLElement).textContent = s.name;
      (elSlot.querySelector('.skill-icon') as HTMLElement).textContent =
        s.slot === 'ultimate'
          ? '◆'
          : s.id === 'shadow_step'
            ? '⇢'
            : s.id === 'void_grasp'
              ? '☍'
              : s.id === 'spectral_guard'
                ? '▣'
                : s.id === 'hunters_brand'
                  ? '◉'
                  : s.id === 'shadow_snare'
                    ? '◌'
                    : '▽';
    }
  }

  setPowers(list: Array<{ name: string; count: number }>): void {
    clear(this.powerList);
    for (const p of list) {
      const c = div('power-chip', p.count > 1 ? `${p.name} x${p.count}` : p.name);
      this.powerList.append(c);
    }
  }

  private lastToastKey = '';
  private lastToastAt = 0;
  private toastsEnabled = true;

  setToastsEnabled(on: boolean): void {
    this.toastsEnabled = on;
  }

  toast(text: string, tone: 'neutral' | 'hot' | 'gold' | 'good' = 'neutral', ttl = 3.4): void {
    if (!this.toastsEnabled) return;
    const key = text.toUpperCase().trim();
    const now = performance.now();
    if (key === this.lastToastKey && now - this.lastToastAt < 1000) return;
    const prefix = key.slice(0, 28);
    if (prefix.length >= 12 && prefix === this.lastToastKey.slice(0, 28) && now - this.lastToastAt < 700) return;
    this.lastToastKey = key;
    this.lastToastAt = now;

    const t = div(`toast ${tone === 'neutral' ? '' : tone}`.trim(), key);
    this.toasts.prepend(t);
    window.setTimeout(() => {
      t.classList.add('fade-out');
      window.setTimeout(() => t.remove(), 520);
    }, ttl * 1000);
    while (this.toasts.childElementCount > 3) this.toasts.lastElementChild?.remove();
  }

  setStoryMode(on: boolean): void {
    this.root.classList.toggle('story-centre', on);
  }

  setCombatFocus(on: boolean): void {
    this.combatFocusOn = on;
    this.root.classList.toggle('combat-focus', on);
    this.vignette.classList.toggle('combat-vignette', on);
  }

  setNextOverlay(label: string | null): void {
    if (!label) {
      this.nextEl.textContent = '';
      this.nextEl.classList.add('hidden');
      this.nextEl.classList.remove('next-cinematic');
      return;
    }
    this.nextEl.textContent = `NEXT · ${label}`;
    this.nextEl.classList.remove('hidden');
    this.nextEl.classList.add('next-cinematic');
    void this.nextEl.offsetWidth;
    this.nextEl.classList.add('next-enter');
    window.setTimeout(() => this.nextEl.classList.remove('next-enter'), 640);
  }

  get bannerActive(): boolean {
    return this.bannerTimer > 0;
  }

  setPrompt(text: string | null): void {
    if (!text) {
      show(this.prompt, false);
      return;
    }
    this.prompt.textContent = text;
    show(this.prompt, true);
  }

  showAreaBanner(name: string, sub?: string): void {
    clear(this.banner);
    const n = div('aname', name);
    this.banner.append(n);
    if (sub) this.banner.append(div('amod', sub));
    show(this.banner, true);
    this.banner.classList.remove('banner-enter');
    void this.banner.offsetWidth;
    this.banner.classList.add('banner-enter');
    this.bannerTimer = 2.6;
  }

  setAreaBannerVisible(visible: boolean): void {
    show(this.banner, visible);
  }

  clearAreaBanner(): void {
    this.bannerTimer = 0;
    show(this.banner, false);
  }

  damageVignette(strength: number): void {
    const boost = this.combatFocusOn ? 1.25 : 1;
    this.vignette.style.boxShadow = `inset 0 0 200px 40px rgba(255,40,20,${Math.min(0.65, strength * boost)})`;
    window.setTimeout(() => {
      if (!this.combatFocusOn) {
        this.vignette.style.boxShadow = 'inset 0 0 200px 40px rgba(255,40,20,0)';
      }
    }, 90);
  }

  setLowHealth(frac: number): void {
    if (frac < 0.28) {
      const base = this.combatFocusOn ? 0.22 : 0.16;
      const pulse = base + Math.sin(performance.now() * 0.006) * 0.1;
      const spread = this.combatFocusOn ? 280 : 220;
      this.vignette.style.boxShadow = `inset 0 0 ${spread}px 60px rgba(255,30,10,${pulse})`;
    } else if (this.combatFocusOn) {
      this.vignette.style.boxShadow = 'inset 0 0 260px 80px rgba(255,30,10,0.08)';
    } else {
      this.vignette.style.boxShadow = 'inset 0 0 200px 40px rgba(255,40,20,0)';
    }
  }

  reducedFlash = false;

  screenFlash(color = '#fff', alpha = 0.5, ms = 120): void {
    if (this.reducedFlash) return;
    this.flash.style.background = color;
    this.flash.style.opacity = String(alpha);
    this.flash.style.transition = 'none';
    requestAnimationFrame(() => {
      this.flash.style.transition = `opacity ${ms}ms ease-out`;
      this.flash.style.opacity = '0';
    });
  }

  /* ============================================================
     minimap
     ============================================================ */

  private drawMinimap(
    player: Player,
    enemies: Enemy[],
    shrines: Array<{ position: { x: number; z: number }; used: boolean }>,
    world: HudWorldInfo
  ): void {
    const ctx = this.mmCtx;
    if (!ctx || this.minimap.classList.contains('hidden')) return;
    const S = 150;
    const scale = S / (WORLD_HALF * 2.1);
    const cx = S / 2;
    const cy = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(7,7,10,0.72)';
    ctx.fillRect(0, 0, S, S);

    for (const a of AREAS) {
      ctx.beginPath();
      ctx.arc(cx + a.cx * scale, cy + a.cz * scale, a.radius * scale, 0, Math.PI * 2);
      const hex = world.areaColors?.[a.id];
      ctx.fillStyle = hex ? hex + '33' : 'rgba(255,255,255,0.045)';
      ctx.fill();
      ctx.strokeStyle = hex ? hex + 'aa' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const lm of world.landmarks ?? []) {
      ctx.fillStyle = 'rgba(232,230,224,0.85)';
      ctx.fillRect(cx + lm.x * scale - 1.5, cy + lm.z * scale - 1.5, 3, 3);
    }

    for (const s of shrines) {
      if (s.used) continue;
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(cx + s.position.x * scale - 1.2, cy + s.position.z * scale - 1.2, 2.4, 2.4);
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      const x = cx + e.position.x * scale;
      const y = cy + e.position.z * scale;
      if (e.named) {
        ctx.fillStyle = accentColorFor(e.nemesis);
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      } else {
        ctx.fillStyle = 'rgba(200,90,70,0.8)';
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    const px = cx + player.position.x * scale;
    const py = cy + player.position.z * scale;
    const pulse = 0.55 + Math.sin(this.pulseT * 4.2) * 0.35;
    ctx.beginPath();
    ctx.arc(px, py, 5 + pulse * 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(196,255,46,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-player.facing);
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(3, 3);
    ctx.lineTo(-3, 3);
    ctx.closePath();
    ctx.fillStyle = '#e8e6e0';
    ctx.fill();
    ctx.restore();
  }
}
