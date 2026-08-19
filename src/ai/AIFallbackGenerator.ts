/**
 * Local, deterministic content generation.
 *
 * This is the load-bearing half of the AI feature. Every AI code path has a
 * fallback here, which is what lets the game ship, run and be enjoyed with the
 * AI switched off, the key missing, the backend down, or OpenAI returning 500s.
 *
 * Nothing in here is random at call time — everything derives from the
 * nemesis's own seed and history, so the same enemy always produces the same
 * fallback content across reloads.
 */

import type { Nemesis, ScarId } from '../nemesis/Nemesis';
import { fullName } from '../nemesis/Nemesis';
import { SCAR_NAMES, MEMORY_TEXT } from '../nemesis/NemesisMemory';
import { chooseTitle } from '../data/names';
import { pickLine } from '../data/dialogue';
import { getPersonality } from '../data/personalities';
import { traitName } from '../data/traits';
import { accentColorFor } from '../nemesis/NemesisAppearance';

/* ============================================================
   deterministic helpers
   ============================================================ */

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length) % list.length];
}

/* ============================================================
   titles
   ============================================================ */

/** The game already has a good title generator; this is the seam for it. */
export function fallbackTitle(n: Nemesis, avoid: Set<string> = new Set()): string {
  return chooseTitle(n, avoid);
}

/* ============================================================
   taunts
   ============================================================ */

const MEMORY_TAUNTS: Array<{ when: (n: Nemesis) => boolean; lines: string[] }> = [
  {
    when: (n) => n.killsAgainstPlayer >= 2,
    lines: ['You die the way I remember.', 'Again. Same as before.', 'You never learn the ending.'],
  },
  {
    when: (n) => n.scars.some((s) => s.id === 'burn'),
    lines: ['Try fire again.', 'The burning was the easy part.', 'I kept the ash.'],
  },
  {
    when: (n) => n.scars.some((s) => s.id === 'missing_eye'),
    lines: ['You took the eye. Not enough.', 'I see you fine.', 'One eye is plenty for you.'],
  },
  {
    when: (n) => n.returns > 0,
    lines: ['You looked disappointed when I stood up.', 'Death was boring.', 'I came back. You will not.'],
  },
  {
    when: (n) => n.stolen.length > 0,
    lines: ['Recognise this?', 'It suits me better.', 'You left it in the dirt.'],
  },
  {
    when: (n) => n.escapedPlayer > 0,
    lines: ['I chose to leave last time.', 'You were slow then too.'],
  },
  {
    when: (n) => n.defeatsByPlayer > 0,
    lines: ['You won once. Once.', 'I remember the ground.', 'That was practice.'],
  },
];

const GENERIC_TAUNTS = [
  'Stand still.',
  'Nothing worth remembering.',
  'This ends quiet.',
  'You smell like the last one.',
];

/**
 * Short lines derived strictly from what this nemesis actually remembers.
 * Falls back to the hand-written dialogue table, then to generics.
 */
export function fallbackTaunts(n: Nemesis, count = 3): string[] {
  const rnd = mulberry(n.appearanceSeed ^ 0x7a11);
  const out: string[] = [];

  for (const rule of MEMORY_TAUNTS) {
    if (out.length >= count) break;
    if (rule.when(n)) out.push(pick(rule.lines, rnd));
  }
  for (const ctx of ['taunt', 'arrival', 'kill'] as const) {
    if (out.length >= count) break;
    const line = pickLine(n, ctx, out.length);
    if (line && !out.includes(line)) out.push(line);
  }
  while (out.length < count) {
    const g = pick(GENERIC_TAUNTS, rnd);
    if (!out.includes(g)) out.push(g);
    else break;
  }
  return out.slice(0, count);
}

/* ============================================================
   chronicle
   ============================================================ */

/**
 * A compact factual history. Deliberately dry — the AI version's job is to
 * make this read well, not to add anything that is not already here.
 */
export function fallbackChronicle(n: Nemesis): string {
  const parts: string[] = [];
  const p = getPersonality(n.personality).name.toLowerCase();

  parts.push(`${n.name.toUpperCase()} came up out of ${n.territory.toUpperCase()} as ${p}.`);

  if (n.defeatsByPlayer > 0) {
    parts.push(
      n.defeatsByPlayer === 1
        ? 'You put them down once.'
        : `You put them down ${n.defeatsByPlayer} times.`
    );
  }
  if (n.scars.length) {
    parts.push(`They carry ${n.scars.map((s) => SCAR_NAMES[s.id].toLowerCase()).join(' and ')}.`);
  }
  if (n.escapedPlayer > 0) {
    parts.push(n.escapedPlayer === 1 ? 'They walked away once.' : `They walked away ${n.escapedPlayer} times.`);
  }
  if (n.returns > 0) {
    parts.push(n.returns === 1 ? 'They came back from the dead.' : `They came back ${n.returns} times.`);
  }
  if (n.stolen.length) {
    parts.push(`They took your ${n.stolen.map((s) => s.name.toLowerCase()).join(' and your ')}.`);
  }
  if (n.killsAgainstPlayer > 0) {
    parts.push(
      n.killsAgainstPlayer === 1
        ? 'They have killed you once.'
        : `They have killed you ${n.killsAgainstPlayer} times.`
    );
  }
  if (n.rank === 'overlord') parts.push('They hold the fortress now.');
  else if (n.rank === 'warlord') parts.push('They command warlords now.');
  else if (n.rank === 'captain') parts.push('They made captain.');

  if (parts.length === 1) parts.push('Nothing has happened between you yet.');
  return parts.join(' ');
}

/** Chronological fact lines, used by the Book of Enemies and the AI prompt. */
export function chronicleLines(n: Nemesis): string[] {
  return n.memory.map((m) => `TURN ${m.turn} — ${MEMORY_TEXT[m.type] ?? m.type}`);
}

/* ============================================================
   rumours / relationship lines
   ============================================================ */

export function fallbackRumour(n: Nemesis): string {
  if (n.stolen.length) return `${n.name.toUpperCase()} carries something that was yours.`;
  if (n.returns > 0) return `${n.name.toUpperCase()} has been buried and did not stay buried.`;
  if (n.killsAgainstPlayer > 1) return `${n.name.toUpperCase()} has killed you more than once.`;
  if (n.scars.length) return `${n.name.toUpperCase()} wears what you did to them.`;
  return `${n.name.toUpperCase()} is climbing.`;
}

/* ============================================================
   procedural portrait
   ============================================================ */

const SCAR_GLYPHS: Record<ScarId, string> = {
  burn: 'burn',
  missing_eye: 'eye',
  broken_mask: 'mask',
  metal_jaw: 'jaw',
  damaged_arm: 'arm',
  cracked_armor: 'armor',
  corruption: 'corrupt',
  shattered_horn: 'horn',
};

/**
 * A deterministic brutalist bust, drawn as SVG from the nemesis's own seed and
 * scars. This is the portrait when AI is off, and the placeholder the instant
 * a nemesis appears while a generated one is still being painted — which is
 * why it has to look intentional rather than like a missing asset.
 */
export function proceduralPortrait(n: Nemesis): string {
  const rnd = mulberry(n.appearanceSeed);
  const accent = accentColorFor(n);
  const W = 512;
  const H = 640;

  const ink = '#e8e6e0';
  const bg = '#0a0a0c';

  const headW = 150 + Math.floor(rnd() * 60);
  const headH = 175 + Math.floor(rnd() * 70);
  const cx = W / 2;
  const headTop = 120;
  const shoulderY = headTop + headH + 40;
  const shoulderW = headW * (n.archetype === 'heavy' ? 2.15 : n.archetype === 'archer' ? 1.55 : 1.85);

  const parts: string[] = [];

  // rough distressed ground
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const w = 4 + rnd() * 60;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="1" fill="${ink}" opacity="0.05"/>`
    );
  }

  // shoulders
  parts.push(
    `<path d="M ${cx - shoulderW / 2} ${H} L ${cx - shoulderW / 2} ${shoulderY + 30} ` +
      `L ${cx - headW * 0.55} ${shoulderY - 10} L ${cx + headW * 0.55} ${shoulderY - 10} ` +
      `L ${cx + shoulderW / 2} ${shoulderY + 30} L ${cx + shoulderW / 2} ${H} Z" fill="${ink}" opacity="0.92"/>`
  );

  // neck
  parts.push(
    `<rect x="${cx - headW * 0.18}" y="${headTop + headH - 10}" width="${headW * 0.36}" height="60" fill="${ink}" opacity="0.85"/>`
  );

  // head — angular mask
  const jaw = 0.32 + rnd() * 0.2;
  parts.push(
    `<path d="M ${cx - headW / 2} ${headTop + headH * 0.22} ` +
      `L ${cx - headW * 0.38} ${headTop} L ${cx + headW * 0.38} ${headTop} ` +
      `L ${cx + headW / 2} ${headTop + headH * 0.22} ` +
      `L ${cx + headW * jaw} ${headTop + headH} L ${cx - headW * jaw} ${headTop + headH} Z" fill="${ink}"/>`
  );

  // eye slits — the accent is the only colour in the piece
  const eyeY = headTop + headH * 0.42;
  const eyeW = headW * 0.24;
  const eyeH = 12 + rnd() * 8;
  const lostEye = n.scars.some((s) => s.id === 'missing_eye');
  parts.push(
    `<rect x="${cx - headW * 0.34}" y="${eyeY}" width="${eyeW}" height="${eyeH}" fill="${bg}"/>`
  );
  if (lostEye) {
    // a struck-through socket rather than a slit
    const x0 = cx + headW * 0.1;
    parts.push(`<rect x="${x0}" y="${eyeY}" width="${eyeW}" height="${eyeH}" fill="${bg}"/>`);
    parts.push(
      `<path d="M ${x0 - 6} ${eyeY - 10} L ${x0 + eyeW + 6} ${eyeY + eyeH + 10} ` +
        `M ${x0 + eyeW + 6} ${eyeY - 10} L ${x0 - 6} ${eyeY + eyeH + 10}" stroke="${accent}" stroke-width="5" fill="none"/>`
    );
  } else {
    parts.push(
      `<rect x="${cx + headW * 0.1}" y="${eyeY}" width="${eyeW}" height="${eyeH}" fill="${accent}"/>`
    );
    parts.push(
      `<rect x="${cx - headW * 0.34}" y="${eyeY}" width="${eyeW}" height="${eyeH}" fill="${accent}" opacity="0.55"/>`
    );
  }

  // scars
  for (const s of n.scars) {
    const g = SCAR_GLYPHS[s.id];
    if (g === 'burn') {
      for (let i = 0; i < 7; i++) {
        const y = headTop + 20 + rnd() * (headH - 30);
        const w = 10 + rnd() * (headW * 0.42);
        parts.push(
          `<rect x="${cx - headW / 2 + 4}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(2 + rnd() * 3).toFixed(1)}" fill="${bg}" opacity="0.8"/>`
        );
      }
    } else if (g === 'mask') {
      parts.push(
        `<path d="M ${cx + headW * 0.05} ${headTop} L ${cx - headW * 0.05} ${headTop + headH * 0.55} ` +
          `L ${cx + headW * 0.12} ${headTop + headH}" stroke="${bg}" stroke-width="6" fill="none"/>`
      );
    } else if (g === 'jaw') {
      parts.push(
        `<rect x="${cx - headW * jaw}" y="${headTop + headH - 34}" width="${headW * jaw * 2}" height="30" fill="${accent}" opacity="0.75"/>`
      );
    } else if (g === 'horn') {
      parts.push(
        `<path d="M ${cx - headW * 0.38} ${headTop} L ${cx - headW * 0.52} ${headTop - 46} L ${cx - headW * 0.24} ${headTop}" fill="${ink}"/>`
      );
      parts.push(
        `<path d="M ${cx + headW * 0.24} ${headTop} L ${cx + headW * 0.34} ${headTop - 18} L ${cx + headW * 0.38} ${headTop}" fill="${ink}" opacity="0.6"/>`
      );
    } else if (g === 'corrupt') {
      parts.push(
        `<circle cx="${cx}" cy="${headTop + headH * 0.72}" r="${14 + rnd() * 8}" fill="${accent}" opacity="0.8"/>`
      );
    } else if (g === 'armor') {
      parts.push(
        `<path d="M ${cx - shoulderW * 0.3} ${shoulderY + 40} L ${cx - shoulderW * 0.1} ${H - 40}" stroke="${bg}" stroke-width="7" fill="none"/>`
      );
    } else if (g === 'arm') {
      parts.push(
        `<rect x="${cx + shoulderW * 0.28}" y="${shoulderY + 20}" width="18" height="${H - shoulderY - 40}" fill="${bg}" opacity="0.7"/>`
      );
    }
  }

  // rank bar — a flat graphic-poster device, not a decoration
  const rankBars = { grunt: 0, elite: 1, captain: 2, warlord: 3, overlord: 4 }[n.rank] ?? 0;
  for (let i = 0; i < rankBars; i++) {
    parts.push(`<rect x="${40 + i * 26}" y="${H - 46}" width="18" height="6" fill="${accent}"/>`);
  }

  // weapon silhouette, bottom-right
  if (n.stolen.length || n.weapon === 'spear') {
    parts.push(
      `<rect x="${W - 74}" y="${shoulderY - 60}" width="7" height="${H - shoulderY + 60}" fill="${ink}" opacity="0.85" transform="rotate(9 ${W - 70} ${H})"/>`
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parts.join('') +
    `</svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** One-line description used in the debug panel and the Book of Enemies. */
export function describeAppearance(n: Nemesis): string {
  const bits: string[] = [n.archetype, n.weapon, n.rank];
  if (n.scars.length) bits.push(n.scars.map((s) => SCAR_NAMES[s.id].toLowerCase()).join(', '));
  if (n.strengths.length) bits.push(traitName(n.strengths[0]).toLowerCase());
  void fullName;
  return bits.join(' · ').toUpperCase();
}
