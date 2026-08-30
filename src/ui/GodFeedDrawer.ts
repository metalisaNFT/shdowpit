/**
 * Feed timeline drawer for THE LONG GAME.
 */

import { clear, div, el } from './Dom';
import { filterFeed, groupByCycle, PRIORITY_LABEL, beatToneClass, summariseCycle } from '../god/Feed';
import type { GodRun } from '../god/GodRun';
import type { Beat, BeatPriority } from '../god/GodTypes';
import type { GodHooks } from './GodScreen';
import { Drawer } from './primitives/Drawer';

const PRIORITIES: BeatPriority[] = ['background', 'notable', 'major', 'legendary'];

export class GodFeedDrawer {
  readonly drawer: Drawer;
  private feedFloor: BeatPriority = 'notable';
  private expanded = new Set<string>();
  private filterActor: string | null = null;

  onBeatClick: ((b: Beat) => void) | null = null;
  onInspect: ((id: string) => void) | null = null;

  constructor() {
    this.drawer = new Drawer({
      title: 'CONSEQUENCES',
      className: 'god-feed-drawer',
      side: 'right',
      closeLabel: 'CLOSE',
    });
    this.drawer.onClose = () => {
      /* sync handled by GodScreen render */
    };
  }

  mount(parent: HTMLElement): void {
    this.drawer.mount(parent);
  }

  toggle(): void {
    this.drawer.toggle();
  }

  open(): void {
    this.drawer.open();
  }

  close(): void {
    this.drawer.close();
  }

  isOpen(): boolean {
    return this.drawer.isOpen();
  }

  render(run: GodRun, hooks: GodHooks): void {
    if (!this.drawer.isOpen()) return;
    clear(this.drawer.body);

    const filter = div('god-filter');
    for (const p of PRIORITIES) {
      const b = el('button', 'god-filter-btn' + (this.feedFloor === p ? ' sel' : ''), PRIORITY_LABEL[p]);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.feedFloor = p;
        this.render(run, hooks);
      });
      filter.append(b);
    }
    this.drawer.body.append(filter);

    const feedSource = this.filterActor
      ? filterFeed(run.god.feed, this.feedFloor, this.filterActor)
      : filterFeed(run.god.feed, this.feedFloor);
    const groups = groupByCycle(feedSource, this.feedFloor).slice(0, 14);
    if (!groups.length) {
      this.drawer.body.append(div('god-empty', 'Nothing at this level yet.'));
      return;
    }

    const list = div('god-feed-list');
    for (const g of groups) {
      const section = div('god-feed-cycle');
      section.append(div('god-cycle-head god-cycle-sticky', summariseCycle(g.cycle, g.beats)));
      for (const b of g.beats.slice().reverse()) section.append(this.beatEl(b, run, hooks));
      list.append(section);
    }
    this.drawer.body.append(list);
  }

  private beatEl(b: Beat, run: GodRun, hooks: GodHooks): HTMLElement {
    const el = div(`god-beat ${beatToneClass(b)} pr-${b.priority}`);
    const voice = hooks.beatVoiceFor?.(b);
    const showVoice = voice && voice !== b.headline && (this.expanded.has(b.id) || b.priority === 'legendary');
    const head = div('god-beat-head', b.headline);
    head.addEventListener('click', () => {
      if (this.expanded.has(b.id)) this.expanded.delete(b.id);
      else this.expanded.add(b.id);
      this.onBeatClick?.(b);
      this.render(run, hooks);
    });
    el.append(head);
    if (showVoice) el.append(div('god-beat-voice', voice));
    if (this.expanded.has(b.id)) {
      const body = div('god-beat-body');
      for (const line of b.detail) body.append(div('god-beat-line', line));
      if (voice && voice !== b.headline && b.priority !== 'legendary') {
        body.append(div('god-beat-voice', voice));
      }
      el.append(body);
    }
    return el;
  }
}
