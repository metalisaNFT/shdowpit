/**
 * Story screen (Tab): THE WEB plus hierarchy, territories, timeline, threads,
 * and player progression. Old Order / Book / Dead views remain as modes.
 */

import { button, clear, div, el, esc, show } from './Dom';
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
import { signatureDef } from '../data/signatures';
import type { AIContentService } from '../ai/AIContentService';
import { ALL_PLAYER_WEAPONS } from '../data/weapons';
import { TECHNIQUES } from '../data/techniques';
import { getSkill, type SkillId } from '../data/skills';
import { buildStoryModel, territoryStories } from '../story/StoryModel';
import { buildTimeline } from '../story/StoryTimeline';
import { characterBeats } from '../story/StoryBeats';
import {
  arcVoiceFor,
  journeyLineFor,
  observeArcs,
  observeJourney,
  observeTimeline,
  timelineDetailFor,
} from '../story/StoryAI';
import { defaultStoryFilters, PLAYER_ID, type StoryFilters, type StoryMode } from '../story/StoryTypes';
import { StoryWebView, edgeExplain } from '../story/StoryWeb';

type Tab = StoryMode | 'book' | 'dead';

const TIERS: Rank[] = ['overlord', 'warlord', 'captain', 'elite'];
const TAB_META: Array<{ id: Tab; label: string }> = [
  { id: 'web', label: 'WEB' },
  { id: 'hierarchy', label: 'ORDER' },
  { id: 'world', label: 'WORLD' },
  { id: 'timeline', label: 'TIME' },
  { id: 'threads', label: 'THREADS' },
  { id: 'you', label: 'YOU' },
  { id: 'book', label: 'BOOK' },
  { id: 'dead', label: 'DEAD' },
];

export class HierarchyScreen {
  readonly root = div('screen hidden');
  private tabsEl = div('tabs');
  private bodyEl = div('body');
  private actionsEl = div('actions');
  private tab: Tab = 'web';
  private selected: string | null = null;
  private selectedEdge: string | null = null;
  private mgr: NemesisManager | null = null;
  private onClose: () => void = () => void 0;
  private ai: AIContentService | null = null;
  private bookId: string | null = null;
  private filters: StoryFilters = defaultStoryFilters();
  private web = new StoryWebView({
    onSelectNode: (id) => {
      this.selected = id;
      this.filters.focusId = id;
      this.render();
    },
    onSelectEdge: (id) => {
      this.selectedEdge = id;
      this.render();
    },
    onPanZoom: (x, y, z) => {
      if (!this.mgr) return;
      this.mgr.data.storyView = { panX: x, panY: y, zoom: z };
    },
  });
  private h1 = document.createElement('h1');
  private h2 = document.createElement('h2');

  constructor() {
    this.root.id = 'hierarchy-screen';
    this.root.classList.add('story-screen');
    this.h1.textContent = 'THE WEB';
    this.h1.style.fontSize = '34px';
    this.h2.textContent = 'WHO MATTERS';
    this.root.append(this.h1, this.h2, this.tabsEl, this.bodyEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(mgr: NemesisManager, onClose: () => void, ai: AIContentService | null = null, tab?: Tab): void {
    this.mgr = mgr;
    this.onClose = onClose;
    this.ai = ai;
    if (tab) this.tab = tab;
    this.web.setReducedMotion(!!mgr.data.settings.reducedMotion);
    const sv = mgr.data.storyView;
    if (sv) this.web.setCamera(sv.panX, sv.panY, sv.zoom);
    show(this.root, true);
    this.render();
    this.web.root.focus();
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    if (this.visible) this.render();
  }

  focusCharacter(id: string, tab: Tab = 'web'): void {
    this.selected = id;
    this.bookId = id;
    this.filters.focusId = id;
    this.tab = tab;
  }

  close(): void {
    show(this.root, false);
  }

  /** Re-render in place when a portrait or title arrives while this is open. */
  refreshIfOpen(): void {
    if (this.visible) this.render();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible) return false;
    const i = TAB_META.findIndex((t) => t.id === this.tab);
    if (e.key === '[' || (e.key === 'ArrowLeft' && e.altKey)) {
      this.tab = TAB_META[(i - 1 + TAB_META.length) % TAB_META.length].id;
      this.render();
      return true;
    }
    if (e.key === ']' || (e.key === 'ArrowRight' && e.altKey)) {
      this.tab = TAB_META[(i + 1) % TAB_META.length].id;
      this.render();
      return true;
    }
    return false;
  }

  private titles(): { h: string; s: string } {
    switch (this.tab) {
      case 'web':
        return { h: 'THE WEB', s: 'WHO MATTERS' };
      case 'hierarchy':
        return { h: 'THE ORDER', s: 'WHO STANDS WHERE' };
      case 'world':
        return { h: 'THE GROUND', s: 'WHO HOLDS WHAT' };
      case 'timeline':
        return { h: 'THE RECORD', s: 'WHAT CHANGED' };
      case 'threads':
        return { h: 'THREADS', s: 'WHAT IS UNFINISHED' };
      case 'you':
        return { h: 'YOU', s: 'WHERE POWER CAME FROM' };
      case 'book':
        return { h: 'THE BOOK', s: 'ONE LIFE AT A TIME' };
      default:
        return { h: 'THE DEAD', s: 'BURIED, PROBABLY' };
    }
  }

  private render(): void {
    if (!this.mgr) return;
    const mgr = this.mgr;
    const t = this.titles();
    this.h1.textContent = t.h;
    this.h2.textContent = t.s;

    clear(this.tabsEl);
    for (const tab of TAB_META) {
      const elTab = div(`tab${this.tab === tab.id ? ' active' : ''}`, tab.label);
      elTab.addEventListener('click', () => {
        this.tab = tab.id;
        this.render();
      });
      this.tabsEl.append(elTab);
    }

    clear(this.bodyEl);
    if (this.tab === 'web') this.renderWeb(mgr);
    else if (this.tab === 'hierarchy') this.renderHierarchy(mgr);
    else if (this.tab === 'world') this.renderWorld(mgr);
    else if (this.tab === 'timeline') this.renderTimeline(mgr);
    else if (this.tab === 'threads') this.renderThreads(mgr);
    else if (this.tab === 'you') this.renderYou(mgr);
    else if (this.tab === 'book') this.renderBook(mgr);
    else this.renderDead(mgr);

    clear(this.actionsEl);
    this.actionsEl.append(button('CLOSE  [TAB]', () => this.onClose()));
  }

  private renderFilters(): HTMLElement {
    const bar = div('story-filters');
    const add = (label: string, on: boolean, fn: () => void) => {
      const b = button(label, fn, on ? 'brut on' : 'brut');
      bar.append(b);
    };
    add(this.filters.unresolvedOnly ? 'UNRESOLVED ●' : 'UNRESOLVED', this.filters.unresolvedOnly, () => {
      this.filters.unresolvedOnly = !this.filters.unresolvedOnly;
      this.render();
    });
    add(this.filters.living === 'living' ? 'LIVING ●' : 'LIVING', this.filters.living === 'living', () => {
      this.filters.living = this.filters.living === 'living' ? 'all' : 'living';
      this.render();
    });
    add(this.filters.living === 'dead' ? 'DEAD ●' : 'DEAD', this.filters.living === 'dead', () => {
      this.filters.living = this.filters.living === 'dead' ? 'all' : 'dead';
      this.render();
    });
    add(this.filters.playerHistoryOnly ? 'YOUR HISTORY ●' : 'YOUR HISTORY', this.filters.playerHistoryOnly, () => {
      this.filters.playerHistoryOnly = !this.filters.playerHistoryOnly;
      this.render();
    });
    bar.append(
      button('RESET VIEW', () => {
        this.filters = defaultStoryFilters();
        this.filters.focusId = this.selected;
        this.web.resetCamera();
        this.render();
      })
    );
    const search = el('input');
    search.type = 'text';
    search.placeholder = 'NAME';
    search.value = this.filters.search;
    search.className = 'story-search';
    search.addEventListener('change', () => {
      this.filters.search = search.value;
      this.render();
    });
    bar.append(search);
    return bar;
  }

  private renderWeb(mgr: NemesisManager): void {
    this.bodyEl.append(this.renderFilters());
    const wrap = div('story-web-wrap');
    const model = buildStoryModel(mgr.data, this.filters, false);
    this.web.setReducedMotion(!!mgr.data.settings.reducedMotion);
    this.web.render(model, mgr.data, this.filters, (n) => (this.ai ? this.ai.portraitFor(n) : ''));
    wrap.append(this.web.root);
    const side = div('story-side');
    if (this.selectedEdge) {
      const e = model.edges.find((x) => x.id === this.selectedEdge);
      if (e) {
        side.append(div('tier-label', 'CONNECTION'));
        const d = div('detail');
        d.innerHTML = edgeExplain(e).replace(/\n/g, '<br>');
        side.append(d);
        side.append(
          button('JUMP TO TIME', () => {
            this.tab = 'timeline';
            this.render();
          })
        );
      }
    }
    if (this.selected && this.selected !== PLAYER_ID) {
      const n = mgr.byId(this.selected);
      if (n) {
        side.append(this.journey(mgr, n));
        const jump = div('story-jumps');
        jump.append(
          button('BOOK', () => {
            this.bookId = n.id;
            this.tab = 'book';
            this.render();
          }),
          button('TIME', () => {
            this.tab = 'timeline';
            this.render();
          }),
          button('GROUND', () => {
            this.filters.territory = n.territory;
            this.tab = 'world';
            this.render();
          })
        );
        side.append(jump);
      }
    } else if (this.selected === PLAYER_ID) {
      side.append(div('tier-label', 'YOU'));
      side.append(div('detail', 'The intruder. Every red line that touches this node is personal.'));
    } else {
      side.append(div('log-line', 'SELECT A NAME. ARROWS MOVE. [ ] SWITCH PAGES.'));
    }
    wrap.append(side);
    this.bodyEl.append(wrap);
  }

  private journey(mgr: NemesisManager, n: Nemesis): HTMLElement {
    const box = div('tier');
    box.append(div('tier-label', fullName(n).toUpperCase()));
    const beats = characterBeats(n, mgr.data);
    if (this.ai) observeJourney(this.ai, n, beats.map((b) => b.text));
    const log = div('book-log');
    log.innerHTML = beats
      .slice(-12)
      .map((b, i) => {
        const text = this.ai ? journeyLineFor(this.ai, n, b.text, i) : b.text;
        return `<span class="turn">T${b.turn}</span> ${esc(text)}`;
      })
      .join('<br>');
    box.append(log);
    return box;
  }

  private renderWorld(mgr: NemesisManager): void {
    const stories = territoryStories(mgr.data);
    for (const s of stories) {
      const card = div(`card${this.filters.territory === s.areaId ? ' sel' : ''}`);
      card.append(div('cname', s.name));
      card.append(div('ctitle', s.holderName));
      const meta = div('cmeta');
      meta.innerHTML = `LAW ${esc(s.rule)}${s.previous ? `<br>WAS ${esc(s.previous)}` : ''}${s.heat ? `<br>${esc(s.heat)}` : ''}`;
      card.append(meta);
      card.addEventListener('click', () => {
        this.filters.territory = s.areaId;
        this.tab = 'timeline';
        this.render();
      });
      this.bodyEl.append(card);
    }
    const time = buildTimeline(mgr.data, { areaId: this.filters.territory ?? undefined });
    if (this.filters.territory) {
      this.bodyEl.append(div('tier-label', 'LOCAL RECORD'));
      this.appendTimeline(time.slice(-16));
    }
  }

  private renderTimeline(mgr: NemesisManager): void {
    const q = {
      nemesisId: this.selected && this.selected !== PLAYER_ID ? this.selected : undefined,
      areaId: this.filters.territory ?? undefined,
    };
    const items = buildTimeline(mgr.data, q);
    if (this.ai) observeTimeline(this.ai, mgr, items);
    this.bodyEl.append(div('log-line', 'WITNESSED LINES ARE YOURS. THE REST WAS LEARNED AFTER.'));
    this.appendTimeline(items.slice(-100));
  }

  private appendTimeline(items: ReturnType<typeof buildTimeline>): void {
    let last = -1;
    const wrap = div('tier');
    for (const it of items) {
      if (it.turn !== last) {
        last = it.turn;
        wrap.append(div('log-turnhead', `TURN ${it.turn}  ·  AGE ${it.age}`));
      }
      const line = div(`report-line timeline-card${it.important ? ' important' : ''}${it.witnessed ? ' witnessed' : ''}`);
      line.style.opacity = '1';
      line.style.animation = 'none';
      const tag = it.witnessed ? 'SAW' : it.known ? 'LEARNED' : 'RUMOR';
      const detail = this.ai ? timelineDetailFor(this.ai, it) : it.detail;
      line.innerHTML = `<span class="turn">T${it.turn} ${tag}</span><b>${esc(it.headline)}</b> — ${esc(detail)}`;
      line.addEventListener('click', () => {
        if (it.actors[0]) {
          this.selected = it.actors[0];
          this.tab = 'web';
          this.filters.focusId = it.actors[0];
          this.render();
        }
      });
      wrap.append(line);
    }
    if (!items.length) wrap.append(div('log-line', 'NOTHING RECORDED.'));
    this.bodyEl.append(wrap);
  }

  private renderThreads(mgr: NemesisManager): void {
    const model = buildStoryModel(mgr.data, this.filters);
    const arcs = model.arcs.filter((a) => (this.filters.unresolvedOnly ? a.unresolved : true));
    if (this.ai) observeArcs(this.ai, mgr, arcs);
    if (!arcs.length) {
      this.bodyEl.append(div('log-line', 'NO THREADS YET.'));
      return;
    }
    for (const a of arcs) {
      const card = div(`thread-card${a.unresolved ? ' open' : ''}`);
      card.append(div('cname', a.title));
      card.append(div('ctitle', a.unresolved ? 'UNRESOLVED' : 'CLOSED'));
      const meta = div('cmeta');
      const voice = this.ai ? arcVoiceFor(this.ai, a) : { state: a.state, next: a.next };
      meta.innerHTML = `${esc(voice.state)}<br><span class="grudge">${esc(voice.next)}</span>`;
      card.append(meta);
      card.addEventListener('click', () => {
        this.selected = a.characters.find((id) => id !== PLAYER_ID) ?? null;
        this.filters.focusId = this.selected;
        this.tab = 'web';
        this.render();
      });
      this.bodyEl.append(card);
    }
  }

  private renderYou(mgr: NemesisManager): void {
    const m = mgr.data.playerMeta;
    const wrap = div('detail');
    const rows: string[] = [];
    rows.push(`RUNS ${m.runs} · DEATHS ${m.deaths} · NAMED KILLS ${m.namedKills} · OVERLORDS ${m.overlordsSlain}`);
    rows.push(`WEAPONS: ${m.weapons.map((id) => ALL_PLAYER_WEAPONS[id]?.name ?? id).join(', ') || '—'}`);
    if (m.lostWeapons.length) {
      const holders = mgr.data.nemeses.filter((n) => n.stolen.some((s) => s.weaponId && m.lostWeapons.includes(s.weaponId)));
      rows.push(
        `<span class="grudge">STILL LOST: ${m.lostWeapons.join(', ')} — ${
          holders.map((h) => h.name).join(', ') || 'holder unknown'
        }</span>`
      );
    }
    const techs = Object.entries(m.techniques);
    if (techs.length) {
      rows.push(
        'TECHNIQUES: ' +
          techs
            .flatMap(([, ids]) => ids)
            .map((id) => TECHNIQUES.find((t) => t.id === id)?.name ?? id)
            .join(', ')
      );
    }
    rows.push('SKILLS: ' + m.unlockedSkills.map((id) => getSkill(id as SkillId)?.name ?? id).join(', '));
    rows.push(`VENDETTAS MARKED: ${m.vendettaPatternHistory.length}`);
    wrap.innerHTML = rows.join('<br>');
    this.bodyEl.append(wrap);
    const arcs = buildStoryModel(mgr.data).arcs.filter((a) => a.characters.includes(PLAYER_ID) && a.unresolved);
    this.bodyEl.append(div('tier-label', 'YOUR UNFINISHED BUSINESS'));
    if (!arcs.length) this.bodyEl.append(div('log-line', 'NOTHING PERSONAL IS OPEN.'));
    for (const a of arcs.slice(0, 8)) {
      this.bodyEl.append(div('log-line', `${a.title} — ${a.next}`));
    }
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
      const law = holder && holder.alive ? holder.personality.toUpperCase() : 'NONE';
      lines.push(
        `${AREA_NAMES[areaId] ?? areaId.toUpperCase()} — ${holder ? esc(fullName(holder)) : 'UNCLAIMED'} — ${law}`
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
    if (n) {
      if (this.ai) this.ai.ensureFor(n);
      wrap.append(this.bookCard(mgr, n));
    }
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
    if (n.signatureKnown && n.signatureId) {
      const sig = signatureDef(n.signatureId);
      rows.push(
        sig
          ? `SIGNATURE: ${sig.name} — ${sig.telegraph} / ${sig.counterplay}`
          : `SIGNATURE: ${n.signatureId.replace(/_/g, ' ').toUpperCase()}`
      );
    } else if (n.persistent) {
      rows.push('SIGNATURE: UNKNOWN');
    }
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
      const memSlice = n.memory.slice(-16);
      const recordBeats = memSlice.map((m) => {
        const sub = m.subject ? mgr.byId(m.subject) : null;
        return historyBeat(n, m, sub?.name);
      });
      if (ai) observeJourney(ai, n, recordBeats, { limit: 16 });
      const log = div('book-log');
      log.innerHTML = recordBeats
        .map((beat, i) => {
          const m = memSlice[i]!;
          const text = ai ? journeyLineFor(ai, n, beat, i) : beat;
          return `<span class="turn">T${m.turn}</span> ${esc(text)}`;
        })
        .join('<br>');
      body.append(log);
    }

    card.append(body);
    return card;
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
