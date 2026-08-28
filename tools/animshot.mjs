/** Visual smoke: screenshot key animation moments. node tools/animshot.mjs */
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
fs.mkdirSync('animshot', { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200));
});
await page.goto(URL_BASE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.waitForTimeout(2500);
await (await page.$('#title-descend')).click();
await page.waitForTimeout(1200);
await page.evaluate(() => window.SHDOWPIT.__qaStart());
await page.waitForTimeout(600);

const shot = (n) => page.screenshot({ path: `animshot/${n}.png` });
const ev = (fn, ...a) => page.evaluate(fn, ...a);

// 1: idle
await shot('01_idle');

// 2: running toward camera-forward
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await shot('02_run');
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);

// 3: light attack frozen mid-active
await ev(() => window.SHDOWPIT.__debug().setTimeScale(0.12));
await page.mouse.click(640, 360); // light attack
await page.waitForTimeout(1400);
await shot('03_attack_slow');
const anim1 = await ev(() => window.SHDOWPIT.__animState());
console.log('during attack:', JSON.stringify(anim1.player));
await ev(() => window.SHDOWPIT.__debug().setTimeScale(1));
await page.waitForTimeout(800);

// 4: spawn the three archetypes
const spawned = await ev(() => window.SHDOWPIT.__qaSpawnArchetypes());
console.log('spawned', spawned);
await page.waitForTimeout(1200);
await shot('04_enemies');

// 5: force a slam, catch the telegraph then the impact
const forced = await ev(() => window.SHDOWPIT.__qaForceAttack('slam'));
console.log('forced', forced);
await ev(() => window.SHDOWPIT.__debug().setTimeScale(0.3));
await page.waitForTimeout(900);
await shot('05_slam_telegraph');
await page.waitForTimeout(1800);
await shot('06_slam_land');
await ev(() => window.SHDOWPIT.__debug().setTimeScale(1));

// 6: facing + anim state dump
const facing = await ev(() => window.SHDOWPIT.__qaFacing());
console.log('facing:', JSON.stringify(facing));
const anim2 = await ev(() => window.SHDOWPIT.__animState());
console.log('anim:', JSON.stringify(anim2));

// 7: die for the death anim
await ev(() => window.SHDOWPIT.__forceDeath());
await page.waitForTimeout(700);
await shot('07_death');

await browser.close();
console.log('done');
