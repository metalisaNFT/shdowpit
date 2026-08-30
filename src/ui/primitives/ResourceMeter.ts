import { div } from '../Dom';

export type MeterTone = 'default' | 'good' | 'gold' | 'hot' | 'cold';

export interface ResourceMeterOptions {
  label: string;
  value?: string;
  /** Secondary tier label (e.g. chaos tier name). */
  tierLabel?: string;
  /** 0–1 fill ratio */
  ratio: number;
  /** optional ghost fill (e.g. damage preview) */
  ghostRatio?: number;
  tone?: MeterTone;
  small?: boolean;
  /** Segment tick marks across the track (influence pools). */
  segments?: number;
  id?: string;
  fillId?: string;
  className?: string;
}

/** Labelled bar meter for HUD / god resources. */
export function ResourceMeter(opts: ResourceMeterOptions): HTMLElement {
  const wrap = div(
    'resource-meter' +
      (opts.small ? ' compact' : '') +
      (opts.className ? ' ' + opts.className : '') +
      (opts.tierLabel ? ' has-tier' : '')
  );
  if (opts.id) wrap.id = opts.id;
  const labelRow = div('hud-label resource-meter-head');
  labelRow.append(div('resource-meter-label', opts.label));
  const valWrap = div('resource-meter-values');
  if (opts.value) valWrap.append(div('resource-meter-value resource-meter-val', opts.value));
  if (opts.tierLabel) valWrap.append(div('resource-meter-tier', opts.tierLabel));
  if (valWrap.childElementCount) labelRow.append(valWrap);
  wrap.append(labelRow);

  const bar = div('bar resource-meter-track' + (opts.small ? ' small' : ''));
  if (opts.ghostRatio !== undefined) {
    const ghost = div('ghost');
    ghost.style.transform = `scaleX(${Math.max(0, Math.min(1, opts.ghostRatio))})`;
    bar.append(ghost);
  }
  const fill = div('fill resource-meter-fill');
  if (opts.fillId) fill.id = opts.fillId;
  if (opts.tone && opts.tone !== 'default') fill.classList.add(opts.tone);
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, opts.ratio))})`;
  bar.append(fill);
  if (opts.segments && opts.segments > 1) {
    const segs = div('resource-meter-segments');
    for (let i = 0; i < opts.segments; i++) segs.append(div('resource-meter-tick'));
    bar.append(segs);
  }
  wrap.append(bar);
  return wrap;
}

/** Update an existing meter fill ratio in place. */
export function setMeterRatio(meter: HTMLElement, ratio: number, ghostRatio?: number): void {
  const fill = meter.querySelector<HTMLElement>('.fill');
  const ghost = meter.querySelector<HTMLElement>('.ghost');
  const clamped = Math.max(0, Math.min(1, ratio));
  if (fill) fill.style.transform = `scaleX(${clamped})`;
  if (ghost && ghostRatio !== undefined) {
    ghost.style.transform = `scaleX(${Math.max(0, Math.min(1, ghostRatio))})`;
  }
}
