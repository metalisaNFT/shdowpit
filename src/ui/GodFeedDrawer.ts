/**
 * Feed timeline drawer for THE LONG GAME.
 */

import { button, clear, div, show } from './Dom';
import { filterFeed, groupByCycle, PRIORITY_LABEL, beatToneClass, summariseCycle } from '../god/Feed';
import type { GodRun } from '../god/GodRun';
import type { Beat, BeatPriority } from '../god/GodTypes';
import type { GodHooks } from './GodScreen';

const PRIORITIES: BeatPriority[] = ['background', 'notable', 'major', 'legendary'];

export class GodFeedDrawer {
  readonly root = div('god-feed-drawer hidden');
  private open = false;
  private feedFloor: BeatPriority = 'notable';
  private expanded = new Set<string>();
  private filterActor: string | null = null;

  onBeatClick: ((b: Beat) => void) | null = null;
  onInspect: ((id: string) => void) | null = null;

  toggle(): void {
    this.open = !this.open;
    show(this.root, this.open);
  }

  isOpen(): boolean {
    return this.open;
  }

  render(run: GodRun, hooks: GodHooks): void {
    if (!this.open) return;
    clear(this.root);

    const head = div('god-drawer-head');
    head.append(div('god-drawer-title', 'CONSEQUENCES'));
    head.append(button('CLOSE', () => this.toggle(), 'brut tiny'));
    this.root.append(head);

    const filter = div('god-filter');
    for (const p of PRIORITIES) {
      const b = div('god-filter-btn' + (this.feedFloor === p ? ' sel' : ''), PRIORITY_LABEL[p]);
      b.addEventListener('click', () => {
        this.feedFloor = p;
        this.render(run, hooks);
      });
      filter.append(b);
    }
    this.root.append(filter);

    const feedSource = this.filterActor
      ? filterFeed(run.god.feed, this.feedFloor, this.filterActor)
      : filterFeed(run.god.feed, this.feedFloor);
    const groups = groupByCycle(feedSource, this.feedFloor).slice(0, 14);
    if (!groups.length) {
      this.root.append(div('god-empty', 'Nothing at this level yet.'));
      return;
    }
    for (const g of groups) {
      this.root.append(div('god-cycle-head', summariseCycle(g.cycle, g.beats)));
      for (const b of g.beats.slice().reverse()) this.root.append(this.beatEl(b, run, hooks));
    }
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
