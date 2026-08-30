import { div } from '../Dom';

export interface CardGridOptions {
  dense?: boolean;
  className?: string;
}

/** Flex grid wrapper for choice / power cards. */
export function CardGrid(opts: CardGridOptions = {}): HTMLDivElement {
  const classes = ['card-grid', 'power-grid'];
  if (opts.dense) classes.push('dense');
  if (opts.className) classes.push(opts.className);
  return div(classes.join(' '));
}
