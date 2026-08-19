/**
 * THE WEB — SVG relationship map. Positions come from StoryLayout; this
 * only draws, filters, and handles selection.
 */

import { div, esc } from '../ui/Dom';
import { accentColorFor } from '../nemesis/NemesisAppearance';
import type { Nemesis } from '../nemesis/Nemesis';
import type { SaveData } from '../core/SaveSystem';
import { AREA_NAMES } from '../data/names';
import { STORY_CANVAS } from './StoryLayout';
import { PLAYER_ID, type StoryEdge, type StoryFilters, type StoryNode } from './StoryTypes';
import type { NodePos } from './StoryLayout';
import type { StoryModel } from './StoryModel';

export interface WebHandlers {
  onSelectNode(id: string | null): void;
  onSelectEdge(id: string | null): void;
  onPanZoom(panX: number, panY: number, zoom: number): void;
}

const EDGE_MARK: Record<StoryEdge['kind'], string> = {
  rival: 'jagged',
  ally: 'solid',
  former_ally: 'broken',
  master: 'gold',
  revenge: 'pulse',
  betrayal: 'cross',
  stolen_weapon: 'chain',
  territory_war: 'ground',
};

export class StoryWebView {
  readonly root = div('story-web');
  private svg: SVGSVGElement;
  private stage: SVGGElement;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private dragging = false;
  private lx = 0;
  private ly = 0;
  private reduced = false;
  private selected: string | null = null;
  private selectedEdge: string | null = null;
  private nodeOrder: string[] = [];

  constructor(private handlers: WebHandlers) {
    this.root.tabIndex = 0;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${STORY_CANVAS.w} ${STORY_CANVAS.h}`);
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Relationship map');
    this.stage = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.append(this.stage);
    this.root.append(this.svg);

    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const next = Math.max(0.55, Math.min(2.2, this.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      this.zoom = next;
      this.applyCam();
      this.handlers.onPanZoom(this.panX, this.panY, this.zoom);
    });
    this.svg.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest?.('.story-node')) return;
      this.dragging = true;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.panX += e.clientX - this.lx;
      this.panY += e.clientY - this.ly;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.applyCam();
    });
    this.svg.addEventListener('pointerup', () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.handlers.onPanZoom(this.panX, this.panY, this.zoom);
    });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  setCamera(panX: number, panY: number, zoom: number): void {
    this.panX = panX;
    this.panY = panY;
    this.zoom = zoom;
    this.applyCam();
  }

  resetCamera(): void {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.applyCam();
    this.handlers.onPanZoom(0, 0, 1);
  }

  setReducedMotion(v: boolean): void {
    this.reduced = v;
    this.root.classList.toggle('reduced-motion', v);
  }

  focusNode(_id: string, pos: NodePos | undefined): void {
    if (!pos) return;
    this.panX = STORY_CANVAS.w / 2 - pos.x;
    this.panY = STORY_CANVAS.h / 2 - pos.y;
    this.zoom = 1.15;
    this.applyCam();
    this.handlers.onPanZoom(this.panX, this.panY, this.zoom);
  }

  private applyCam(): void {
    this.stage.setAttribute('transform', `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
  }

  render(model: StoryModel, data: SaveData, filters: StoryFilters, portraits: (n: Nemesis) => string): void {
    this.selected = filters.focusId;
    this.nodeOrder = model.visibleNodes.map((n) => n.id);
    while (this.stage.firstChild) this.stage.removeChild(this.stage.firstChild);

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#c8c4b8"/>
      </marker>
      <marker id="arr-gold" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffb020"/>
      </marker>
      <filter id="jag"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" result="t"/>
        <feDisplacementMap in="SourceGraphic" in2="t" scale="1.6"/></filter>`;
    this.stage.append(defs);

    for (const e of model.visibleEdges) {
      const a = model.positions[e.from];
      const b = model.positions[e.to];
      if (!a || !b) continue;
      this.drawEdge(e, a, b, filters.focusId);
    }

    for (const n of model.visibleNodes) {
      const p = model.positions[n.id];
      if (!p) continue;
      const rec = n.kind === 'nemesis' ? data.nemeses.find((x) => x.id === n.id) : null;
      this.drawNode(n, p, rec ? portraits(rec) : '', rec ?? null, filters.focusId);
    }
  }

  private drawEdge(e: StoryEdge, a: NodePos, b: NodePos, focus: string | null): void {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('story-edge', `kind-${e.kind}`);
    if (e.spectral) g.classList.add('spectral');
    if (focus && e.from !== focus && e.to !== focus) g.classList.add('dim');
    if (this.selectedEdge === e.id) g.classList.add('sel');

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const jagged = e.kind === 'rival' || e.kind === 'revenge';
    const d = jagged
      ? `M ${a.x} ${a.y} L ${(a.x + mx) / 2 + 6} ${(a.y + my) / 2 - 8} L ${mx} ${my} L ${(mx + b.x) / 2 - 6} ${(my + b.y) / 2 + 8} L ${b.x} ${b.y}`
      : `M ${a.x} ${a.y} Q ${mx} ${my - (e.kind === 'ally' ? 18 : 0)} ${b.x} ${b.y}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    const w = Math.max(1.2, Math.min(4.2, e.importance / 18));
    path.setAttribute('stroke-width', String(w));
    if (e.kind === 'ally') path.setAttribute('stroke-dasharray', '10 4');
    if (e.kind === 'former_ally') path.setAttribute('stroke-dasharray', '3 7');
    if (e.kind === 'master') path.setAttribute('marker-end', 'url(#arr-gold)');
    else if (e.directed) path.setAttribute('marker-end', 'url(#arr)');
    if (jagged && !this.reduced) path.setAttribute('filter', 'url(#jag)');
    if (e.kind === 'revenge' && !this.reduced) path.classList.add('pulse');
    g.append(path);

    if (e.kind === 'betrayal') {
      const x = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      x.setAttribute('d', `M ${mx - 8} ${my - 8} L ${mx + 8} ${my + 8} M ${mx + 8} ${my - 8} L ${mx - 8} ${my + 8}`);
      x.setAttribute('fill', 'none');
      x.setAttribute('stroke-width', '2');
      x.classList.add('cross');
      g.append(x);
    }
    if (e.kind === 'stolen_weapon') {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(mx));
      t.setAttribute('y', String(my - 6));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'edge-icon');
      t.textContent = '⛓';
      g.append(t);
    }

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.selectedEdge = e.id;
      this.handlers.onSelectEdge(e.id);
    });
    g.append(hit);

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${EDGE_MARK[e.kind]} — ${e.label}. ${e.why}`;
    g.append(title);
    this.stage.append(g);
  }

  private drawNode(
    n: StoryNode,
    p: NodePos,
    portrait: string,
    rec: Nemesis | null,
    focus: string | null
  ): void {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('story-node');
    if (!n.alive) g.classList.add('dead');
    if (n.id === PLAYER_ID) g.classList.add('player');
    if (n.rank === 'overlord') g.classList.add('overlord');
    if (focus && n.id !== focus) g.classList.add('dim');
    if (this.selected === n.id) g.classList.add('sel');
    g.setAttribute('transform', `translate(${p.x} ${p.y})`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${n.name} ${n.title} ${n.alive ? 'alive' : 'dead'}`);

    const r = n.id === PLAYER_ID ? 28 : 16 + Math.min(14, n.importance / 12);
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('r', String(r + 3));
    ring.setAttribute('class', 'node-ring');
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fill.setAttribute('r', String(r));
    fill.setAttribute('class', 'node-fill');
    if (rec) fill.setAttribute('fill', accentColorFor(rec));
    else fill.setAttribute('fill', '#e8e6e0');
    g.append(ring, fill);

    if (portrait) {
      const clipId = `c-${n.id}`;
      const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      clip.setAttribute('id', clipId);
      const cc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      cc.setAttribute('r', String(r - 2));
      clip.append(cc);
      g.append(clip);
      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      img.setAttribute('href', portrait);
      img.setAttribute('x', String(-r + 2));
      img.setAttribute('y', String(-r + 2));
      img.setAttribute('width', String((r - 2) * 2));
      img.setAttribute('height', String((r - 2) * 2));
      img.setAttribute('clip-path', `url(#${clipId})`);
      img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      g.append(img);
    }

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('y', String(r + 14));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'node-name');
    label.textContent = n.name.toUpperCase();
    g.append(label);

    if (n.unresolved) {
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      mark.setAttribute('cx', String(r - 4));
      mark.setAttribute('cy', String(-r + 4));
      mark.setAttribute('r', '5');
      mark.setAttribute('class', 'unresolved');
      g.append(mark);
    }

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${n.name} ${n.title} · ${n.rank} · ${n.alive ? 'alive' : 'dead'} · ${AREA_NAMES[n.territory] ?? n.territory}`;
    g.append(title);

    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.selected = n.id;
      this.handlers.onSelectNode(n.id);
    });
    this.stage.append(g);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.nodeOrder.length) return;
    const i = Math.max(0, this.nodeOrder.indexOf(this.selected ?? PLAYER_ID));
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const id = this.nodeOrder[(i + 1) % this.nodeOrder.length];
      this.selected = id;
      this.handlers.onSelectNode(id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const id = this.nodeOrder[(i - 1 + this.nodeOrder.length) % this.nodeOrder.length];
      this.selected = id;
      this.handlers.onSelectNode(id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.handlers.onSelectNode(PLAYER_ID);
    } else if (e.key === 'Escape') {
      this.handlers.onSelectNode(null);
    }
  }
}

export function edgeExplain(e: StoryEdge): string {
  return `${esc(e.label)} — ${esc(e.why)}${e.eventText ? `\n${e.eventText}` : ''}`;
}
