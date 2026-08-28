/**
 * Resource-leak probe: drive several run boundaries and area rebuilds, then
 * compare renderer/scene resource counts against the first stable sample.
 */
import { launchChromium } from './browser.mjs';
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR', m.text().slice(0, 160)); });
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sample = () => ev(() => {
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
    if (m === 'power' || m === 'choice') { await page.keyboard.press('Digit1'); await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(100);
  }
};
await page.goto('http://localhost:4173/?quality=low', { waitUntil: 'load' });
await ev(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
await (await page.$('#title-descend')).click();
await page.waitForTimeout(2500);
await ev(() => window.SHDOWPIT.__qaStart());
await ev(() => window.SHDOWPIT.__godMode(true));
await page.waitForTimeout(1500);
console.log('baseline  ', JSON.stringify(await sample()));

for (let cycle = 1; cycle <= 5; cycle++) {
  // spawn a crowd, kill it, spawn named, kill, force a run boundary
  await ev(() => window.SHDOWPIT.__qaSpawnCrowd(6));
  await page.waitForTimeout(700);
  await ev(() => window.SHDOWPIT.__debug().spawnNemesis('captain'));
  await page.waitForTimeout(1400);
  await dismiss(900);
  await ev(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(900);
  await dismiss(1600);
  // run boundary
  await ev(() => window.SHDOWPIT.__debug().resetRun());
  await page.waitForTimeout(2200);
  await dismiss(900);
  await ev(() => window.SHDOWPIT.__qaStart());
  await ev(() => window.SHDOWPIT.__godMode(true));
  await page.waitForTimeout(600);
  console.log(`cycle ${cycle}   `, JSON.stringify(await sample()));
}
await browser.close();
