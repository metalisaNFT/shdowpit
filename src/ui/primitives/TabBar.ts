import { div } from '../Dom';

export interface TabBarItem<T extends string = string> {
  id: T;
  label: string;
  disabled?: boolean;
}

export interface TabBarOptions<T extends string = string> {
  items: TabBarItem<T>[];
  active: T;
  className?: string;
  onSelect: (id: T) => void;
}

/** Shared tab strip for pause settings and hierarchy screens. */
export function TabBar<T extends string>(opts: TabBarOptions<T>): HTMLElement {
  const root = div(`meta-tab-bar${opts.className ? ' ' + opts.className : ''}`);
  const indicator = div('meta-tab-indicator');
  root.append(indicator);

  for (const item of opts.items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'meta-tab' + (item.id === opts.active ? ' active' : '');
    btn.textContent = item.label;
    btn.disabled = !!item.disabled;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', item.id === opts.active ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (!item.disabled) opts.onSelect(item.id);
    });
    root.append(btn);
  }

  return root;
}

export function setTabBarActive(bar: HTMLElement, activeId: string): void {
  for (const btn of bar.querySelectorAll<HTMLButtonElement>('button.meta-tab')) {
    const on = btn.textContent?.trim() === activeId || btn.dataset.tabId === activeId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}
