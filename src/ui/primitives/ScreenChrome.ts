import { div, el } from '../Dom';

export interface ScreenChromeOptions {
  kicker?: string;
  title: string;
  subtitle?: string;
  titleTag?: 'h1' | 'h2';
}

/** Title block with optional kicker and horizontal rule. */
export function ScreenChrome(opts: ScreenChromeOptions): HTMLElement {
  const root = div('screen-chrome');
  if (opts.kicker) root.append(div('kicker', opts.kicker));
  const title = el(opts.titleTag ?? 'h1', undefined, opts.title);
  root.append(title);
  if (opts.subtitle) root.append(el('h2', undefined, opts.subtitle));
  root.append(div('rule'));
  return root;
}
