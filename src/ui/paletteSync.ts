/**
 * Bridge palette.ts NEON / SIGNAL into CSS custom properties on :root.
 * Single source of truth for UI accent colours shared with Three.js.
 */

import { css, NEON, SIGNAL, WORLD } from '../data/palette';

function toKebab(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function setHexVars(root: HTMLElement, prefix: string, record: Record<string, number>): void {
  for (const [key, hex] of Object.entries(record)) {
    root.style.setProperty(`--${prefix}-${toKebab(key)}`, css(hex));
  }
}

function setVar(root: HTMLElement, name: string, hex: number): void {
  root.style.setProperty(name, css(hex));
}

/** Map gameplay signal keys to semantic CSS variable names. */
const SIGNAL_CSS: Partial<Record<keyof typeof SIGNAL, string>> = {
  player: '--signal-player',
  surge: '--signal-surge',
  enemyAttack: '--signal-enemy',
  parryable: '--signal-parry',
  unblockable: '--signal-danger',
  poison: '--signal-poison',
  execute: '--signal-execute',
  worldEvent: '--signal-world',
};

/** Colourblind-safe overrides for combat / god accents. */
const COLORBLIND_SIGNAL: Record<string, number> = {
  '--signal-enemy': 0xff6b35,
  '--signal-ally': 0x4fc3f7,
  '--signal-parry': 0xffe066,
  '--signal-danger': 0xff1744,
  '--signal-poison': 0xb2ff59,
};

/**
 * Write palette values to document.documentElement. Call once before the game boots.
 */
export function syncPaletteToCss(doc: Document = document): void {
  const root = doc.documentElement;

  setHexVars(root, 'world', WORLD);
  setHexVars(root, 'neon', NEON);
  setHexVars(root, 'signal', SIGNAL);

  for (const [key, name] of Object.entries(SIGNAL_CSS) as Array<[keyof typeof SIGNAL, string]>) {
    setVar(root, name, SIGNAL[key]);
  }

  setVar(root, '--signal-ally', SIGNAL.player);
  setVar(root, '--signal-enemy-attack', SIGNAL.enemyAttack);
  root.style.setProperty('--accent-player', css(SIGNAL.player));
  root.style.setProperty('--accent-danger', css(NEON.red));
  root.style.setProperty('--accent-story', 'var(--gold)');

  applyColorblindMode(root, root.dataset.colorblind === '1');
}

/** Toggle colorblind signal remaps without re-reading the full palette. */
export function applyColorblindMode(root: HTMLElement = document.documentElement, on = false): void {
  root.dataset.colorblind = on ? '1' : '0';
  if (on) {
    for (const [name, hex] of Object.entries(COLORBLIND_SIGNAL)) {
      setVar(root, name, hex);
    }
    return;
  }
  for (const [key, name] of Object.entries(SIGNAL_CSS) as Array<[keyof typeof SIGNAL, string]>) {
    setVar(root, name, SIGNAL[key]);
  }
  setVar(root, '--signal-ally', SIGNAL.player);
}

/** @deprecated use applyColorblindMode */
export function setColorblindMode(enabled: boolean, root: HTMLElement = document.documentElement): void {
  applyColorblindMode(root, enabled);
}
