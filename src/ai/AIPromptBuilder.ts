/**
 * Turning simulation state into prompts.
 *
 * Two responsibilities:
 *
 *  1. `buildFacts` projects a Nemesis into a `NemesisFacts` snapshot, with
 *     history compressed so a nemesis with 400 remembered events still costs
 *     the same as one with 12.
 *  2. The prompt functions phrase those facts for the model and — critically —
 *     tell it the one rule it must not break: it may only interpret facts that
 *     appear in the prompt. If VARK is not fire resistant, nothing the model
 *     writes may say he is.
 *
 * The service validates responses on the way back in (see AIContentService),
 * because a prompt instruction is a request, not a guarantee.
 */

import type { Nemesis } from '../nemesis/Nemesis';
import type { MythEventKind, NemesisFacts } from './AITypes';
import { SCAR_NAMES, MEMORY_TEXT } from '../nemesis/NemesisMemory';
import { getPersonality } from '../data/personalities';
import { traitName } from '../data/traits';
import { accentColorFor } from '../nemesis/NemesisAppearance';
import { AREA_NAMES } from '../data/names';

/* ============================================================
   memory compression
   ============================================================ */

const IMPORTANT_MEMORIES = new Set([
  'PLAYER_KILLED_ME',
  'I_KILLED_PLAYER',
  'PLAYER_BURNED_ME',
  'PLAYER_HUMILIATED_ME',
  'I_STOLE_PLAYER_WEAPON',
  'PLAYER_STOLE_MY_WEAPON',
  'I_ESCAPED_PLAYER',
  'I_WAS_PROMOTED',
  'I_RETURNED_FROM_DEATH',
  'I_BETRAYED_ALLY',
  'I_WAS_BETRAYED',
  'PLAYER_EXECUTED_ME',
  'PLAYER_SPARED_ME',
]);

/**
 * Never send the whole memory. Important events, recent events, and a rolled-up
 * summary of everything older — the shape the design brief asks for.
 */
export function compressMemory(n: Nemesis): {
  important: string[];
  recent: string[];
  summary: string;
} {
  const all = n.memory;
  const important = all
    .filter((m) => IMPORTANT_MEMORIES.has(m.type))
    .slice(-10)
    .map((m) => `T${m.turn} ${MEMORY_TEXT[m.type] ?? m.type}`);
  const recent = all.slice(-20).map((m) => `T${m.turn} ${MEMORY_TEXT[m.type] ?? m.type}`);

  const older = all.slice(0, Math.max(0, all.length - 20));
  let summary = '';
  if (older.length) {
    const counts = new Map<string, number>();
    for (const m of older) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    const bits = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t, c]) => `${MEMORY_TEXT[t as keyof typeof MEMORY_TEXT] ?? t} x${c}`);
    summary = `Earlier (${older.length} events): ${bits.join('; ')}.`;
  }
  return { important, recent, summary };
}

/* ============================================================
   facts
   ============================================================ */

export function buildFacts(
  n: Nemesis,
  world: { turn: number; age: number; ageName: string },
  nameOf: (id: string | null) => string,
  trigger: MythEventKind | null = null
): NemesisFacts {
  const mem = compressMemory(n);
  const rel =
    n.playerRelationship > 70
      ? 'obsessed'
      : n.playerRelationship > 40
        ? 'vengeful'
        : n.playerRelationship > 15
          ? 'interested'
          : 'indifferent';

  return {
    id: n.id,
    name: n.name,
    currentTitle: n.title,
    seed: n.appearanceSeed,
    rank: n.rank,
    level: n.level,
    archetype: n.archetype,
    weapon: n.weapon,
    personality: n.personality,
    personalityLabel: getPersonality(n.personality).name,
    killedPlayer: n.killsAgainstPlayer,
    killedByPlayer: n.defeatsByPlayer,
    escapedPlayer: n.escapedPlayer,
    returns: n.returns,
    grudge: Math.round(n.playerRelationship),
    relationship: rel,
    strengths: n.strengths.map(traitName),
    weaknesses: n.weaknesses.map(traitName),
    adaptations: n.adaptations.map(traitName),
    scars: n.scars.map((s) => SCAR_NAMES[s.id]),
    stolen: n.stolen.map((s) => s.name),
    territory: AREA_NAMES[n.territory] ?? n.territory.toUpperCase(),
    worldTurn: world.turn,
    worldAge: world.age,
    ageName: world.ageName,
    accentColor: accentColorFor(n),
    rivals: n.rivalries.map(nameOf).filter(Boolean),
    allies: n.allies.map(nameOf).filter(Boolean),
    master: n.master ? nameOf(n.master) : null,
    importantEvents: mem.important,
    recentEvents: mem.recent,
    historicalSummary: mem.summary,
    trigger,
  };
}

/* ============================================================
   shared framing
   ============================================================ */

const HARD_RULE =
  'ABSOLUTE RULE: you may only refer to facts listed in FACTS below. ' +
  'You may not invent injuries, powers, kills, ranks, allies, weapons or events. ' +
  'If a fact is absent, it is not true. Inventing a mechanical fact is a failure. ' +
  'You are writing flavour text over a simulation that already happened.';

const VOICE =
  'SHDOWPIT is a brutal, minimalist dark-fantasy arena. The tone is terse, cold and physical. ' +
  'No fantasy cliché, no "mighty warrior", no purple prose, no exclamation marks, no emoji.';

function factBlock(f: NemesisFacts): string {
  const lines: string[] = [];
  lines.push(`NAME: ${f.name}`);
  lines.push(`CURRENT TITLE: ${f.currentTitle || '(none yet)'}`);
  lines.push(`RANK: ${f.rank} (level ${f.level})`);
  lines.push(`BUILD: ${f.archetype}, fights with a ${f.weapon}`);
  lines.push(`PERSONALITY: ${f.personalityLabel} (${f.personality})`);
  lines.push(`TIMES THEY KILLED THE PLAYER: ${f.killedPlayer}`);
  lines.push(`TIMES THE PLAYER KILLED THEM: ${f.killedByPlayer}`);
  lines.push(`TIMES THEY ESCAPED THE PLAYER: ${f.escapedPlayer}`);
  lines.push(`TIMES THEY RETURNED FROM DEATH: ${f.returns}`);
  lines.push(`FEELING TOWARD PLAYER: ${f.relationship} (grudge ${f.grudge})`);
  lines.push(`STRENGTHS: ${f.strengths.join(', ') || 'none'}`);
  lines.push(`WEAKNESSES: ${f.weaknesses.join(', ') || 'none'}`);
  if (f.adaptations.length) lines.push(`LEARNED COUNTERS: ${f.adaptations.join(', ')}`);
  lines.push(`SCARS: ${f.scars.join(', ') || 'none'}`);
  lines.push(`STOLEN FROM PLAYER: ${f.stolen.join(', ') || 'nothing'}`);
  lines.push(`TERRITORY: ${f.territory}`);
  lines.push(`WORLD: age ${f.worldAge} "${f.ageName}", turn ${f.worldTurn}`);
  if (f.master) lines.push(`SERVES: ${f.master}`);
  if (f.rivals.length) lines.push(`RIVALS: ${f.rivals.join(', ')}`);
  if (f.allies.length) lines.push(`ALLIES: ${f.allies.join(', ')}`);
  if (f.trigger) lines.push(`JUST HAPPENED: ${f.trigger.replace(/_/g, ' ')}`);
  if (f.importantEvents.length) lines.push(`KEY HISTORY:\n  ${f.importantEvents.join('\n  ')}`);
  if (f.recentEvents.length) lines.push(`RECENT:\n  ${f.recentEvents.join('\n  ')}`);
  if (f.historicalSummary) lines.push(f.historicalSummary);
  return lines.join('\n');
}

/* ============================================================
   prompts
   ============================================================ */

export function identityPrompt(f: NemesisFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write earned epithets for recurring enemies.`,
    user:
      `Give ${f.name} a title they have earned through the facts below.\n\n` +
      `RULES:\n` +
      `- Output ONLY the title, nothing else.\n` +
      `- Format: "THE <something>" in capitals, 1 to 3 words after THE.\n` +
      `- It must reference something in FACTS: a scar, a deed, a rank, a theft, a return from death.\n` +
      `- Do NOT output their name. Do NOT rename them.\n` +
      `- Do not reuse the current title.\n\n` +
      `FACTS\n${factBlock(f)}`,
  };
}

export function tauntPrompt(f: NemesisFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write single-line combat barks. Sparse. This is not a chatbot.`,
    user:
      `Write 3 things ${f.name} says to the player on sight.\n\n` +
      `RULES:\n` +
      `- One line each, maximum 12 words, no quotation marks.\n` +
      `- Each line must be grounded in a specific fact below — a scar the player gave them, ` +
      `a time they killed the player, something they stole, a death they came back from.\n` +
      `- If they have never met the player in the facts, keep the lines impersonal.\n` +
      `- Output exactly 3 lines, one per line, nothing else.\n\n` +
      `FACTS\n${factBlock(f)}`,
  };
}

export function chroniclePrompt(f: NemesisFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou summarise histories. You never add events.`,
    user:
      `Summarise the history between the player and ${f.name}.\n\n` +
      `RULES:\n` +
      `- 2 to 4 sentences, second person, addressed to the player ("You burned him...").\n` +
      `- Every clause must correspond to a fact or event listed below.\n` +
      `- Do not invent a first meeting, a location, or a motive that is not listed.\n` +
      `- No preamble, no heading. Just the summary.\n\n` +
      `FACTS\n${factBlock(f)}`,
  };
}

/* ============================================================
   portrait
   ============================================================ */

const ART_DIRECTION = [
  'minimalist brutalist dark-fantasy graphic poster portrait',
  'isolated character bust, centred, facing viewer',
  'extremely high contrast, mostly flat black',
  'bone and ivory forms',
  'rough ink texture, distressed printed paper, visible grain',
  'low-poly angular geometry, hard edges, no soft shading',
  'flat plain background, no scenery, no landscape',
  'no text, no lettering, no logos, no watermark, no frame, no border',
  'not photorealistic, not 3D render, not glossy',
];

const ARCHETYPE_BODY: Record<string, string> = {
  fighter: 'lean upright humanoid warrior, medium build, square shoulders',
  heavy: 'huge broad hulking humanoid, thick slab shoulders, heavy armour plate',
  archer: 'tall thin wiry humanoid, narrow shoulders, hunched stance',
};

const PERSONALITY_POSTURE: Record<string, string> = {
  coward: 'guarded, turned slightly away',
  hunter: 'still, watchful, head level',
  showoff: 'chest out, chin raised, arrogant posture',
  madman: 'crooked, tilted head, unbalanced stance',
  collector: 'trophies hung on the body',
  avenger: 'rigid, forward-leaning, tense',
  opportunist: 'loose, side-on, weight back',
  loyalist: 'formal, upright, disciplined',
  traitor: 'half-turned, concealed hands',
  survivor: 'battered, weight on one side',
  obsessed: 'staring directly forward, unnervingly still',
  ambitious: 'imposing, deliberately posed, chin raised',
};

const SCAR_VISUAL: Record<string, string> = {
  'BURN SCARS': 'heavy burn scarring across one side of the face and shoulder, blackened skin',
  'MISSING EYE': 'one eye destroyed and dark, empty socket, the other eye glowing',
  'BROKEN MASK': 'cracked angular face mask, a split running top to bottom',
  'METAL JAW': 'crude riveted metal jaw replacing the lower face',
  'DAMAGED ARM': 'one arm withered and hanging wrong',
  'CRACKED ARMOUR': 'split and broken chest armour, exposed underlayer',
  'GLOWING CORRUPTION': 'glowing corruption bleeding through cracks in the chest',
  'SHATTERED HORN': 'one horn snapped off short, the other intact',
};

const RANK_VISUAL: Record<string, string> = {
  grunt: 'no insignia, plain gear',
  elite: 'a single rank mark, scavenged armour',
  captain: 'captain insignia, a heavy shoulder plate',
  warlord: 'warlord regalia, layered plate, a hanging banner scrap',
  overlord: 'overlord crown-mask, ceremonial heavy armour, imposing silhouette',
};

/**
 * Build the image prompt strictly from real nemesis data. Every visual clause
 * traces back to a field: body from archetype, scars from `scars`, weapon from
 * `weapon` and `stolen`, posture from `personality`, colour from the same
 * accent the 3D model uses — so the portrait and the thing you fight agree.
 */
export function portraitPrompt(f: NemesisFacts): string {
  const bits: string[] = [];

  bits.push(ARCHETYPE_BODY[f.archetype] ?? ARCHETYPE_BODY.fighter);
  bits.push('black angular face mask');

  for (const s of f.scars) {
    const v = SCAR_VISUAL[s];
    if (v) bits.push(v);
  }

  bits.push(RANK_VISUAL[f.rank] ?? RANK_VISUAL.grunt);
  bits.push(PERSONALITY_POSTURE[f.personality] ?? 'still, neutral stance');

  if (f.stolen.length) {
    bits.push(`carrying a stolen ${f.stolen[0].toLowerCase()}`);
  } else {
    bits.push(`carrying a ${f.weapon}`);
  }

  if (f.returns > 0) bits.push('visibly dead once and returned, grey and dried');
  if (f.killedPlayer >= 3) bits.push('trophies of past kills worn on the body');

  bits.push(`single accent colour ${f.accentColor} used sparingly, everything else black and bone`);
  bits.push(`world theme: ${f.ageName.toLowerCase()}`);

  const subject = f.currentTitle ? `${f.name} ${f.currentTitle}` : f.name;

  return (
    `Character portrait of ${subject}, a warrior. ` +
    bits.join('. ') +
    '. ' +
    ART_DIRECTION.join(', ') +
    '.'
  );
}
