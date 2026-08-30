/** Minimal DOM helpers so the UI files stay readable. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function div(className?: string, text?: string): HTMLDivElement {
  return el('div', className, text);
}

export function button(label: string, onClick: () => void, className = 'brut'): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

/** Complex row/card — keyboard-activatable without nesting interactive children. */
export function actionable(el: HTMLElement, onClick: () => void): HTMLElement {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onClick();
    }
  });
  return el;
}

/** True when the browser should handle Tab / Space / Enter on this element. */
export function isNativeKeyTarget(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.getAttribute('role') === 'button';
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: HTMLElement, visible: boolean): void {
  node.classList.toggle('hidden', !visible);
}

/** Escape text going into innerHTML. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
