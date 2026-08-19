/**
 * The hierarchy screen (Tab): who is above whom, who hates whom, and the full
 * chronicle of everything that has ever happened in this world.
 */

import { button, clear, div, esc, show } from './Dom';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { rankName } from '../nemesis/NemesisManager';
import type { Nemesis, Rank } from '../nemesis/Nemesis';
import { fullName } from '../nemesis/Nemesis';
import { accentColorFor } from '../nemesis/NemesisAppearance';
import { traitName } from '../data/traits';
import { getPersonality } from '../data/personalities';
import { SCAR_NAMES } from '../nemesis/NemesisMemory';
import { relationshipLabel, historyBeat } from '../nemesis/EncounterCopy';
import { AREA_NAMES } from '../data/names';
import type { AIContentService } from '../ai/AIContentService';

type Tab = 'hierarchy' | 'book' | 'chronicle' | 'dead';

const TIERS: Rank[] = ['overlord', 'warlord', 'captain', 'elite'];

export class HierarchyScreen {
  readonly root = div('screen hidden');
  private tabsEl = div('tabs');
  private bodyEl = div('body');
  private actionsEl = div('actions');
  private tab: Tab = 'hierarchy';
  private selected: string | null = null;
  private mgr: NemesisManager | null = null;
  private onClose: () => void = () => void 0;
  private ai: AIContentService | null = null;
  /** id of the nemesis whose Book page is open */
  private bookId: string | null = null;

  constructor() {
    this.root.id = 'hierarchy-screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'THE ORDER';
    h1.style.fontSize = '34px';
    const h2 = document.createElement('h2');
    h2.textContent = 'WHO STANDS WHERE';
    this.root.append(h1, h2, this.tabsEl, this.bodyEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(mgr: NemesisManager, onClose: () => void, ai: AIContentService | null = null): void {
    this.mgr = mgr;
    this.onClose = onClose;
    this.ai = ai;
    show(this.root, true);
    this.render();
  }

  close(): void {
    show(this.root, false);
  }

  /** Re-render in place when a portrait or title arrives while this is open. */
  refreshIfOpen(): void {
    if (this.visible) this.render();
  }

  private render(): void {
    if (!this.mgr) return;
    const mgr = this.mgr;

    clear(this.tabsEl);
    const mk = (id: Tab, label: string) => {
      const t = div(`tab${this.tab === id ? ' active' : ''}`, label);
      t.addEventListener('click', () => {
        this.tab = id;
        this.selected = null;
        this.render();
      });
      this.tabsEl.append(t);
    };
    mk('hierarchy', 'HIERARCHY');
    mk('book', 'BOOK OF ENEMIES');
    mk('chronicle', 'CHRONICLE');
    mk('dead', 'THE DEAD');

    clear(this.bodyEl);
    if (this.tab === 'hierarchy') this.renderHierarchy(mgr);
    else if (this.tab === 'book') this.renderBook(mgr);
    else if (this.tab === 'chronicle') this.renderChronicle(mgr);
    else this.renderDead(mgr);

    clear(this.actionsEl);
    this.actionsEl.append(button('CLOSE  [TAB]', () => this.onClose()));
  }

  private renderHierarchy(mgr: NemesisManager): void {
    for (const rank of TIERS) {
      const list = mgr.ofRank(rank).sort((a, b) => b.power - a.power);
      if (!list.length) continue;
      const tier = div('tier');
      const holdings = rank === 'overlord' ? '  ·  HOLDS THE FORTRESS' : '';
      tier.append(div('tier-label', rankName(rank) + holdings));
      const row = div('tier-row');
      for (const n of list) row.append(this.card(mgr, n));
      tier.append(row);
      this.bodyEl.append(tier);
    }

    /* territories */
    const t = div('tier');
    t.append(div('tier-label', 'TERRITORY'));
    const grid = div('detail');
    const lines: string[] = [];
    for (const [areaId, holderId] of Object.entries(mgr.data.territories)) {
      const holder = mgr.byId(holderId);
      lines.push(
        `${AREA_NAMES[areaId] ?? areaId.toUpperCase()} — ${holder ? esc(fullName(holder)) : 'UNCLAIMED'}`
      );
    }
    grid.innerHTML = lines.join('<br>');
    t.append(grid);
    this.bodyEl.append(t);

    if (this.selected) {
      const n = mgr.byId(this.selected);
      if (n) {
        const d = div('tier');
        d.append(this.detail(mgr, n));
        this.bodyEl.append(d);
      }
    }
  }

  private renderDead(mgr: NemesisManager): void {
    const dead = mgr.dead().sort((a, b) => (b.diedOnTurn ?? 0) - (a.diedOnTurn ?? 0));
    const tier = div('tier');
    tier.append(div('tier-label', dead.length ? 'BURIED, PROBABLY' : 'NOBODY HAS DIED YET'));
    const row = div('tier-row');
    for (const n of dead) {
      const c = this.card(mgr, n);
      c.classList.add('dead');
      row.append(c);
    }
    tier.append(row);
    this.bodyEl.append(tier);
    if (this.selected) {
      const n = mgr.byId(this.selected);
      if (n) this.bodyEl.append(this.detail(mgr, n));
    }
  }

  /* ============================================================
     the book of enemies
     ============================================================ */

  /** Enemies worth a page: anything the player has actually tangled with. */
  private bookRoster(mgr: NemesisManager): Nemesis[] {
    const score = (n: Nemesis) =>
      n.killsAgainstPlayer * 100 +
      n.defeatsByPlayer * 40 +
      n.escapedPlayer * 30 +
      n.returns * 50 +
      n.scars.length * 15 +
      n.stolen.length * 60 +
      ['grunt', 'elite', 'captain', 'warlord', 'overlord'].indexOf(n.rank) * 20;
    return [...mgr.roster]
      .filter((n) => n.persistent)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 40);
  }

  private renderBook(mgr: NemesisManager): void {
    const roster = this.bookRoster(mgr);
    if (!roster.length) {
      this.bodyEl.append(div('log-line', 'NOBODY HAS MADE AN IMPRESSION YET.'));
      return;
    }
    if (!this.bookId || !roster.some((n) => n.id === this.bookId)) {
      this.bookId = roster[0].id;
    }

    const wrap = div('book-wrap');

    const rail = div('book-rail');
    for (const n of roster) {
      const row = div(`book-rail-row${n.id === this.bookId ? ' sel' : ''}`);
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = accentColorFor(n);
      const label = div('book-rail-name', n.name.toUpperCase());
      const sub = div('book-rail-sub', rankName(n.rank) + (n.alive ? '' : ' · DEAD'));
      const head = div('book-rail-head');
      head.append(sw, label);
      row.append(head, sub);
      row.addEventListener('click', () => {
        this.bookId = n.id;
        this.render();
      });
      rail.append(row);
    }
    wrap.append(rail);

    const n = mgr.byId(this.bookId);
    if (n) wrap.append(this.bookCard(mgr, n));
    this.bodyEl.append(wrap);
  }

  private bookCard(mgr: NemesisManager, n: Nemesis): HTMLElement {
    const ai = this.ai;
    const accent = accentColorFor(n);
    const card = div('book-card');
    card.style.setProperty('--accent', accent);

    /* ---- portrait ---- */
    const figure = div('book-figure');
    const img = document.createElement('img');
    img.className = 'book-portrait';
    img.alt = '';
    img.src = ai ? ai.portraitFor(n) : '';
    figure.append(img);

    const generated = ai?.hasGeneratedPortrait(n) ?? false;
    figure.append(div('book-portrait-tag', generated ? 'GENERATED' : 'PROCEDURAL'));

    // Portrait evolution strip: every face this character has worn.
    const history = ai?.portraitHistory(n) ?? [];
    if (history.length) {
      const strip = div('book-strip');
      for (const h of history) {
        const t = document.createElement('img');
        t.className = 'book-thumb';
        t.src = h.src;
        t.alt = '';
        t.title = `${h.title} — turn ${h.turn}`;
        strip.append(t);
      }
      const cur = document.createElement('img');
      cur.className = 'book-thumb cur';
      cur.src = img.src;
      cur.alt = '';
      cur.title = ai ? ai.titleFor(n) : n.title;
      strip.append(cur);
      figure.append(strip);
    }
    card.append(figure);

    /* ---- text ---- */
    const body = div('book-body');

    const name = div('book-name', n.name.toUpperCase());
    name.style.color = accent;
    const title = div('book-title', (ai ? ai.titleFor(n) : n.title) || '—');
    const rank = div('book-rank', `${rankName(n.rank)} · LVL ${n.level} · ${n.archetype.toUpperCase()}`);
    const rel = relationshipLabel(n);
    body.append(name, title, rank);
    if (rel) body.append(div('book-rel', rel));

    const stats = div('book-stats');
    const stat = (label: string, value: string, hot = false) => {
      const s = div(`book-stat${hot ? ' hot' : ''}`);
      s.append(div('book-stat-v', value), div('book-stat-l', label));
      return s;
    };
    stats.append(
      stat('KILLED YOU', String(n.killsAgainstPlayer), n.killsAgainstPlayer > 0),
      stat('YOU KILLED', String(n.defeatsByPlayer)),
      stat('ESCAPED', String(n.escapedPlayer)),
      stat('RETURNED', String(n.returns), n.returns > 0)
    );
    body.append(stats);

    const rows: string[] = [];
    if (n.strengths.length) rows.push(`TRAITS: ${n.strengths.map(traitName).join(', ')}`);
    if (n.weaknesses.length) {
      rows.push(`<span class="grudge">KNOWN WEAKNESSES: ${n.weaknesses.map(traitName).join(', ')}</span>`);
    }
    if (n.adaptations.length) rows.push(`ADAPTED TO YOU: ${n.adaptations.map(traitName).join(', ')}`);
    if (n.scars.length) rows.push(`SCARS: ${n.scars.map((s) => SCAR_NAMES[s.id]).join(', ')}`);
    if (n.stolen.length) {
      rows.push(`<span class="book-stolen">STOLEN FROM YOU: ${n.stolen.map((s) => esc(s.name)).join(', ')}</span>`);
    }
    const rivals = n.rivalries.map((id) => mgr.byId(id)).filter((x): x is Nemesis => !!x);
    const allies = n.allies.map((id) => mgr.byId(id)).filter((x): x is Nemesis => !!x);
    const master = mgr.byId(n.master);
    if (master) rows.push(`SERVES: ${esc(fullName(master))}`);
    if (rivals.length) rows.push(`RIVALS: ${rivals.map((r) => esc(r.name.toUpperCase())).join(', ')}`);
    if (allies.length) rows.push(`ALLIES: ${allies.map((r) => esc(r.name.toUpperCase())).join(', ')}`);
    rows.push(`TERRITORY: ${AREA_NAMES[n.territory] ?? n.territory.toUpperCase()}`);

    const facts = div('book-facts');
    facts.innerHTML = rows.join('<br>');
    body.append(facts);

    /* ---- history ---- */
    const chronicle = ai ? ai.chronicleFor(n) : '';
    if (chronicle) {
      body.append(div('book-h', 'HISTORY'));
      body.append(div('book-chronicle', chronicle));
    }

    const taunt = ai ? ai.tauntFor(n, 0) : '';
    if (taunt) body.append(div('book-taunt', `"${taunt}"`));

    if (n.memory.length) {
      body.append(div('book-h', 'RECORD'));
      const log = div('book-log');
      log.innerHTML = n.memory
        .slice(-16)
        .map((m) => {
          const sub = m.subject ? mgr.byId(m.subject) : null;
          return `<span class="turn">T${m.turn}</span> ${esc(historyBeat(n, m, sub?.name))}`;
        })
        .join('<br>');
      body.append(log);
    }

    card.append(body);
    return card;
  }

  private renderChronicle(mgr: NemesisManager): void {
    const log = mgr.data.eventLog;
    let lastTurn = -1;
    const wrap = div('tier');
    for (let i = Math.max(0, log.length - 220); i < log.length; i++) {
      const ev = log[i];
      if (ev.turn !== lastTurn) {
        lastTurn = ev.turn;
        wrap.append(div('log-turnhead', `TURN ${ev.turn}  ·  AGE ${ev.age}`));
      }
      const line = div('log-line');
      const cls = ev.tone === 'bad' ? 'grudge' : ev.tone === 'gold' ? 'who' : '';
      line.innerHTML = cls ? `<span class="${cls}">${esc(ev.text)}</span>` : esc(ev.text);
      wrap.append(line);
    }
    if (!log.length) wrap.append(div('log-line', 'NOTHING HAS HAPPENED YET.'));
    this.bodyEl.append(wrap);
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  private card(mgr: NemesisManager, n: Nemesis): HTMLElement {
    const c = div(`card${this.selected === n.id ? ' sel' : ''}`);
    const name = div('cname');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = accentColorFor(n);
    name.append(sw, document.createTextNode(n.name.toUpperCase()));
    const title = div('ctitle', n.title);
    const meta = div('cmeta');
    const bits: string[] = [`${n.archetype.toUpperCase()} · LVL ${n.level} · PWR ${n.power}`];
    bits.push(getPersonality(n.personality).name);
    if (n.killsAgainstPlayer > 0) bits.push(`<span class="grudge">KILLED YOU ${n.killsAgainstPlayer}</span>`);
    if (n.stolen.length) bits.push(`<span class="grudge">HAS ${esc(n.stolen[0].name)}</span>`);
    if (n.returns > 0) bits.push(`<span class="grudge">RETURNED ${n.returns}</span>`);
    if (!n.alive) bits.push(`DEAD (T${n.diedOnTurn ?? '?'})`);
    meta.innerHTML = bits.join('<br>');
    c.append(name, title, meta);
    c.addEventListener('click', () => {
      this.selected = this.selected === n.id ? null : n.id;
      this.render();
    });
    void mgr;
    return c;
  }

  private detail(mgr: NemesisManager, n: Nemesis): HTMLElement {
    const d = div('detail');
    const h = document.createElement('h3');
    h.textContent = fullName(n).toUpperCase();
    h.style.color = accentColorFor(n);
    d.append(h);

    const rows: string[] = [];
    rows.push(`${rankName(n.rank)} · ${n.archetype.toUpperCase()} · ${n.weapon.toUpperCase()} · LVL ${n.level} · POWER ${n.power}`);
    rows.push(`${getPersonality(n.personality).name} — ${esc(getPersonality(n.personality).desc)}`);
    rows.push(`TERRITORY: ${AREA_NAMES[n.territory] ?? n.territory.toUpperCase()}`);
    if (n.strengths.length) rows.push(`STRENGTHS: ${n.strengths.map(traitName).join(', ')}`);
    if (n.weaknesses.length) rows.push(`<span class="grudge">WEAKNESSES: ${n.weaknesses.map(traitName).join(', ')}</span>`);
    if (n.adaptations.length) rows.push(`ADAPTED: ${n.adaptations.map(traitName).join(', ')}`);
    if (n.scars.length) rows.push(`SCARS: ${n.scars.map((s) => SCAR_NAMES[s.id]).join(', ')}`);
    if (n.stolen.length) rows.push(`<span class="grudge">CARRIES YOUR: ${n.stolen.map((s) => esc(s.name)).join(', ')}</span>`);

    const rivals = n.rivalries.map((id) => mgr.byId(id)).filter((x): x is Nemesis => !!x);
    const allies = n.allies.map((id) => mgr.byId(id)).filter((x): x is Nemesis => !!x);
    const master = mgr.byId(n.master);
    if (master) rows.push(`SERVES: ${esc(fullName(master))}`);
    if (rivals.length) rows.push(`RIVALS: ${rivals.map((r) => esc(r.name.toUpperCase())).join(', ')}`);
    if (allies.length) rows.push(`ALLIES: ${allies.map((r) => esc(r.name.toUpperCase())).join(', ')}`);

    rows.push(
      `AGAINST YOU — KILLS ${n.killsAgainstPlayer} · DEFEATS ${n.defeatsByPlayer} · ESCAPES ${n.escapedPlayer} · GRUDGE ${Math.round(n.playerRelationship)}`
    );

    d.innerHTML += rows.join('<br>');

    if (n.memory.length) {
      const mem = div('memline');
      const recent = n.memory.slice(-10).reverse();
      mem.innerHTML =
        '<br>MEMORY<br>' +
        recent
          .map((m) => {
            const sub = m.subject ? mgr.byId(m.subject) : null;
            return `T${m.turn} — ${esc(historyBeat(n, m, sub?.name))}`;
          })
          .join('<br>');
      d.append(mem);
    }
    return d;
  }
}
