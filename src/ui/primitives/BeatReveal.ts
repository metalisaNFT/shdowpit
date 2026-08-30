import { div } from '../Dom';
import { enter, respectReducedMotion } from '../motion';

export interface BeatRevealOptions {
  text: string;
  className?: string;
  delayMs?: number;
  variant?: 'fade' | 'slide-left' | 'beat';
}

/** Single timed reveal line (death report beats, comic panels). */
export function BeatReveal(opts: BeatRevealOptions): HTMLDivElement {
  const el = div(`beat-reveal report-line${opts.className ? ' ' + opts.className : ''}`, opts.text);
  if (respectReducedMotion()) {
    el.style.opacity = '1';
    return el;
  }
  const delay = opts.delayMs ?? 0;
  if (delay > 0) {
    el.style.opacity = '0';
    window.setTimeout(() => enter(el, opts.variant ?? 'slide-left'), delay);
  } else {
    enter(el, opts.variant ?? 'slide-left');
  }
  return el;
}

/** Schedule a sequence of beat reveals into a parent container. */
export function revealBeats(
  parent: HTMLElement,
  lines: string[],
  intervalMs = 340,
  className?: string
): number[] {
  const timers: number[] = [];
  const step = respectReducedMotion() ? 0 : intervalMs;
  lines.forEach((text, i) => {
    const t = window.setTimeout(() => {
      parent.append(BeatReveal({ text, className, variant: 'slide-left' }));
    }, i * step);
    timers.push(t);
  });
  return timers;
}
