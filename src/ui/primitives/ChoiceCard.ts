import { button, clear, div } from '../Dom';

export interface ChoiceCardOptions {
  title: string;
  tag?: string;
  description?: string;
  hint?: string;
  delta?: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}

/** Single selectable card — keyboard-focusable button semantics. */
export function ChoiceCard(opts: ChoiceCardOptions): HTMLButtonElement {
  const card = button('', () => {
    if (!opts.disabled) opts.onClick();
  }, `choice-card power-card${opts.className ? ' ' + opts.className : ''}`);
  card.type = 'button';
  card.disabled = !!opts.disabled;
  if (opts.disabled) card.classList.add('disabled');

  clear(card);
  card.append(div('pname', opts.title));
  if (opts.tag) card.append(div('ptag', opts.tag));
  if (opts.delta) card.append(div('p-delta', opts.delta));
  if (opts.description) card.append(div('pdesc', opts.description));
  if (opts.hint) card.append(div('pkey', opts.hint));
  return card;
}
