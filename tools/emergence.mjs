/**
 * Does the simulation actually write stories?
 *
 * The sprint brief lists eight things that should happen without anyone
 * scripting them. This runs many accelerated runs against the real build and
 * counts how often each one occurs. It is deliberately NOT a pass/fail on a
 * single run — emergence is a distribution, and a harness that demanded one
 * specific outcome would just be a script with extra steps.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/emergence.mjs            # 10 runs
 *   RUNS=30 VERBOSE=1 node tools/emergence.mjs
 */

import { launchChromium } from './browser.mjs';
import { godEval, godStart } from './godHarness.mjs';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const RUNS = Number(process.env.RUNS ?? 10);
const VERBOSE = process.env.VERBOSE === '1';
const WORLD_SEED = process.env.WORLD_SEED ? Number(process.env.WORLD_SEED) : null;
const MIN_RATE = process.env.MIN_RATE
  ? Object.fromEntries(
      process.env.MIN_RATE.split(',').map((pair) => {
        const [key, val] = pair.split(':');
        return [key.trim(), Number(val)];
      })
    )
  : {};
if (process.env.MIN_RATE_grudge_chain) MIN_RATE.grudge_chain = Number(process.env.MIN_RATE_grudge_chain);
if (process.env.MIN_RATE_ally_turned) MIN_RATE.ally_turned = Number(process.env.MIN_RATE_ally_turned);

/** The eight patterns, each with the question it is really asking. */
const PATTERNS = [
  ['weak_rises', 'a weak character unexpectedly becomes powerful'],
  ['returned_revenge', 'someone who ran comes back for the one they ran from'],
  ['ally_turned', 'a former ally becomes an enemy'],
  ['leader_overthrown', 'a house leader is replaced or a house comes apart'],
  ['backfire', 'the player\'s own investment becomes the problem'],
  ['protected_grew', 'someone grows powerful because the player kept protecting them'],
  ['crisis_from_sim', 'the final crisis is a character the simulation produced'],
  ['grudge_chain', 'a multi-step grudge forms (A wants B, B wants C)'],
];

const totals = Object.fromEntries(PATTERNS.map(([k]) => [k, 0]));
const runsWith = Object.fromEntries(PATTERNS.map(([k]) => [k, 0]));
const endings = {};
const errors = [];
const stories = [];

async function main() {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const god = (cmd, a, b, c) => godEval(page, cmd, a, b, c);

  await page.evaluate(() => window.SHDOWPIT.__debug().resetSave());
  await page.waitForTimeout(300);
  if (WORLD_SEED != null && !Number.isNaN(WORLD_SEED)) {
    await god('simregReset', String(WORLD_SEED));
    await page.waitForTimeout(300);
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);

  let totalCycles = 0;
  const t0 = Date.now();

  for (let r = 0; r < RUNS; r++) {
    let st = await godStart(page);
    const startRoster = new Map((await god('roster')).list.map((n) => [n.id, n]));
    const invested = new Map(); // id -> count of player interventions aimed at them
    let guard = 0;

    while (!st.ended && guard++ < 60) {
      /* ---- interfere, using the board the way a player would ---- */
      const sits = (await god('situations')).list;
      const cat = (await god('interventions')).list.filter((i) => i.affordable);
      let spends = 2;
      while (spends-- > 0 && sits.length && cat.length) {
        const sit = sits[Math.floor(Math.random() * sits.length)];
        const wantId = sit.suggest.length ? sit.suggest[Math.floor(Math.random() * sit.suggest.length)] : null;
        const def = cat.find((i) => i.id === wantId) ?? cat[Math.floor(Math.random() * cat.length)];
        if (!def || def.targeting === 'dead' || def.targeting === 'area' || def.targeting === 'none') continue;
        const a = sit.actors[0] ?? null;
        const b = sit.actors[1] ?? null;
        if (!a) continue;
        if (def.targeting === 'pair' && !b) continue;
        const res = await god('intervene', def.id, a, def.targeting === 'pair' ? b : null);
        if (res.ok) {
          invested.set(a, (invested.get(a) ?? 0) + 1);
          if (['bless', 'mend', 'gift', 'crown'].includes(def.id)) {
            invested.set(a + ':protect', (invested.get(a + ':protect') ?? 0) + 1);
          }
        }
      }
      st = await god('advance', '2');
    }

    /* ---- read what came of it ---- */
    const roster = (await god('roster')).list;
    const feed = (await god('feed', 'background')).list;
    const outcome = st.outcome ?? {};
    endings[outcome.ending ?? 'unfinished'] = (endings[outcome.ending ?? 'unfinished'] ?? 0) + 1;
    totalCycles += outcome.cycles ?? 0;

    const found = Object.fromEntries(PATTERNS.map(([k]) => [k, 0]));
    const byPower = roster.slice().sort((a, b) => b.power - a.power);
    const top3 = new Set(byPower.slice(0, 3).map((n) => n.id));

    for (const n of roster) {
      const was = startRoster.get(n.id);
      if (was && (was.rank === 'elite' || was.rank === 'grunt') && (top3.has(n.id) || n.rank === 'warlord' || n.rank === 'overlord')) {
        found.weak_rises++;
      }
      if (n.deeds.some((d) => /came back for/.test(d))) found.returned_revenge++;
      if (was && (invested.get(n.id + ':protect') ?? 0) >= 2 && n.power > was.power * 1.35) found.protected_grew++;
      for (const bId of n.revenge) {
        const b = roster.find((x) => x.id === bId);
        if (b && b.alive && b.revenge.some((c) => c !== n.id)) {
          found.grudge_chain++;
          break;
        }
      }
    }

    found.ally_turned += feed.filter((b) => b.kind === 'betrayal').length;
    if (!found.ally_turned) {
      found.ally_turned += roster.filter((n) => n.memoryTypes.includes('I_BETRAYED_ALLY')).length;
    }
    found.leader_overthrown += feed.filter((b) => b.kind === 'faction').length;

    const body = st.crisis?.body ? roster.find((n) => n.name === st.crisis.body) : null;
    if (body) {
      found.crisis_from_sim++;
      if ((invested.get(body.id) ?? 0) > 0) found.backfire++;
    }
    // The other backfire: somebody you propped up killed somebody else you propped up.
    for (const n of roster) {
      if ((invested.get(n.id) ?? 0) === 0) continue;
      const victims = feed.filter((b) => b.kind === 'duel' && b.actors[0] === n.id).flatMap((b) => b.actors.slice(1));
      if (victims.some((v) => (invested.get(v) ?? 0) > 0)) {
        found.backfire++;
        break;
      }
    }

    for (const [k] of PATTERNS) {
      totals[k] += found[k];
      if (found[k] > 0) runsWith[k]++;
    }

    const legend = (await god('book')).list.slice(-1)[0];
    stories.push({
      run: r + 1,
      ending: outcome.ending,
      cycles: outcome.cycles,
      chaos: outcome.chaosPeak,
      crisis: outcome.crisis,
      legend: legend ? `${legend.name} ${legend.title} — ${legend.deeds[0] ?? legend.epitaph}` : '—',
    });
    if (VERBOSE) {
      console.log(`[run ${r + 1}] ${outcome.ending} in ${outcome.cycles} cycles · ${outcome.crisis}`);
      console.log(`          ${stories[stories.length - 1].legend}`);
      console.log('          ' + PATTERNS.filter(([k]) => found[k] > 0).map(([k]) => k).join(', '));
    }

    await god('next');
  }

  await browser.close();

  /* ============================================================ */
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n================ EMERGENCE ================');
  console.log(`${RUNS} runs · ${totalCycles} cycles · ${elapsed}s · endings ${JSON.stringify(endings)}`);
  console.log('');
  let missing = 0;
  for (const [key, question] of PATTERNS) {
    const ok = runsWith[key] > 0;
    if (!ok) missing++;
    console.log(
      `${ok ? 'YES' : 'NO '}  ${String(runsWith[key]).padStart(2)}/${RUNS} runs · ${String(totals[key]).padStart(3)} times  — ${question}`
    );
  }
  console.log('');
  console.log('A sample of what the world wrote on its own:');
  for (const s of stories.slice(0, 6)) {
    console.log(`  run ${s.run}  ${s.ending} · ${s.crisis}`);
    console.log(`         ${s.legend}`);
  }
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  ' + e.slice(0, 180));

  // Endings must actually vary, or the run structure is decorative.
  const distinctEndings = Object.keys(endings).length;
  console.log(`\ndistinct endings across the sample: ${distinctEndings}`);
  const minPatternRuns = Math.max(1, Math.ceil(RUNS * 0.3));
  const weakPatterns = PATTERNS.filter(([key]) => runsWith[key] < minPatternRuns);
  if (weakPatterns.length) {
    console.log(`\nPatterns below ${minPatternRuns}/${RUNS} run threshold:`);
    for (const [key, question] of weakPatterns) {
      console.log(`  ${key}: ${runsWith[key]}/${RUNS} — ${question}`);
    }
  }
  if (missing || errors.length || weakPatterns.length) process.exit(1);

  const minRateWarns = [];
  for (const [key, minRuns] of Object.entries(MIN_RATE)) {
    if (Number.isNaN(minRuns)) continue;
    if ((runsWith[key] ?? 0) < minRuns) minRateWarns.push(`${key}: ${runsWith[key]}/${RUNS} < ${minRuns}`);
  }
  if (minRateWarns.length) {
    console.log('\nMIN_RATE warnings (non-fatal):');
    for (const w of minRateWarns) console.log('  WARN  ' + w);
  }
}

main().catch((e) => {
  console.error('emergence probe failed:', e);
  process.exit(1);
});
