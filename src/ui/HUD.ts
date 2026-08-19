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
import { css, SIGNAL } from '../data/palette';

export interface HudWorldInfo {
  areaName: string;
  ageName: string;
  age: number;
  turn: number;
  overlordName: string;
}

export class HUD {
  readonly root = div('layer');

  private hpFill = div('fill');
  private hpGhost = div('ghost');
  private hpText = el('span');
  private powerList = div();

  private areaLabel = el('div', 'hud-tl');
  private worldLabel = el('div', 'hud-tr');

  private plate = div('panel hidden');
  private plateName = div('tname');
  private plateTitle = div('ttitle');
  private plateBarFill = div('fill');
  /** posture, drawn under health — the second thing you are attacking */
  private platePostureFill = div('fill');
  private platePosture = div('tbar posture');
  private plateMeta = div('tmeta');
  private plateBroken = div('tbroken hidden', 'POSTURE BROKEN  ·  E TO EXECUTE');

  private surgeFill = div('fill');
  private surgeWrap = div('surge hidden');

  /** VOID NEEDLE charge pips */
  private needleWrap = div('needles');
  private needlePips: HTMLElement[] = [];

  private toasts = div();
  private prompt = div('hidden');
  private vignette = div();
  private flash = div();

  private banner = div('hidden');
  private bannerTimer = 0;

  private minimap = el('canvas');
  private mmCtx: CanvasRenderingContext2D | null;

  private ghostTimer = 0;
  private lastHp = 1;

  constructor() {
    this.root.id = 'hud';

    /* health */
    const bl = div('hud-bl');
    const label = div('hud-label');
    const l1 = el('span', undefined, 'VITALITY');
    label.append(l1, this.hpText);
    const bar = div('bar');
    bar.id = 'hp-bar';
    this.hpFill.id = 'hp-fill';
    bar.append(this.hpGhost, this.hpFill);

    // SURGE sits directly under health because it is spent under the same
    // pressure. It only appears once you have earned some.
    const surgeLabel = div('hud-label');
    surgeLabel.append(el('span', undefined, 'SURGE'));
    const surgeBar = div('bar small');
    this.surgeFill.style.background = css(SIGNAL.surge);
    surgeBar.append(this.surgeFill);
    this.surgeWrap.append(surgeLabel, surgeBar);

    const needleLabel = div('hud-label');
    needleLabel.append(el('span', undefined, 'VOID NEEDLE'));
    this.needleWrap.append(needleLabel);

    bl.append(label, bar, this.surgeWrap, this.needleWrap);
    this.root.append(bl);

    /* powers */
    const br = div('hud-br');
    br.append(this.powerList);
    this.root.append(br);

    /* corners */
    this.root.append(this.areaLabel, this.worldLabel);

    /* target plate */
    this.plate.id = 'target-plate';
    const tbar = div('tbar');
    tbar.append(this.plateBarFill);
    this.platePosture.append(this.platePostureFill);
    this.platePostureFill.style.background = css(SIGNAL.posture);
    this.plate.append(this.plateName, this.plateTitle, tbar, this.platePosture, this.plateMeta, this.plateBroken);
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

    /* minimap */
    this.minimap.id = 'minimap';
    this.minimap.width = 150;
    this.minimap.height = 150;
    this.mmCtx = this.minimap.getContext('2d');
    this.root.append(this.minimap);

    const reticle = div();
    reticle.id = 'reticle';
    this.root.append(reticle);
  }

  setVisible(v: boolean): void {
    show(this.root, v);
  }

  setMinimapVisible(v: boolean): void {
    show(this.minimap, v);
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
    const frac = Math.max(0, player.stats.hp / player.stats.maxHp);
    this.hpFill.style.transform = `scaleX(${frac})`;
    this.hpText.textContent = `${Math.ceil(player.stats.hp)} / ${player.stats.maxHp}`;
    if (frac < this.lastHp) {
      this.ghostTimer = 0.55;
    } else {
      this.hpGhost.style.transform = `scaleX(${frac})`;
    }
    if (this.ghostTimer > 0) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) this.hpGhost.style.transform = `scaleX(${frac})`;
    }
    this.lastHp = frac;

    const sf = player.stats.surgeFrac;
    show(this.surgeWrap, player.stats.surge > 0);
    this.surgeFill.style.transform = `scaleX(${sf})`;

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
    this.worldLabel.innerHTML =
      `AGE <b>${world.age}</b> &nbsp; TURN <b>${world.turn}</b><br>` +
      `OVERLORD <b>${world.overlordName || '—'}</b><br>` +
      `KILLS <b>${player.stats.runKills}</b>`;

    this.updateTargetPlate(target);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) show(this.banner, false);
    }

    this.drawMinimap(player, enemies, shrines);
  }

  private updateTargetPlate(t: Enemy | null): void {
    if (!t || !t.alive) {
      show(this.plate, false);
      return;
    }
    show(this.plate, true);
    const pf = t.combat.postureFrac;
    this.platePostureFill.style.transform = `scaleX(${pf})`;
    // The bar warms toward white as it fills, so you can see a break coming.
    this.platePostureFill.style.background = pf > 0.8 ? '#ffffff' : css(SIGNAL.posture);
    show(this.plateBroken, t.combat.broken);
    show(this.platePosture, !t.combat.broken);
    const n = t.nemesis;
    this.plateBarFill.style.transform = `scaleX(${Math.max(0, t.hp / t.maxHp)})`;
    if (t.named) {
      this.plateName.textContent = n.name.toUpperCase();
      this.plateTitle.textContent = n.title;
      const rel = relationshipLabel(n);
      const bits: string[] = [rankName(n.rank), `LVL ${n.level}`];
      if (rel) bits.push(rel);
      else if (n.killsAgainstPlayer > 0) bits.push(`KILLED YOU ${n.killsAgainstPlayer}`);
      this.plateMeta.textContent = bits.join('  ·  ');
      this.plateName.style.color = accentColorFor(n);
    } else {
      // Grunts get a plate too — posture is a second health bar and it has to
      // be visible to be a target.
      this.plateName.textContent = n.archetype.toUpperCase();
      this.plateTitle.textContent = '';
      this.plateMeta.textContent = t.poisoned ? 'POISONED' : t.slowTimer > 0 ? 'CRIPPLED' : '';
      this.plateName.style.color = '#9aa1ad';
    }
  }

  /* ============================================================
     one-shots
     ============================================================ */

  setPowers(list: Array<{ name: string; count: number }>): void {
    clear(this.powerList);
    for (const p of list) {
      const c = div('power-chip', p.count > 1 ? `${p.name} x${p.count}` : p.name);
      this.powerList.append(c);
    }
  }

  toast(text: string, tone: 'neutral' | 'hot' | 'gold' | 'good' = 'neutral', ttl = 3.4): void {
    const t = div(`toast ${tone === 'neutral' ? '' : tone}`.trim(), text.toUpperCase());
    this.toasts.append(t);
    window.setTimeout(() => {
      t.classList.add('fade-out');
      window.setTimeout(() => t.remove(), 520);
    }, ttl * 1000);
    while (this.toasts.childElementCount > 6) this.toasts.firstElementChild?.remove();
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
    this.bannerTimer = 2.6;
  }

  /**
   * A nemesis arrival owns the centre of the screen. The area banner is the
   * lower-priority message, so it gets out of the way rather than drawing
   * through the arrival card.
   */
  clearAreaBanner(): void {
    this.bannerTimer = 0;
    show(this.banner, false);
  }

  damageVignette(strength: number): void {
    this.vignette.style.boxShadow = `inset 0 0 200px 40px rgba(255,40,20,${Math.min(0.65, strength)})`;
    window.setTimeout(() => {
      this.vignette.style.boxShadow = 'inset 0 0 200px 40px rgba(255,40,20,0)';
    }, 90);
  }

  /** Low-health pulse, called every frame. */
  setLowHealth(frac: number): void {
    if (frac < 0.28) {
      const pulse = 0.16 + Math.sin(performance.now() * 0.006) * 0.1;
      this.vignette.style.boxShadow = `inset 0 0 220px 60px rgba(255,30,10,${pulse})`;
    }
  }

  screenFlash(color = '#fff', alpha = 0.5, ms = 120): void {
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
    shrines: Array<{ position: { x: number; z: number }; used: boolean }>
  ): void {
    const ctx = this.mmCtx;
    if (!ctx || this.minimap.classList.contains('hidden')) return;
    const S = 150;
    const scale = S / (WORLD_HALF * 2.1);
    const cx = S / 2;
    const cy = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(7,7,10,0.65)';
    ctx.fillRect(0, 0, S, S);

    for (const a of AREAS) {
      ctx.beginPath();
      ctx.arc(cx + a.cx * scale, cy + a.cz * scale, a.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
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
        ctx.fillRect(x - 2, y - 2, 4, 4);
      } else {
        ctx.fillStyle = 'rgba(200,90,70,0.75)';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // player
    const px = cx + player.position.x * scale;
    const py = cy + player.position.z * scale;
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
