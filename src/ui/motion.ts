/**
 * Lightweight motion helpers — CSS class toggles with reduced-motion guards.
 */

export type MotionVariant = 'fade' | 'slide-up' | 'slide-left' | 'scale' | 'beat';

const ENTER_CLASS: Record<MotionVariant, string> = {
  fade: 'motion-enter-fade',
  'slide-up': 'motion-enter-slide-up',
  'slide-left': 'motion-enter-slide-left',
  scale: 'motion-enter-scale',
  beat: 'motion-enter-beat',
};

/** True when OS, settings, or ui-motion mode disables animation. */
export function respectReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  const root = document.documentElement;
  if (root.classList.contains('reduced-motion')) return true;
  const mode = root.dataset.uiMotion;
  if (mode === 'off' || mode === 'reduced') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Apply an enter animation class; instant opacity when motion is reduced. */
export function enter(el: HTMLElement, variant: MotionVariant = 'fade'): void {
  el.classList.remove('motion-exit');
  if (respectReducedMotion()) {
    el.style.opacity = '1';
    el.style.transform = 'none';
    return;
  }
  for (const cls of Object.values(ENTER_CLASS)) el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(ENTER_CLASS[variant]);
}

/** Fade / slide element out; resolves when animation ends (instant if reduced). */
export function exit(el: HTMLElement): Promise<void> {
  if (respectReducedMotion()) {
    el.style.opacity = '0';
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('animationend', done);
      resolve();
    };
    el.classList.add('motion-exit');
    el.addEventListener('animationend', done, { once: true });
  });
}

/** Stagger enter animations across child elements. */
export function stagger(children: readonly HTMLElement[], delayMs = 60, variant: MotionVariant = 'fade'): void {
  const step = respectReducedMotion() ? 0 : delayMs;
  children.forEach((child, i) => {
    window.setTimeout(() => enter(child, variant), i * step);
  });
}

/** Sync document data attribute from pause settings. */
export function applyUiMotion(mode: 'full' | 'reduced' | 'off'): void {
  document.documentElement.dataset.uiMotion = mode;
}
