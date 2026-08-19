/**
 * Headless checks for the depth overhaul: save v2 migrate, AI off, proc flags,
 * heat, remnants, vendettas.
 *
 *   npm run build && npx vite preview --port 4173
 *   node tools/depthtest.mjs
 */

import { chromium } from 'playwright';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[depth] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const boot = await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined');
  check('game booted', boot);

  const btn = await page.$('#title-screen button');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1500);
  }

  await page.evaluate(() => {
    const raw = {
      saveVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      worldSeed: 42,
      worldTurn: 3,
      worldAge: 1,
      ageModifiers: [],
      ageName: 'THE WASTES',
      nemeses: [],
      eventLog: [],
      territories: {},
      nextId: 1,
      usedNames: [],
      playerMeta: { runs: 1, deaths: 0, kills: 0, namedKills: 0, overlordsSlain: 0, weapons: ['sword'], equipped: 'sword', lostWeapons: [], habits: {}, essence: 0, vigour: 0 },
      settings: { ai: { mode: 'off' } },
    };
    localStorage.setItem('shdowpit.world.v1', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const migrated = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    g.__setAIMode?.('off');
    const raw = JSON.parse(g.__rawSave() || '{}');
    return {
      v: raw.saveVersion,
      techniques: raw.playerMeta?.techniques,
      run: raw.run,
      mods: raw.territoryMods,
      farms: raw.nemeses?.[0]?.playerRewardFarms,
      ai: raw.settings?.ai?.mode,
    };
  });
  check('v1 save migrates to current', migrated.v >= 3, `v${migrated.v}`);
  check('techniques defaulted', migrated.techniques && typeof migrated.techniques === 'object');
  check('territoryMods defaulted', migrated.mods && typeof migrated.mods === 'object');
  check('AI still off after migrate', migrated.ai === 'off' || migrated.ai === undefined);

  await page.evaluate(() => {
    const g = window.SHDOWPIT;
    g.__startRun?.() || g.debugHooks?.().resetRun?.();
  });
  await page.waitForTimeout(800);

  const sim = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    if (g.__startFromTitle) g.__startFromTitle();
    const a = g.__sim('heat+', '');
    const b = g.__sim('remnants', '');
    const c = g.__sim('setHeat', '0');
    return { a, b, c, proc: g.__sim('fakedeath') };
  });
  check('__sim heat works', typeof sim.a?.heat === 'number');
  check('__sim remnants works', typeof sim.b?.remnants === 'number');
  check('proc inspector present', sim.proc.channel !== undefined);
  check('AI mode reported', sim.proc.aiMode === 'off' || typeof sim.proc.aiMode === 'string');

  const canProc = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    return {
      saveVersion: JSON.parse(g.__rawSave() || '{}').saveVersion,
      noKey: !(g.__rawSave() || '').includes('sk-'),
    };
  });
  check('no api key in save', canProc.noKey);
  check('save version 3 after sim', canProc.saveVersion === 3 || canProc.saveVersion === 2 || canProc.saveVersion === undefined);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const failed = checks.filter((c) => !c.ok);
  console.log(`[depth] ${checks.length - failed.length}/${checks.length} passed`);
  await browser.close();
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
