/**
 * Observation transcript of THE LONG GAME — not a test. Prints the board,
 * every notable+ beat per cycle, and decision breakdowns so a designer can
 * read what the simulation actually produces.
 *
 *   node tools/observe.mjs [cycles=32] [mode=quiet|greedy]
 */
import { launchChromium } from './browser.mjs';
import { godEval, godStart } from './godHarness.mjs';

const CYCLES = parseInt(process.argv[2] ?? '32', 10);
const MODE = process.argv[3] ?? 'quiet';
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL_BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => window.SHDOWPIT.__debug().resetSave());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => window.SHDOWPIT.__qaStart?.());
const st = await godStart(page);
console.log('START', JSON.stringify({ living: st.living, factions: st.factions, influence: st.influence }));

const roster = await godEval(page, 'roster');
console.log('\n=== ROSTER ===');
for (const n of roster.list.filter((n) => n.alive)) {
  console.log(`${n.name.padEnd(12)} ${n.title.padEnd(14)} ${n.rank.padEnd(8)} pw${String(n.power).padStart(4)} ${n.territory.padEnd(8)} amb${n.ambition} conf${n.confidence} loy${n.loyalty} goal=${n.goal}${n.goalTarget ? '>' + n.goalTarget : ''} fac=${n.faction} master=${n.master ?? '-'} allies=${n.allies}`);
}

let lastFeed = 0;
for (let c = 1; c <= CYCLES; c++) {
  const sits = await godEval(page, 'situations');
  console.log(`\n=== CYCLE ${c} — BOARD (${sits.list.length}) ===`);
  for (const s of sits.list.slice(0, 6)) console.log(`  [${s.kind}] u${s.urgency} ${s.headline}  → ${s.suggest.join('/')}`);

  if (MODE === 'greedy') {
    const ints = await godEval(page, 'interventions');
    const state = await godEval(page, 'state');
    // spend on the top situation's first suggestion when affordable
    const top = sits.list[0];
    if (top && top.actors[0]) {
      const pick = ints.list.find((i) => top.suggest.includes(i.id) && i.affordable && (i.targeting === 'nemesis' || i.targeting === 'pair'));
      if (pick) {
        const b = pick.targeting === 'pair' ? top.actors[1] ?? null : null;
        if (pick.targeting !== 'pair' || b) {
          const reading = await godEval(page, 'reading', pick.id, top.actors[0], b);
          if (reading.ok) console.log(`  READING ${pick.name}: ${reading.lines.join(' | ')}  [${reading.responders.map((r) => r.name + ':' + r.label).join(', ')}]`);
          const r = await godEval(page, 'intervene', pick.id, top.actors[0], b);
          console.log(`  SPEND ${pick.name} on ${top.actors[0]}${b ? '+' + b : ''} → ${r.ok ? r.headline : r.reason} (inf ${state.influence}→${r.influence}, chaos ${Math.round(r.chaos)})`);
        }
      }
    }
  }

  const before = (await godEval(page, 'state'));
  const r = await godEval(page, 'advance', '1');
  const feed = await godEval(page, 'feed', 'background');
  const fresh = feed.list.filter((b) => b.cycle === c);
  const counts = {};
  for (const b of fresh) counts[b.priority] = (counts[b.priority] ?? 0) + 1;
  console.log(`  -- advanced: living ${before.living}→${r.living}, chaos ${Math.round(r.chaos)}, inf ${r.influence}, act ${r.act}, crisis ${r.crisis ? r.crisis.kind + ':' + r.crisis.body + ' p' + r.crisis.power : '-'}  beats ${JSON.stringify(counts)}`);
  for (const b of fresh.filter((b) => b.priority !== 'background')) {
    console.log(`  ${b.priority[0].toUpperCase()} ${b.kind.padEnd(10)} ${b.headline}`);
  }
  const dec = await godEval(page, 'decisions');
  const acts = {};
  for (const d of dec.list) acts[d.chosen] = (acts[d.chosen] ?? 0) + 1;
  console.log(`  decisions: ${JSON.stringify(acts)}`);
  if (c === 1 || c === 10) {
    for (const d of dec.list.slice(0, 4)) {
      console.log(`    ${d.actor}: ${d.chosen} ${d.total} parts=${JSON.stringify(d.parts)} alts=${d.considered.slice(0, 3).map((x) => x.action + (x.target ? '→' + x.target : '') + ':' + x.total).join(' | ')}`);
    }
  }
  if (r.ended) {
    console.log('\n=== ENDED ===', JSON.stringify(r.outcome, null, 1).slice(0, 2500));
    break;
  }
}
const roster2 = await godEval(page, 'roster');
console.log('\n=== FINAL ROSTER ===');
for (const n of roster2.list) {
  console.log(`${n.alive ? ' ' : 'X'} ${n.name.padEnd(12)} ${n.title.padEnd(14)} ${n.rank.padEnd(8)} pw${String(n.power).padStart(4)} k${n.kills} w${n.wins}/l${n.losses} rev=[${n.revenge.join(',')}] deeds=${n.deeds.slice(-3).join(' / ')}`);
}
await browser.close();
