/**
 * Focus trap for fullscreen screens — keeps Tab inside modal UI.
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrap {
  release(): void;
}

export function trapFocus(container: HTMLElement): FocusTrap {
  const previous = document.activeElement as HTMLElement | null;

  const getFocusables = () =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const nodes = getFocusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);
  const nodes = getFocusables();
  (nodes[0] ?? container).focus();

  return {
    release() {
      container.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    },
  };
}
