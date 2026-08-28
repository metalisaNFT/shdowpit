/**
 * Loadout, skill tree, inventory, stats. One screen, three layers:
 * permanent tree, equipped gear, run stats.
 */

import { button, clear, div, el, esc, show } from './Dom';
import type { PlayerMeta } from '../core/SaveSystem';
import type { PlayerStats } from '../player/PlayerStats';
import { SKILL_NODES, canUnlock, nodesInBranch, SKILL_NODE_MAP, type TreeBranch } from '../data/skillTree';
import { ITEM_MAP, compareLines } from '../data/equipment';
import {
  equipItem,
  findItem,
  historyLine,
  nodePreview,
  respecTree,
  salvageItem,
  treeCostRemaining,
  unlockNode,
} from '../progress/Progression';
import type { ItemInstance } from '../progress/Types';
import { STAT_TIPS } from '../data/stats';
import { playerWeapon } from '../data/weapons';

export interface BuildHandlers {
  onClose: () => void;
  onChanged: () => void;
}

type Tab = 'loadout' | 'tree' | 'stats' | 'pack';

export class BuildScreen {
  readonly root = div('screen hidden');
  private body = div('body build-body');
  private actions = div('actions');
  private tab: Tab = 'loadout';
  private compareId: string | null = null;
  private treeBranch: TreeBranch = 'BLADE';
  private handlers: BuildHandlers | null = null;
  private meta: PlayerMeta | null = null;
  private stats: PlayerStats | null = null;
  private runNotes: string[] = [];

  constructor() {
    this.root.id = 'build-screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'BUILD';
    const sub = div('title-sub', 'TREE  ·  GEAR  ·  RUN');
    this.root.append(h1, sub, this.body, this.actions);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(meta: PlayerMeta, stats: PlayerStats | null, handlers: BuildHandlers, runNotes: string[] = []): void {
    this.meta = meta;
    this.stats = stats;
    this.handlers = handlers;
    this.runNotes = runNotes;
    this.render();
    show(this.root, true);
  }

  hide(): void {
    show(this.root, false);
    this.handlers = null;
  }

  private render(): void {
    const meta = this.meta;
    if (!meta || !this.handlers) return;
    const p = meta.progress;
    clear(this.body);
    clear(this.actions);

    const tabs = div('build-tabs');
    for (const [id, label] of [
      ['loadout', 'LOADOUT'],
      ['tree', 'SKILL TREE'],
      ['stats', 'STATS'],
      ['pack', 'PACK'],
    ] as Array<[Tab, string]>) {
      const b = button(label, () => {
        this.tab = id;
        this.render();
      });
      if (this.tab === id) b.classList.add('on');
      tabs.append(b);
    }
    this.body.append(tabs);
    this.body.append(div('build-cinders', `PERMANENT UNLOCK · CINDERS  ${p.cinders}`));

    if (this.tab === 'loadout') this.renderLoadout();
    if (this.tab === 'tree') this.renderTree();
    if (this.tab === 'stats') this.renderStats();
    if (this.tab === 'pack') this.renderPack();

    this.actions.append(button('CLOSE', () => this.handlers?.onClose()));
  }

  private renderLoadout(): void {
    const meta = this.meta!;
    const p = meta.progress;
    const slots: Array<[string, keyof typeof p.loadout]> = [
      ['WEAPON', 'weapon'],
      ['HEAD', 'head'],
      ['CHEST', 'chest'],
      ['ARMS', 'arms'],
      ['LEGS', 'legs'],
      ['RELIC A', 'relicA'],
      ['RELIC B', 'relicB'],
    ];
    const grid = div('build-grid');
    for (const [label, slot] of slots) {
      const it = findItem(p, p.loadout[slot]);
      const card = div('build-card');
      card.append(div('kicker', label));
      card.append(el('h3', undefined, it ? it.name : 'EMPTY'));
      if (it) {
        card.append(div('sval', `${it.rarity.toUpperCase()}${it.history.length ? ' · HISTORY' : ''}`));
        const def = ITEM_MAP.get(it.defId);
        if (def) card.append(div('sval', def.special ?? def.desc));
        for (const h of it.history) card.append(div('grudge', historyLine(h)));
      }
      grid.append(card);
    }
    this.body.append(grid);
    this.body.append(div('kicker', 'WHAT YOU LOSE ON DEATH'));
    this.body.append(
      div(
        'sval',
        'A named killer may steal the equipped weapon. Uniques like SUN SPEAR are always taken. Common iron is usually left. Recover it by killing them.'
      )
    );
    if (this.runNotes.length) {
      this.body.append(div('kicker', 'THIS RUN'));
      this.body.append(div('sval', this.runNotes.join(' · ')));
    }
  }

  private renderTree(): void {
    const meta = this.meta!;
    const p = meta.progress;
    const branches: TreeBranch[] = ['BLADE', 'RANGE', 'DEFENSE'];
    const row = div('build-tabs');
    for (const b of branches) {
      const btn = button(b, () => {
        this.treeBranch = b;
        this.render();
      });
      if (this.treeBranch === b) btn.classList.add('on');
      row.append(btn);
    }
    this.body.append(div('kicker', 'PERMANENT UNLOCK — CINDERS'));
    this.body.append(row);

    const list = div('tree-list');
    for (const n of nodesInBranch(this.treeBranch)) {
      const owned = p.skillNodes.includes(n.id);
      const open = canUnlock(n.id, p.skillNodes);
      const preview = nodePreview(n.id);
      const card = div('tree-node' + (owned ? ' owned' : open ? ' open' : ' locked'));
      card.append(div('kicker', `${n.cost} CINDERS`));
      card.append(el('h3', undefined, preview?.name ?? n.name));
      card.append(div('sval', preview?.desc ?? n.desc));
      card.append(div('sval', n.tags.join(' · ')));
      if (n.requires.length) {
        card.append(div('sval', 'NEEDS ' + n.requires.map((id) => SKILL_NODE_MAP.get(id)?.name ?? id).join(', ')));
      }
      if (!owned && open) {
        card.append(
          button('UNLOCK', () => {
            const r = unlockNode(meta, n.id);
            if (r === 'ok') this.handlers?.onChanged();
            this.render();
          })
        );
      } else {
        card.append(div('sval', owned ? 'OWNED' : 'LOCKED'));
      }
      list.append(card);
    }
    this.body.append(list);
    const remain = treeCostRemaining(p.skillNodes);
    if (remain > 0) this.body.append(div('sval', `${remain} CINDERS TO COMPLETE THE TREE`));
    this.body.append(
      button('RESPEC (REFUND ALL)', () => {
        respecTree(meta);
        this.handlers?.onChanged();
        this.render();
      })
    );
    void SKILL_NODES;
  }

  private renderStats(): void {
    const stats = this.stats;
    const panel = div('run-stats');
    if (!stats) {
      this.body.append(div('sval', 'Stats compile when a run is live. Tree and gear still apply on the next descent.'));
      return;
    }
    for (const s of stats.statList()) {
      const row = div('stat-row' + (s.count > 0 ? ' boosted' : ''));
      const name = div('sname', s.def.name);
      name.title = s.tip ?? STAT_TIPS[s.def.id] ?? s.def.desc;
      row.append(name, div('sval', s.text + (s.count > 0 ? ` +${s.count}` : '')));
      panel.append(row);
    }
    this.body.append(panel);
    const extra = [
      ['ARMOR', `${Math.round((1 - stats.armorIncomingMul) * 100)}% incoming reduction (negative = more)`],
      ['SURGE', `${Math.round(stats.surge)} / ${stats.surgeMax}`],
      ['WEAPON', stats.weaponId.toUpperCase()],
    ];
    for (const [k, v] of extra) {
      const row = div('stat-row');
      const name = div('sname', k);
      if (k === 'ARMOR') name.title = STAT_TIPS.maxHp && 'Reduces incoming damage from enemy hits.';
      row.append(name, div('sval', v));
      panel.append(row);
    }
  }

  private renderPack(): void {
    const meta = this.meta!;
    const p = meta.progress;
    const sort = [...p.inventory].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const list = div('pack-list');
    for (const it of sort) {
      const row = div('pack-row');
      const equipped = Object.values(p.loadout).includes(it.id);
      row.append(div('sname', `${it.favorite ? '★ ' : ''}${it.name}`));
      row.append(div('sval', `${it.rarity} · ${it.kind}${equipped ? ' · ON' : ''}`));
      row.append(
        button('EQUIP', () => {
          equipItem(meta, it.id);
          this.handlers?.onChanged();
          this.render();
        })
      );
      row.append(
        button('COMPARE', () => {
          this.compareId = it.id;
          this.render();
        })
      );
      row.append(
        button(it.favorite ? 'UNFAV' : 'FAV', () => {
          it.favorite = !it.favorite;
          this.render();
        })
      );
      if (!it.favorite && !equipped) {
        row.append(
          button('SALVAGE', () => {
            salvageItem(meta, it.id);
            this.handlers?.onChanged();
            this.render();
          })
        );
      }
      list.append(row);
    }
    this.body.append(list);
    if (this.compareId) {
      const next = findItem(p, this.compareId);
      const cur = findItem(p, p.loadout.weapon);
      if (next) this.body.append(this.compareBox(cur, next));
    }
  }

  private compareBox(cur: ItemInstance | null, next: ItemInstance): HTMLElement {
    const box = div('compare');
    box.append(el('h3', undefined, 'CURRENT  →  NEW'));
    const wcur = cur ? playerWeapon(ITEM_MAP.get(cur.defId)?.weaponId ?? 'sword') : null;
    const wnew = playerWeapon(ITEM_MAP.get(next.defId)?.weaponId ?? 'sword');
    const rows: Array<[string, string, string]> = [
      ['NAME', cur?.name ?? '—', next.name],
      ['DAMAGE', wcur ? String(wcur.damage) : '—', String(wnew.damage)],
      ['SPEED', wcur ? wcur.windup.toFixed(2) : '—', wnew.windup.toFixed(2)],
      ['POSTURE', wcur ? String(wcur.stagger) : '—', String(wnew.stagger)],
    ];
    for (const [l, a, b] of rows) {
      const r = div('stat-row');
      r.append(div('sname', l), div('sval', `${a}  →  ${b}`));
      box.append(r);
    }
    for (const line of compareLines(cur, next)) {
      const r = div('stat-row');
      r.append(div('sname', line.label), div('sval', `${esc(line.a)}  →  ${esc(line.b)}`));
      box.append(r);
    }
    return box;
  }
}
