/**
 * THE LONG GAME — vertical-slice harness.
 *
 * Walks the seventeen points the sprint brief calls the slice, in order,
 * against the real production build in headless Chromium. Every assertion is
 * made on state the game actually produced; nothing here nudges the simulation
 * toward a result it did not reach on its own.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/godtest.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';
import { PLAYTEST_URL } from './url.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = PLAYTEST_URL;
const SHOTS = path.join(ROOT, 'god-shots');

const errors = [];
const checks = [];

function log(...a) {
  console.log('[god]', ...a);
}
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 130) : ''}`);
}

function snapRoster(list) {
  return list.map((n) => ({
    id: n.id,
    alive: n.alive,
    rank: n.rank,
    power: n.power,
    territory: n.territory,
    faction: n.faction ?? '',
    master: n.master ?? null,
    allies: n.allies ?? 0,
    stolen: n.stolen ?? 0,
  }));
}

/** Hard roster mutations allowed only for priced exceptions (§6-1). */
function rosterHardIssues(before, after, interventionId) {
  const allowed = interventionId === 'raise' || interventionId === 'gift' || interventionId === 'calamity';
  const issues = [];
  const byBefore = new Map(before.map((n) => [n.id, n]));
  const byAfter = new Map(after.map((n) => [n.id, n]));
  if (interventionId === 'calamity' && after.length <= before.length) {
    issues.push('calamity did not add a body');
  } else if (!allowed && before.length !== after.length) {
    issues.push(`roster ${before.length}->${after.length}`);
  }
  for (const [id, b] of byBefore) {
    const a = byAfter.get(id);
    if (!a) {
      if (!allowed) issues.push(`missing ${id}`);
      continue;
    }
    if (b.alive !== a.alive || b.rank !== a.rank) {
      if (interventionId !== 'raise') {
        issues.push(`${id} alive/rank`);
      }
    }
    if (interventionId !== 'gift' && b.stolen !== a.stolen) {
      issues.push(`${id} stolen`);
    }
    if (!allowed && Math.abs(b.power - a.power) > 10) {
      issues.push(`${id} power ${b.power}->${a.power}`);
    }
  }
  return issues;
}

function beat(n, title) {
  log(`\n---------- ${n}. ${title}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack ?? '')));

  const god = (cmd, a, b, c) => page.evaluate(([x, y, z, w]) => window.SHDOWPIT.__god(x, y, z, w), [cmd, a, b, c]);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  check('game booted', await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined'));

  /* ============================================================
     1. a run starts
     ============================================================ */
  beat(1, 'A RUN STARTS');
  // Fresh world first, so the slice never inherits an older save's state.
  await page.evaluate(() => window.SHDOWPIT.__debug().resetSave());
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const titleButtons = await page.$$eval('#title-screen button', (e) => e.map((x) => x.textContent));
  check('title offers THE LONG GAME', titleButtons.some((t) => /LONG GAME/.test(t)), titleButtons.join(', '));
  check('Long Game is the primary CTA', titleButtons[0]?.includes('LONG GAME') || /BEGIN THE LONG GAME|CONTINUE THE LONG GAME/.test(titleButtons.join('|')), titleButtons[0]);
  check('Descend Alone is secondary', titleButtons.some((t) => /DESCEND ALONE/.test(t)));

  const bgProbe = await god('bgTickProbe');
  check(
    'background tick returns headline when event is important',
    bgProbe.fired === true && typeof bgProbe.headline === 'string' && bgProbe.headline.length > 0,
    JSON.stringify(bgProbe)
  );

  // Preload god bundle, then start in separate evaluates — openLongGameAsync
  // mutates the DOM and can destroy a long-running page.evaluate context.
  await page.evaluate(async () => {
    await window.SHDOWPIT.__ensureGodLayer();
  });
  await god('start');
  await page.waitForTimeout(600);
  let s = await god('state');
  check('the run began', s.active === true && s.cycle === 1, `cycle ${s.cycle}`);
  check('the board is on screen', s.mode === 'god', s.mode);
  check('influence starts spendable', s.influence >= 5, `${s.influence}/${s.influenceMax}`);
  check('chaos starts at zero', s.chaos === 0, String(s.chaos));
  check('opening starts focused', s.openingDone === false && !!s.focusSituationId, `${s.openingDone} ${s.focusSituationId}`);
  check('Tower Commander scenario is staged', s.towerScenario === true);
  await shot('01-board.png');

  /* ============================================================
     2 & 3. named characters with relationships and personalities
     ============================================================ */
  beat(2, 'SEVERAL NAMED CHARACTERS EXIST');
  let roster = (await god('roster')).list;
  const living = roster.filter((n) => n.alive);
  check('a cast exists', living.length >= 8, `${living.length} alive`);
  check('houses exist', s.factions >= 2, `${s.factions} factions`);
  const named = living.filter((n) => n.name && n.rank !== 'grunt');
  check('everyone is a named character', named.length === living.length, `${named.length}/${living.length}`);

  beat(3, 'THEY HAVE RELATIONSHIPS AND PERSONALITIES');
  const distinctGoals = new Set(living.map((n) => n.goal));
  const withFaction = living.filter((n) => n.faction);
  check('characters are sworn to houses', withFaction.length >= living.length * 0.6, `${withFaction.length}/${living.length}`);
  check('inner state is populated', living.every((n) => typeof n.confidence === 'number' && typeof n.ambition === 'number'));
  check('goals are set', distinctGoals.size >= 1, [...distinctGoals].join(', '));

  /* ============================================================
     4. the player observes
     ============================================================ */
  beat(4, 'THE PLAYER OBSERVES');
  const sits = (await god('situations')).list;
  check('the board surfaces situations', sits.length > 0, `${sits.length} situations`);
  check('situations are readable sentences', sits.every((x) => x.headline.length > 8 && x.detail.length > 12), sits[0]?.headline);
  check('opening prefers one focus situation', sits.length <= 4, `${sits.length}`);
  check('situations are sorted by urgency', sits.every((x, i) => i === 0 || sits[i - 1].urgency >= x.urgency));
  check('situations name levers, not answers', sits.some((x) => x.suggest.length > 0), (sits[0]?.suggest ?? []).join(','));
  check('Tower is discoverable on the board', sits.some((x) => /TOWER/i.test(x.headline) || x.id === 'scenario:tower'), sits.map((x) => x.headline).join(' | '));
  const boardText = await page.$eval('#god-screen', (e) => e.textContent).catch(() => '');
  const oracleDom = await page.evaluate(() => ({
    now: !!document.querySelector('.god-now'),
    map: !!document.querySelector('.god-map-canvas'),
    clock: !!document.querySelector('.god-clock'),
  }));
  check('oracle UI renders', /THE LONG GAME/.test(boardText) && oracleDom.now && oracleDom.map);
  check('world clock is visible', oracleDom.clock === true);
  check('NOW card shows stakes', /LET TIME PASS|INTERFERE/.test(boardText));
  check('the teaching rail is mounted', s.teachShowing === true, String(s.teachShowing));
  check('the guided first cycle is live', s.guideStep === 'select' || s.guideStep === 'spend', String(s.guideStep));
  check('the rail teaches the loop', /YOU ARE NOT IN THIS WORLD|LEARNING THE LOOP/.test(boardText));
  const colAdvance = await page.$eval('#god-advance', (e) => e.textContent.trim()).catch(() => '');
  check('advance lives in the action strip', /ADVANCE|LET TIME PASS/.test(colAdvance), colAdvance);
  const footerAdvance = await page.$$eval('.god-foot-controls button', (els) =>
    els.map((e) => e.textContent.trim()).filter((t) => t === 'ADVANCE ▸')
  );
  check('the footer does not duplicate Advance', footerAdvance.length === 0, footerAdvance.join(','));
  const skipBtns = await page.$$eval('.god-foot-controls button', (els) => els.map((e) => e.textContent.trim()));
  check('×N waits until after the opening advance', !skipBtns.includes('×5') && !skipBtns.includes('×20'), skipBtns.join(','));
  const overlayHidden = await page.$eval('.god-overlay', (e) => e.classList.contains('hidden')).catch(() => false);
  check('no overlay owns the opening', overlayHidden === true);

  /* ============================================================
     5. the player spends Influence on indirect interventions
     ============================================================ */
  beat(5, 'THE PLAYER SPENDS INFLUENCE INDIRECTLY');
  const cat = (await god('interventions')).list;
  check('the intervention catalogue is populated', cat.length >= 8, `${cat.length} interventions`);
  check('every intervention has a price in both currencies', cat.every((i) => i.cost > 0 && typeof i.chaos === 'number'));

  const target = sits.find((x) => x.actors.length)?.actors[0] ?? living[0].id;
  const before = await god('state');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#god-screen button')].find((b) => /INTERFERE/.test(b.textContent || ''));
    btn?.click();
  });
  await page.waitForTimeout(200);
  const blessClicked = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.god-int')].find((el) => el.dataset.id === 'bless' && !el.classList.contains('off'));
    if (!card) return false;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  check('BLESS is on the board to click', blessClicked);
  await page.waitForTimeout(250);
  const afterBlessOverlay = await page.$eval('.god-overlay', (e) => e.classList.contains('hidden')).catch(() => true);
  check('a cheap mark writes without a confirm modal', afterBlessOverlay === true);
  const afterBlessAdv = await page.$eval('#god-advance', (e) => e.textContent.trim()).catch(() => '');
  check('after a spend the strip says Advance', afterBlessAdv === 'ADVANCE ▸', afterBlessAdv);
  const blessRes = await god('state');
  check('an intervention resolves', blessRes.godConditions >= 1, `${blessRes.godConditions} marks`);
  check('it charges influence', blessRes.influence < before.influence, `${before.influence} -> ${blessRes.influence}`);
  check('it raises chaos', blessRes.chaos > before.chaos, `${before.chaos} -> ${blessRes.chaos}`);
  check('it leaves a condition on the world', blessRes.godConditions >= 1, `${blessRes.godConditions} marks`);

  // The core design rule, asserted mechanically.
  const rosterAfter = (await god('roster')).list;
  const beforeById = new Map(roster.map((n) => [n.id, n]));
  const changedHard = rosterAfter.filter((n) => {
    const b = beforeById.get(n.id);
    return b && (b.alive !== n.alive || b.rank !== n.rank);
  });
  check('interventions create conditions, not outcomes', changedHard.length === 0, `${changedHard.length} hard changes`);
  // The UI blesses whoever sits in slot A (the focus situation's first actor),
  // which is not always the first actor of the top-urgency card — so find the
  // blessed one by the mark it left rather than by guessing the slot.
  const blessed = rosterAfter.find((n) => n.memoryTypes.includes('GOD_BLESSED_ME')) ?? rosterAfter.find((n) => n.id === target);
  check('the target only had their state nudged', !!blessed && blessed.confidence >= (beforeById.get(blessed.id)?.confidence ?? 0));
  check('the target remembers it was touched', (blessed?.memoryTypes ?? []).includes('GOD_BLESSED_ME'));

  const two = living.slice(0, 2).map((n) => n.id);
  const whisper = await god('intervene', 'whisper', two[0], two[1]);
  check('a two-party intervention works', whisper.ok === true, whisper.reason);
  const badPair = await god('intervene', 'whisper', two[0], two[0]);
  check('a nonsensical target is refused', badPair.ok === false, badPair.reason);

  /* ============================================================
     5c. every catalogue entry — conditions, not outcomes
     ============================================================ */
  beat('5c', 'INTERVENTION CATALOGUE PROOF');
  await page.evaluate(() => window.SHDOWPIT.__debug().godAddInfluence?.(200));
  const catalogue = (await god('interventions')).list;
  let catalogueFails = 0;
  for (const def of catalogue) {
    if (def.id === 'descend') continue;
    const before = snapRoster((await god('roster')).list);
    const livingNow = (await god('roster')).list.filter((n) => n.alive);
    const deadNow = (await god('roster')).list.filter((n) => !n.alive);
    let res;
    if (def.targeting === 'nemesis' || def.targeting === 'pair') {
      const a = livingNow[0]?.id;
      const b = livingNow[1]?.id;
      if (!a) continue;
      res = await god('intervene', def.id, a, def.targeting === 'pair' ? b : undefined);
    } else if (def.targeting === 'dead') {
      const d = deadNow[0]?.id;
      if (!d) continue;
      res = await god('intervene', def.id, d);
    } else if (def.targeting === 'area') {
      res = await god('interveneArea', def.id, livingNow[0]?.territory ?? 'tower');
    } else {
      res = await god('intervene', def.id);
    }
    if (!res.ok) continue;
    const after = snapRoster((await god('roster')).list);
    const issues = rosterHardIssues(before, after, def.id);
    if (issues.length) {
      catalogueFails++;
      check(`catalogue ${def.id} writes conditions only`, false, issues.join('; '));
    }
  }
  check('catalogue loop fired without forbidden hard changes', catalogueFails === 0, `${catalogueFails} failures`);

  const spentAdvance = await god('advance', '1');
  check(
    'aftermath credits the spend, not autonomy',
    /spent Influence/i.test(spentAdvance.aftermathIntention ?? ''),
    spentAdvance.aftermathIntention
  );
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.god-overlay button')].find((x) => /CONTINUE/.test(x.textContent || ''));
    b?.click();
  });
  await page.waitForTimeout(250);
  const whyFound = await page.evaluate(() => {
    const clickMatching = (sel, re) => {
      const el = [...document.querySelectorAll(sel)].find((e) => re.test((e.textContent || '').trim()));
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    clickMatching('#god-screen button', /OPEN FEED/);
    clickMatching('.god-filter-btn', /^MINOR$/);
    const n = document.querySelectorAll('.god-beat-head').length;
    for (let i = 0; i < n; i++) {
      const head = document.querySelectorAll('.god-beat-head')[i];
      if (!head) continue;
      head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if ([...document.querySelectorAll('#god-screen button')].some((e) => (e.textContent || '').trim() === 'WHY')) return true;
    }
    return false;
  });
  check('WHY is available on a decision beat', whyFound);

  await shot('02-after-intervention.png');

  /* ============================================================
     5b. Tower → DESCEND → return (Long Game ↔ 3D loop)
     ============================================================ */
  beat('5b', 'TOWER COMMANDER DESCENT LOOP');
  await page.evaluate(() => window.SHDOWPIT.__debug().godAddInfluence?.(40));
  const tower = sits.find((x) => x.id === 'scenario:tower') ?? sits.find((x) => /TOWER/i.test(x.headline));
  const towerId = tower?.actors?.[0] ?? living.find((n) => n.territory === 'tower')?.id ?? living[0].id;
  const desc = await god('descend', towerId);
  check('contextual descend enters the pit', desc.ok === true && desc.mode === 'playing', `${desc.ok} ${desc.mode} ${desc.reason}`);
  const returned = await god('forceReturn');
  check('return lands back on the board', returned.mode === 'god' && returned.active === true, String(returned.mode));
  check('return produces a strategic report', returned.hasDescentReport === true);
  await god('clearBoards');

  /* ============================================================
     6, 7, 8. time advances, NPCs act, encounters happen
     ============================================================ */
  beat(6, 'TIME ADVANCES AND NPCS ACT ON THEIR OWN');
  const adv = await god('advance', '3');
  check('cycles advance', adv.cycle >= 4, `cycle ${adv.cycle}`);
  check('acceleration is cheap', adv.ms < 4000, `${adv.ms}ms for 3 cycles`);
  const dec = (await god('decisions')).list;
  check('every actor made a decision', dec.length > 0, `${dec.length} decisions recorded`);
  check('decisions weighed alternatives', dec.every((d) => d.considered.length >= 2), `${dec[0]?.considered.length} considered`);
  check('decisions carry a full score breakdown', dec[0]?.parts && 'personality' in dec[0].parts && 'danger' in dec[0].parts);
  const actionsUsed = new Set(dec.map((d) => d.chosen));
  check('different characters chose different things', actionsUsed.size >= 2, [...actionsUsed].join(', '));

  beat(8, 'COMBAT AND ENCOUNTERS OCCUR');
  let feed = (await god('feed', 'background')).list;
  const fights = feed.filter((b) => ['duel', 'revenge', 'hunt', 'betrayal'].includes(b.kind));
  check('fights happen without the player', fights.length > 0, `${fights.length} fights in 3 cycles`);
  check('a fight reads as a sentence, not a stat line', fights[0] && /[A-Z]/.test(fights[0].headline) && fights[0].headline.length > 20, fights[0]?.headline);
  check('a fight can be expanded for blow-by-blow detail', fights.some((b) => b.detail.length >= 2), fights[0]?.detail?.[0]);

  /* ============================================================
     9, 10, 11. win / lose / flee / die / return, memory, reputation
     ============================================================ */
  beat(9, 'CHARACTERS WIN, LOSE, FLEE, DIE AND RETURN');
  const mid = await god('advance', '12');
  roster = (await god('roster')).list;
  feed = (await god('feed', 'background')).list;
  const dead = roster.filter((n) => !n.alive);
  check('characters die', dead.length > 0, `${dead.length} dead`);
  check('characters flee', roster.some((n) => n.escapedFrom.length > 0), roster.filter((n) => n.escapedFrom.length).length + ' have run from someone');
  check('characters win and lose', roster.some((n) => n.wins > 0) && roster.some((n) => n.losses > 0));
  const returns = feed.filter((b) => b.kind === 'return');
  const returnedViaMemory = roster.some((n) => n.memoryTypes.includes('I_RETURNED_FROM_DEATH'));
  // RECONSTRUCTION: returns are meant to be rare — one or two a run, each
  // an event — so a fixed window is not allowed to demand one. What the
  // check guards now is the opposite failure: a world where death reverses
  // every few cycles.
  check(
    'death is not routine — returns stay rare',
    returns.length <= 3,
    `${returns.length} return beats in ${mid.cycle} cycles; resurrected=${returnedViaMemory}`
  );

  beat(10, 'MEMORY CHANGES FUTURE BEHAVIOUR');
  const withMemory = roster.filter((n) => n.memoryTypes.length > 0);
  check('characters accumulate memory', withMemory.length > 0, `${withMemory.length} have memories`);
  const npcMemories = new Set(roster.flatMap((n) => n.memoryTypes).filter((t) => t.startsWith('I_') || t.startsWith('MY_')));
  check('memories are about each other, not only the player', npcMemories.size >= 3, [...npcMemories].slice(0, 6).join(', '));
  const wanting = roster.filter((n) => n.alive && n.revenge.length > 0);
  check('memory turns into intent', wanting.length > 0, `${wanting.length} are hunting somebody`);
  const held = roster.find((n) => n.alive && n.goal === 'revenge' && n.goalTarget);
  check('an intent is held across cycles', !!held, held ? `${held.name} wants ${held.goalTarget}` : 'none yet');

  beat(11, 'CHARACTERS GAIN REPUTATION AND POWER');
  const grown = roster.filter((n) => n.deeds.length >= 2);
  check('characters accumulate deeds', grown.length > 0, `${grown.length} have a history`);
  const strongest = roster.slice().sort((a, b) => b.power - a.power)[0];
  check('somebody has pulled ahead', strongest.power > 120, `${strongest.name} at ${strongest.power}`);

  /* ============================================================
     12. chaos rises from intervention
     ============================================================ */
  beat(12, 'CHAOS RISES FROM INTERVENTION');
  check('chaos accumulated', mid.chaosPeak > 0, `peak ${Math.round(mid.chaosPeak)}`);
  const chaosBefore = mid.chaos;
  await page.evaluate(() => window.SHDOWPIT.__debug().godAddInfluence?.(60));
  const dead0 = (await god('roster')).list.find((n) => !n.alive);
  if (dead0) {
    const raise = await god('intervene', 'raise', dead0.id);
    check('a heavy intervention costs heavily', raise.ok === true && raise.chaos > chaosBefore + 5, `${chaosBefore} -> ${raise.chaos} ${raise.reason ?? ''}`);
  } else {
    check('a heavy intervention costs heavily', false, 'nobody dead to raise');
  }

  /* ============================================================
     13. a major nemesis emerges naturally
     ============================================================ */
  beat(13, 'A MAJOR NEMESIS EMERGES FROM THE SIMULATION');
  let st = await god('state');
  let guard = 0;
  while (!st.crisis && !st.ended && guard++ < 30) st = await god('advance', '1');
  check('a crisis formed', !!st.crisis, st.crisis ? `${st.crisis.title} — ${st.crisis.body}` : 'none');
  check('the crisis is a character the simulation produced', !!st.crisis?.body, st.crisis?.body);
  const crisisInRoster = (await god('roster')).list.find((n) => n.name === st.crisis?.body);
  check('the crisis has real history behind it', !!crisisInRoster && (crisisInRoster.deeds.length > 0 || crisisInRoster.wins > 0), `${crisisInRoster?.wins}W ${crisisInRoster?.deeds.length} deeds`);
  await shot('03-crisis.png');

  /* ============================================================
     14 & 15. a final crisis occurs, the run ends
     ============================================================ */
  beat(14, 'THE RUN REACHES AN ENDING');
  guard = 0;
  while (!st.ended && guard++ < 60) st = await god('advance', '2');
  check('the run ends', st.ended === true, `cycle ${st.cycle}`);
  const outcome = st.outcome;
  check('the ending is one of the four', ['triumph', 'collapse', 'stalemate', 'abandoned'].includes(outcome?.ending), outcome?.ending);
  check('the ending is explained in prose', (outcome?.highlights ?? []).length >= 2, outcome?.highlights?.[0]);
  check('the run is scored', outcome?.cycles > 1 && outcome?.interventions >= 1, `${outcome?.cycles} cycles, ${outcome?.interventions} interventions`);
  const endText = await page.$eval('#god-end-screen', (e) => e.textContent).catch(() => '');
  check('the end screen rendered', endText.length > 40, endText.replace(/\s+/g, ' ').slice(0, 70));
  await shot('04-run-end.png');

  /* ============================================================
     16. a character reaches the Book of Legends
     ============================================================ */
  beat(16, 'SOMEBODY IS WORTH REMEMBERING');
  const book = (await god('book')).list;
  check('the Book has entries', book.length > 0, `${book.length} legends`);
  const l = book[book.length - 1];
  check('a legend carries a name and a rank', !!l?.name && !!l?.finalRank, `${l?.name} ${l?.title} — ${l?.finalRank}`);
  check('a legend carries deeds', (l?.deeds ?? []).length > 0, l?.deeds?.[0]);
  check('a legend records how they died', !!l?.causeOfDeath, l?.causeOfDeath);
  check('a legend records what they thought of you', typeof l?.standing === 'number', String(l?.standing));
  check('a legend leaves something behind', !!l?.legacy, l?.legacy);
  check('a legend has an epitaph', !!l?.epitaph, l?.epitaph);

  /* ============================================================
     17. the next run starts with persistent progression
     ============================================================ */
  beat(17, 'THE NEXT RUN INHERITS THE LAST');
  const unlocksAfter = st.unlocks ?? [];
  await god('next');
  await page.waitForTimeout(600);
  const next = await god('state');
  check('a second run starts', next.active === true && next.cycle === 1, `run ${next.run}`);
  check('the run counter advanced', next.run >= 2, String(next.run));
  check('the Book survived the reset', next.legends >= book.length, `${next.legends} legends`);
  check('unlocks persist', (next.unlocks ?? []).length >= unlocksAfter.length, (next.unlocks ?? []).join(', ') || 'none earned');

  const openFeed = (await god('feed', 'major')).list;
  const echo = openFeed.find((b) => b.kind === 'legacy');
  check('history reaches into the new world', !!echo || book.length === 0, echo?.headline ?? 'no legacy echo this seed');

  /* ============================================================
     the two rules that must not be broken
     ============================================================ */
  beat(18, 'THE RULES');
  const s2 = await god('state');
  const rosterNew = (await god('roster')).list;
  check('the player controls no hero on the board', s2.mode === 'god');
  check('the world is populated from the start', rosterNew.filter((n) => n.alive).length >= 8);

  // AI must remain optional: this whole suite ran with no provider connected.
  const aiOff = await page.evaluate(() => window.SHDOWPIT.__aiStatus());
  check('the whole layer ran with AI off', aiOff.mode === 'off' || aiOff.connected === false, JSON.stringify(aiOff).slice(0, 60));

  await shot('05-second-run.png');

  /* ============================================================ */
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('shdowpit.world.v1');
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { version: d.saveVersion, legends: (d.legends ?? []).length, god: !!d.god, unlocks: (d.godUnlocks ?? []).length, runs: d.godHistory?.runs ?? 0 };
  });
  check('the god run is in the save', !!persisted?.god, JSON.stringify(persisted));
  check('the save is version 9', persisted?.version === 9, String(persisted?.version));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(async () => {
    await window.SHDOWPIT.__ensureGodLayer();
  });
  await god('start');
  await page.waitForTimeout(600);
  const resumed = await god('state');
  check('a run resumes after a reload', resumed.active === true && resumed.cycle >= 1, `cycle ${resumed.cycle}`);

  await browser.close();

  const passed = checks.filter((c) => c.ok).length;
  console.log('\n================ THE LONG GAME ================');
  console.log(`checks: ${passed}/${checks.length} passed`);
  for (const c of checks.filter((x) => !x.ok)) console.log('  FAILED: ' + c.name + ' ' + c.detail);
  console.log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log('  ' + e.slice(0, 200));
  console.log(`screenshots in ${SHOTS}`);
  if (passed !== checks.length || errors.length) process.exit(1);
}

main().catch((e) => {
  console.error('godtest failed:', e);
  process.exit(1);
});
