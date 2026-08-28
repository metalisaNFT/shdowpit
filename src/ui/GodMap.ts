/**
 * Territory map for THE LONG GAME oracle UI.
 *
 * Default: compact strip in the footer — never blocks the viewport.
 * Expanded: optional popover canvas for spatial overview.
 */

import { button, div } from './Dom';
import { snapshotOccupancy } from '../world/WorldOccupancy';
import { paletteFor } from '../nemesis/NemesisAppearance';
import { rankIndex } from '../nemesis/Nemesis';
import { livingFactions } from '../god/Factions';
import { getArea, AREAS } from '../data/areas';
import {
  MAP_SIZE,
  areaAtMap,
  drawWorldMap,
  type MapAreaStyle,
  type MapActorDot,
  type MapWarLine,
} from '../world/MapDraw';
import type { GodRun } from '../god/GodRun';
import type { Nemesis } from '../nemesis/Nemesis';
import { factionFor } from '../god/Factions';

const SHORT: Record<string, string> = {
  pit: 'PIT',
  ruins: 'RUINS',
  forest: 'WOOD',
  caves: 'CAVES',
  tower: 'TOWER',
  fortress: 'FORT',
};

interface ChipEl {
  root: HTMLElement;
  count: HTMLElement;
}

export class GodMap {
  readonly root = div('god-map-dock');
  readonly canvas = document.createElement('canvas');

  private stripEl = div('god-map-strip');
  private popoverEl = div('god-map-popover');
  private toggleBtn = button('MAP', () => this.setExpanded(!this.expanded), 'brut tiny god-map-toggle');
  private chips = new Map<string, ChipEl>();

  private ctx: CanvasRenderingContext2D | null = null;
  private run: GodRun | null = null;
  private focusAreaId: string | null = null;
  private pulse = 0;
  private expanded = false;

  onAreaClick: ((areaId: string) => void) | null = null;

  constructor() {
    this.canvas.className = 'god-map-canvas';
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.popoverEl.append(this.canvas);
    this.root.append(this.toggleBtn, this.stripEl, this.popoverEl);
    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

    for (const a of AREAS) {
      const root = div('god-map-chip');
      root.dataset.areaId = a.id;
      const label = div('god-map-chip-label', SHORT[a.id] ?? a.id.toUpperCase());
      const count = div('god-map-chip-count', '0');
      root.append(label, count);
      root.addEventListener('click', () => this.onAreaClick?.(a.id));
      this.stripEl.append(root);
      this.chips.set(a.id, { root, count });
    }

    document.addEventListener('pointerdown', (e) => {
      if (!this.expanded) return;
      const t = e.target as Node;
      if (!this.root.contains(t)) this.setExpanded(false);
    });
  }

  bind(run: GodRun): void {
    this.run = run;
  }

  setFocus(areaId: string | null): void {
    this.focusAreaId = areaId;
    this.updateStrip();
    this.drawCanvas();
  }

  setExpanded(on: boolean): void {
    this.expanded = on;
    this.root.classList.toggle('expanded', on);
    this.toggleBtn.textContent = on ? 'HIDE' : 'MAP';
    if (on) this.drawCanvas();
  }

  tick(dt: number): void {
    this.pulse += dt;
    this.updateStrip();
    if (this.expanded) this.drawCanvas();
  }

  draw(): void {
    this.updateStrip();
    this.drawCanvas();
  }

  sync(): void {
    this.draw();
  }

  private drawCanvas(): void {
    const run = this.run;
    const ctx = this.ctx;
    if (!run || !ctx) return;

    const occ = snapshotOccupancy(run.mgr, null);
    const areas: MapAreaStyle[] = AREAS.map((a) => {
      const o = occ[a.id];
      const accent = o?.accent ?? a.accent;
      const hex = (n: number, al: string) => {
        const r = ((n >> 16) & 255).toString(16).padStart(2, '0');
        const g = ((n >> 8) & 255).toString(16).padStart(2, '0');
        const b = (n & 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}${al}`;
      };
      const crisis = run.god.crisis?.bodyId && run.mgr.byId(run.god.crisis.bodyId)?.territory === a.id;
      return {
        id: a.id,
        accent,
        fill: hex(accent, '28'),
        stroke: hex(accent, this.focusAreaId === a.id ? 'ff' : '99'),
        selected: this.focusAreaId === a.id,
        crisis: !!crisis && Math.sin(this.pulse * 4) > 0,
      };
    });

    const marked = new Set(
      run.god.conditions.filter((c) => c.source === 'god' && c.targetKind === 'nemesis').map((c) => c.targetId)
    );
    const actors: MapActorDot[] = run.mgr.namedLiving().map((n) => ({
      id: n.id,
      areaId: mapTerritoryFor(n, run),
      accent: paletteFor(n.appearanceSeed).accent,
      rank: rankIndex(n.rank),
      marked: marked.has(n.id),
    }));

    const wars: MapWarLine[] = [];
    for (const f of livingFactions(run.god)) {
      for (const wid of f.warWith) {
        const other = run.god.factions.find((x) => x.id === wid);
        if (!other || f.id > wid) continue;
        const c1 = centroidForFaction(run, f.memberIds);
        const c2 = centroidForFaction(run, other.memberIds);
        if (c1 && c2) wars.push({ x1: c1.x, z1: c1.z, x2: c2.x, z2: c2.z, colour: f.colour });
      }
    }

    drawWorldMap(ctx, { areas, actors, wars });
  }

  private updateStrip(): void {
    const run = this.run;
    if (!run) return;

    const counts = new Map<string, number>();
    for (const n of run.mgr.namedLiving()) {
      const id = mapTerritoryFor(n, run);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const occ = snapshotOccupancy(run.mgr, null);
    for (const a of AREAS) {
      const chip = this.chips.get(a.id);
      if (!chip) continue;
      const o = occ[a.id];
      const accent = o?.accent ?? a.accent;
      const r = ((accent >> 16) & 255).toString(16).padStart(2, '0');
      const g = ((accent >> 8) & 255).toString(16).padStart(2, '0');
      const b = (accent & 255).toString(16).padStart(2, '0');
      chip.root.style.setProperty('--chip-accent', `#${r}${g}${b}`);
      chip.count.textContent = String(counts.get(a.id) ?? 0);
      chip.root.classList.toggle('selected', this.focusAreaId === a.id);
      chip.root.classList.toggle('occupied', (counts.get(a.id) ?? 0) > 0);
      const crisis = run.god.crisis?.bodyId && run.mgr.byId(run.god.crisis.bodyId)?.territory === a.id;
      chip.root.classList.toggle('crisis', !!crisis && Math.sin(this.pulse * 4) > 0);
    }
  }

  private handleCanvasClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * MAP_SIZE;
    const py = ((e.clientY - rect.top) / rect.height) * MAP_SIZE;
    const area = areaAtMap(px, py);
    if (area) this.onAreaClick?.(area.id);
  }
}

function centroidForFaction(run: GodRun, memberIds: string[]): { x: number; z: number } | null {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const id of memberIds) {
    const nem = run.mgr.byId(id);
    if (!nem?.alive) continue;
    const a = getArea(mapTerritoryFor(nem, run));
    sx += a.cx;
    sz += a.cz;
    n++;
  }
  if (!n) return null;
  return { x: sx / n, z: sz / n };
}

export function situationAreaId(run: GodRun, actors: string[]): string {
  for (const id of actors) {
    const n = run.mgr.byId(id);
    if (n?.territory) return n.territory;
  }
  return run.situations[0] ? situationAreaId(run, run.situations[0].actors) : 'pit';
}

export function populatedAreas(run: GodRun): string[] {
  const counts = new Map<string, number>();
  for (const n of run.mgr.namedLiving()) {
    const id = mapTerritoryFor(n, run);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out = AREAS.filter((a) => (counts.get(a.id) ?? 0) > 0).map((a) => a.id);
  return out.length ? out : ['pit'];
}

export function topUrgentAreas(run: GodRun): string[] {
  const out: string[] = [];
  for (const s of run.situations.slice(0, 3)) {
    const id = situationAreaId(run, s.actors);
    if (!out.includes(id)) out.push(id);
  }
  return out.length ? out : ['pit'];
}

/** Where a character reads on the oracle map — always within a named area. */
export function mapTerritoryFor(n: Nemesis, run: GodRun): string {
  if (n.territory && AREAS.some((a) => a.id === n.territory)) return n.territory;
  for (const a of AREAS) {
    if (run.mgr.data.territories[a.id] === n.id) return a.id;
  }
  const house = factionFor(run.god, n);
  if (house?.territories.length) {
    const t = house.territories.find((id) => AREAS.some((a) => a.id === id));
    if (t) return t;
  }
  let h = 0;
  for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0;
  return AREAS[Math.abs(h) % AREAS.length]!.id;
}
