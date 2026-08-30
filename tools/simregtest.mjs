/**
 * Deterministic simulation regression harness (Phases 0–2).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run test:simreg
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';
import { godEval, godStart } from './godHarness.mjs';
import { PLAYTEST_URL } from './url.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(ROOT, 'tools/fixtures/sim-baseline.json');
const SEED = 424242;
const UPDATE_BASELINE = process.env.UPDATE_SIM_BASELINE === '1';

const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function rosterHash(list) {
  return list
    .map((n) => `${n.id}:${n.alive ? 1 : 0}:${n.rank}:${n.power}`)
    .sort()
    .join('|');
}

async function main() {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const god = (cmd, a, b, c) => godEval(page, cmd, a, b, c);

  await page.goto(PLAYTEST_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  await god('simregReset', String(SEED));
  await page.waitForTimeout(400);

  /* ---- Scenario A: 32 god cycles ---- */
  await godStart(page);
  await god('advance', '32');
  const godSnap = await god('simregSnapshot');
  check('god 32 cycles worldTurn advanced', godSnap.worldTurn > 1, `turn=${godSnap.worldTurn}`);
  check('god path no duplicate event ids', godSnap.duplicateEventIds === 0, String(godSnap.duplicateEventIds));

  await god('simregReset', String(SEED));
  await page.waitForTimeout(300);
  const grudge = await god('simregGrudge');
  check('grudge goalAge survives seize', grudge.ageOk === true, `goalAge=${grudge.goalAge} target=${grudge.goalTargetId}`);
  check('grudge retargets on new revenge', grudge.retargetOk === true, `goalAge=${grudge.goalAge} target=${grudge.goalTargetId}`);

  await god('simregReset', String(SEED));
  await page.waitForTimeout(300);
  const succession = await god('simregSuccession');
  check('succession no corpse-crown', succession.ok === true, JSON.stringify(succession));

  /* ---- Scenario B: pit offscreen turns ---- */
  await god('simregReset', String(SEED));
  await page.waitForTimeout(300);
  await god('pitAdvance', '5');
  const pitSnap = await god('simregSnapshot');
  check('pit simulateTurn advances worldTurn', pitSnap.worldTurn > 1, `turn=${pitSnap.worldTurn}`);
  check('pit path no duplicate event ids', pitSnap.duplicateEventIds === 0, String(pitSnap.duplicateEventIds));
  check('pit produces chronicle events', pitSnap.eventCount > 0, String(pitSnap.eventCount));

  /* ---- Scenario C: mixed (10 pit + 5 god) ---- */
  await god('simregReset', String(SEED));
  await page.waitForTimeout(300);
  await god('pitAdvance', '10');
  await godStart(page);
  await god('advance', '5');
  const mixedSnap = await god('simregSnapshot');
  check('mixed path worldTurn grows', mixedSnap.worldTurn > 10, `turn=${mixedSnap.worldTurn}`);
  check('mixed path roster stable', mixedSnap.living >= 8, `living=${mixedSnap.living}`);

  /* ---- Baseline fixture (write / compare) ---- */
  const baseline = {
    seed: SEED,
    god32: godSnap,
    pit5: pitSnap,
    mixed: mixedSnap,
  };

  if (!fs.existsSync(FIXTURE)) {
    if (!UPDATE_BASELINE) {
      console.error('[simreg] baseline missing at', FIXTURE);
      console.error('[simreg] set UPDATE_SIM_BASELINE=1 to write a new baseline');
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(baseline, null, 2));
    console.log('[simreg] wrote baseline fixture', FIXTURE);
  } else {
    const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    if (!expected.god32) {
      if (!UPDATE_BASELINE) {
        console.error('[simreg] baseline fixture is outdated (missing god32)');
        console.error('[simreg] set UPDATE_SIM_BASELINE=1 to upgrade');
        process.exit(1);
      }
      fs.writeFileSync(FIXTURE, JSON.stringify(baseline, null, 2));
      console.log('[simreg] upgraded baseline fixture', FIXTURE);
    } else {
      const god32BandOk = godSnap.worldTurn >= 20 && godSnap.worldTurn <= 40;
      const pit5TurnOk = pitSnap.worldTurn === expected.pit5?.worldTurn;
      const mixedTurnOk = mixedSnap.worldTurn === expected.mixed?.worldTurn;
      const pit5HashOk = pitSnap.rosterHash === expected.pit5?.rosterHash;
      const fixtureMismatch = !god32BandOk || !pit5TurnOk || !mixedTurnOk || !pit5HashOk;

      if (fixtureMismatch && UPDATE_BASELINE) {
        fs.writeFileSync(FIXTURE, JSON.stringify(baseline, null, 2));
        console.log('[simreg] updated baseline fixture (UPDATE_SIM_BASELINE=1)', FIXTURE);
      } else if (fixtureMismatch) {
        console.error('[simreg] baseline mismatch — set UPDATE_SIM_BASELINE=1 to update intentionally');
      }

      check('god32 worldTurn in expected band', god32BandOk, `${godSnap.worldTurn} vs ${expected.god32?.worldTurn}`);
      check('pit5 worldTurn matches baseline', pit5TurnOk, `${pitSnap.worldTurn} vs ${expected.pit5?.worldTurn}`);
      check('mixed worldTurn matches baseline', mixedTurnOk, `${mixedSnap.worldTurn} vs ${expected.mixed?.worldTurn}`);
      check('pit5 roster hash stable', pit5HashOk, `${pitSnap.rosterHash} vs ${expected.pit5?.rosterHash}`);
    }
  }

  await browser.close();

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n[simreg] ${checks.length - failed}/${checks.length} passed, errors=${errors.length}`);
  if (failed > 0 || errors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('[simreg] failed:', e);
  process.exit(2);
});
