import { button, div } from '../Dom';

export interface ModeCardOptions {
  kicker?: string;
  label: string;
  description?: string;
  hint?: string;
  variant?: 'primary' | 'secondary';
  className?: string;
  id?: string;
  onClick: () => void;
}

/** Primary / secondary mode action block (title screen, god footer). */
export function ModeCard(opts: ModeCardOptions): HTMLElement {
  const variant = opts.variant ?? 'secondary';
  const root = div(`mode-card mode-card-${variant}${opts.className ? ' ' + opts.className : ''}`);
  if (opts.id) root.id = opts.id;
  if (opts.kicker) root.append(div('mode-card-kicker', opts.kicker));
  root.append(button(opts.label, opts.onClick, 'brut'));
  if (opts.description) root.append(div('mode-card-desc', opts.description));
  if (opts.hint) root.append(div('mode-card-hint', opts.hint));
  return root;
}
