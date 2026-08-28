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
import type { GodFacts, MythEventKind, NemesisFacts, StoryFacts } from './AITypes';
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

/* ============================================================
   long-game prompts — interpret facts, never invent them
   ============================================================ */

function godFactBlock(f: GodFacts): string {
  const lines: string[] = [];
  lines.push(`RUN: ${f.run}  CYCLE: ${f.cycle}  ACT: ${f.act}  CHAOS: ${Math.round(f.chaos)}`);
  if (f.headline) lines.push(`HEADLINE: ${f.headline}`);
  if (f.beatKind) lines.push(`EVENT KIND: ${f.beatKind} (${f.priority ?? ''})`);
  if (f.detail?.length) lines.push(`DETAIL:\n  ${f.detail.slice(0, 6).join('\n  ')}`);
  if (f.crisisTitle) {
    lines.push(`CRISIS: ${f.crisisTitle} (${f.crisisKind ?? ''})`);
    if (f.crisisDescription) lines.push(`CRISIS RECORD: ${f.crisisDescription}`);
  }
  if (f.ending) lines.push(`ENDING: ${f.ending}`);
  if (f.highlights?.length) lines.push(`HIGHLIGHTS:\n  ${f.highlights.join('\n  ')}`);
  if (f.legendName) {
    lines.push(`LEGEND: ${f.legendName}${f.legendTitle ? ' ' + f.legendTitle : ''}`);
    if (f.legendCause) lines.push(`CAUSE: ${f.legendCause}`);
    if (f.legendEpitaph) lines.push(`EXISTING EPITAPH: ${f.legendEpitaph}`);
    if (f.legendDeeds?.length) lines.push(`DEEDS:\n  ${f.legendDeeds.slice(0, 6).join('\n  ')}`);
  }
  lines.push('ALLOWED NAMES: ' + (f.names.join(', ') || '(none)'));
  for (const a of f.actors) {
    lines.push(
      `ACTOR ${a.name}${a.title ? ' ' + a.title : ''}: rank ${a.rank}, ${a.alive ? 'alive' : 'dead'}, ` +
        `${a.personality}, goal ${a.goal}, returns ${a.returns}, kills ${a.kills}, ` +
        `player-kills ${a.killedPlayer}` +
        (a.scars.length ? `, scars ${a.scars.join('/')}` : '') +
        (a.stolen.length ? `, carrying ${a.stolen.join('/')}` : '') +
        (a.heretic ? ', heretic' : '') +
        (a.crisisBorn ? ', is the crisis' : '')
    );
    if (a.deeds.length) lines.push(`  DEEDS: ${a.deeds.slice(-4).join('; ')}`);
  }
  return lines.join('\n');
}

export function dossierPrompt(f: GodFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write inspection copy for a god watching a simulation.`,
    user:
      `Write a character inspection dossier.\n\n` +
      `RULES:\n` +
      `- 2 sentences, third person, maximum 240 characters total.\n` +
      `- Every clause must match FACTS. Do not invent a motive, injury, rank, kill, or return.\n` +
      `- You may characterise what is listed (goal, deeds, scars, standing). You may not add to it.\n` +
      `- No heading. Output only the dossier.\n\n` +
      `FACTS\n${godFactBlock(f)}`,
  };
}

export function beatVoicePrompt(f: GodFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write a single caption under a fact that already happened.`,
    user:
      `Voice this event in one sentence.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 120 characters.\n` +
      `- It must describe the HEADLINE using only FACTS. Do not rename anyone.\n` +
      `- Do not introduce a new outcome, killer, or location.\n` +
      `- No quotation marks, no heading.\n\n` +
      `FACTS\n${godFactBlock(f)}`,
  };
}

export function crisisVoicePrompt(f: GodFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou restate a crisis the simulation already named.`,
    user:
      `Restate the crisis in two short sentences.\n\n` +
      `RULES:\n` +
      `- Maximum 200 characters.\n` +
      `- Use the crisis title and the body named in FACTS. Do not invent a new threat.\n` +
      `- No heading.\n\n` +
      `FACTS\n${godFactBlock(f)}`,
  };
}

export function recapPrompt(f: GodFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write a one-line run subtitle from the record.`,
    user:
      `Write one subtitle for this ended run.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 90 characters.\n` +
      `- It must agree with ENDING and HIGHLIGHTS. Do not invent a slayer, crisis, or survivor.\n` +
      `- No heading.\n\n` +
      `FACTS\n${godFactBlock(f)}`,
  };
}

export function legendPrompt(f: GodFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write epitaphs from a finished record.`,
    user:
      `Write an epitaph for this legend.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 140 characters.\n` +
      `- Ground it in CAUSE, DEEDS, and EXISTING EPITAPH. Do not add a death, title, or deed.\n` +
      `- No heading.\n\n` +
      `FACTS\n${godFactBlock(f)}`,
  };
}

/* ============================================================
   story polish prompts — pit-run reading surfaces
   ============================================================ */

function storyFactBlock(f: StoryFacts): string {
  const lines: string[] = [];
  lines.push(`SLOT: ${f.kind}`);
  if (f.headline) lines.push(`HEADLINE: ${f.headline}`);
  if (f.line) lines.push(`LINE: ${f.line}`);
  if (f.detail) lines.push(`DETAIL: ${f.detail}`);
  if (f.act) lines.push(`ACT: ${f.act}`);
  if (f.eventType) lines.push(`EVENT TYPE: ${f.eventType}`);
  if (f.witnessed !== undefined) lines.push(`WITNESSED: ${f.witnessed ? 'yes' : 'no'}`);
  if (f.known !== undefined) lines.push(`KNOWN: ${f.known ? 'yes' : 'rumor'}`);
  if (f.arcTitle) lines.push(`ARC: ${f.arcTitle} (${f.arcKind ?? ''})`);
  if (f.arcState) lines.push(`STATE: ${f.arcState}`);
  if (f.arcNext) lines.push(`NEXT: ${f.arcNext}`);
  if (f.encounterKind) lines.push(`ENCOUNTER: ${f.encounterKind}`);
  if (f.relationshipChip) lines.push(`RELATIONSHIP: ${f.relationshipChip}`);
  if (f.nemesisName) lines.push(`SUBJECT: ${f.nemesisName}`);
  if (f.linkLabel) lines.push(`LINK: ${f.linkLabel}`);
  if (f.linkText) lines.push(`SOURCE TEXT: ${f.linkText}`);
  if (f.cycle !== undefined) lines.push(`CYCLE: ${f.cycle}`);
  if (f.intention) lines.push(`INTENTION: ${f.intention}`);
  lines.push('ALLOWED NAMES: ' + (f.names.join(', ') || '(none)'));
  return lines.join('\n');
}

export function recapBeatPrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou rewrite death-report beats. Same facts, better read.`,
    user:
      `Rewrite the recap line into one vivid sentence.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 140 characters.\n` +
      `- Keep every actor and outcome from LINE and HEADLINE. Do not add events.\n` +
      `- Second person when the player was involved.\n` +
      `- No heading, no quotation marks.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}

export function timelinePrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write archival chronicle lines.`,
    user:
      `Rewrite this timeline entry as one archival sentence.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 140 characters.\n` +
      `- Slightly more distant tone than combat barks.\n` +
      `- Do not add actors, places, or outcomes not in FACTS.\n` +
      `- No heading.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}

export function journeyPrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou polish a single beat in a character journey log.`,
    user:
      `Rewrite this journey beat for ${f.nemesisName ?? 'the subject'}.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 120 characters.\n` +
      `- Same facts as LINE. Do not invent meetings or motives.\n` +
      `- No heading.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}

export function arcPrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou voice unresolved story threads.`,
    user:
      `Rewrite STATE and NEXT into two short sentences for this thread.\n\n` +
      `RULES:\n` +
      `- Line 1: current state. Line 2: what could happen next.\n` +
      `- Maximum 200 characters total.\n` +
      `- Use only names and facts listed. Do not invent opportunities.\n` +
      `- No heading.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}

export function encounterPrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou write encounter card headlines.`,
    user:
      `Rewrite the encounter headline.\n\n` +
      `RULES:\n` +
      `- Output ONLY the headline, maximum 80 characters, ALL CAPS optional.\n` +
      `- Ground it in ENCOUNTER and RELATIONSHIP facts.\n` +
      `- Do not invent a new reason they are here.\n` +
      `- No quotation marks.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}

export function aftermathLinkPrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou voice a consequence chain link for a god watching a simulation.`,
    user:
      `Rewrite this consequence link as one clear sentence.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 160 characters.\n` +
      `- Preserve the meaning of SOURCE TEXT. Do not claim the player forced an outcome.\n` +
      `- Do not invent actors or results.\n` +
      `- No heading.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}

export function situationPrompt(f: StoryFacts): { system: string; user: string } {
  return {
    system: `${VOICE}\n${HARD_RULE}\nYou voice a situation on the god board.`,
    user:
      `Rewrite the situation headline and detail into one tense sentence.\n\n` +
      `RULES:\n` +
      `- Output ONLY one sentence, maximum 140 characters.\n` +
      `- Same stakes as HEADLINE and DETAIL. No new threats.\n` +
      `- No heading.\n\n` +
      `FACTS\n${storyFactBlock(f)}`,
  };
}
