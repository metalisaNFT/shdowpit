/**
 * Resource-leak probe: drive several run boundaries and area rebuilds, then
 * compare renderer/scene resource counts against the first stable sample.
 */
import { launchChromium } from './browser.mjs';
import { PLAYTEST_URL } from './url.mjs';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[leak] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERR', m.text().slice(0, 160));
});
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sample = () =>
  ev(() => {
    const g = window.SHDOWPIT;
    const info = g.renderer.info;
    let objects = 0;
    g.arena.scene.traverse(() => objects++);
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? -1,
      sceneObjects: objects,
      enemies: g.world.enemies.length,
      projectiles: g.combat.liveProjectiles.length,
      calls: info.render.calls,
      listeners: g.__qaListenerCount ? g.__qaListenerCount() : -1,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    };
  });
const dismiss = async (ms = 1200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await ev(() => window.SHDOWPIT.mode);
    if (m === 'power' || m === 'choice') {
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(300);
      continue;
    }
    await page.waitForTimeout(100);
  }
};

await page.goto(PLAYTEST_URL, { waitUntil: 'load' });
await ev(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
await (await page.$('#title-descend')).click();
await page.waitForTimeout(2500);
await ev(() => window.SHDOWPIT.__qaStart());
await ev(() => window.SHDOWPIT.__godMode(true));
await page.waitForTimeout(1500);
const baseline = await sample();
console.log('baseline  ', JSON.stringify(baseline));
check('listener count probe wired', baseline.listeners >= 0, String(baseline.listeners));

let last = baseline;
for (let cycle = 1; cycle <= 5; cycle++) {
  await ev(() => window.SHDOWPIT.__qaSpawnCrowd(6));
  await page.waitForTimeout(700);
  await ev(() => window.SHDOWPIT.__debug().spawnNemesis('captain'));
  await page.waitForTimeout(1400);
  await dismiss(900);
  await ev(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(900);
  await dismiss(1600);
  await ev(() => window.SHDOWPIT.__debug().resetRun());
  await page.waitForTimeout(2200);
  await dismiss(900);
  await ev(() => window.SHDOWPIT.__qaStart());
  await ev(() => window.SHDOWPIT.__godMode(true));
  await page.waitForTimeout(600);
  last = await sample();
  console.log(`cycle ${cycle}   `, JSON.stringify(last));
}

const geoDelta = last.geometries - baseline.geometries;
const progDelta = last.programs - baseline.programs;
check('geometry count stable after 5 run boundaries', geoDelta <= 12, `${baseline.geometries} -> ${last.geometries} (Δ${geoDelta})`);
check('shader program count stable after 5 run boundaries', progDelta <= 2, `${baseline.programs} -> ${last.programs} (Δ${progDelta})`);
check('event listener count stable', last.listeners <= baseline.listeners + 8, `${baseline.listeners} -> ${last.listeners}`);

await browser.close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`[leak] ${checks.length - failed}/${checks.length} checks`);
process.exit(failed ? 1 : 0);
