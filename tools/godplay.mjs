/**
 * One-shot Long Game play pass: click the real UI, screenshot, report feel.
 * Not a pass/fail harness — observation for the polish pass.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:5173/?quality=low';
const SHOTS = path.join(ROOT, 'god-play-shots');

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const notes = [];
  const note = (s) => {
    notes.push(s);
    console.log('[play]', s);
  };

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  await page.evaluate(() => window.SHDOWPIT.__debug().resetSave());
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);

  const titleBtns = await page.$$eval('#title-screen button', (els) => els.map((e) => e.textContent.trim()));
  note(`title buttons: ${JSON.stringify(titleBtns)}`);
  await page.screenshot({ path: path.join(SHOTS, '01-title.png') });

  const primary = page.locator('#title-screen button').filter({ hasText: /LONG GAME/ }).first();
  await primary.click();
  await page.waitForTimeout(800);

  const godVisible = await page.$eval('#god-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
  note(`god screen visible: ${godVisible}`);

  const rail = await page.$('#god-teach');
  note(`teaching rail in DOM: ${!!rail}  hidden=${rail ? await rail.evaluate((e) => e.classList.contains('hidden')) : 'n/a'}`);

  const why = await page.$('.god-why, button:has-text("WHY")');
  note(`WHY control present: ${!!why}`);

  const advances = await page.$$eval('#god-screen button', (els) =>
    els.filter((e) => /ADVANCE|DO NOTHING|×5|×20|LET IT RUN/.test(e.textContent || '')).map((e) => e.textContent.trim())
  );
  note(`advance-like buttons: ${JSON.stringify(advances)}`);

  const head = await page.$eval('#god-screen', (e) => e.innerText.slice(0, 900)).catch(() => '');
  note(`opening copy (trim): ${head.replace(/\s+/g, ' ').slice(0, 500)}`);
  await page.screenshot({ path: path.join(SHOTS, '02-opening.png') });

  const sit = page.locator('.god-sit').first();
  if (await sit.count()) {
    await sit.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(SHOTS, '03-after-sit.png') });

  const ints = await page.$$eval('.god-int-name', (els) => els.map((e) => e.textContent.trim()));
  note(`visible interventions: ${JSON.stringify(ints)}`);

  const bless = page.locator('.god-int').filter({ hasText: /BLESS/ }).first();
  if (await bless.count()) {
    await bless.click();
    await page.waitForTimeout(400);
    const overlay = await page.$eval('.god-overlay', (e) => !e.classList.contains('hidden')).catch(() => false);
    const overlayText = overlay
      ? await page.$eval('.god-overlay', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 400))
      : '';
    note(`confirm overlay after BLESS click: ${overlay}  ${overlayText.slice(0, 220)}`);
    await page.screenshot({ path: path.join(SHOTS, '04-confirm.png') });
    const write = page.locator('.god-overlay button').filter({ hasText: /WRITE THE CONDITION/ }).first();
    if (await write.count()) await write.click();
    await page.waitForTimeout(500);
  }

  const afterSpend = await page.$$eval('#god-screen button', (els) =>
    els.filter((e) => /ADVANCE|DO NOTHING|×5|×20/.test(e.textContent || '')).map((e) => e.textContent.trim())
  );
  note(`after spend, advance-like: ${JSON.stringify(afterSpend)}`);
  await page.screenshot({ path: path.join(SHOTS, '05-after-spend.png') });

  const colAdvance = page.locator('.god-interfere button').filter({ hasText: /^ADVANCE/ }).first();
  if (await colAdvance.count()) await colAdvance.click();
  else await page.locator('#god-screen button').filter({ hasText: /^ADVANCE/ }).first().click();
  await page.waitForTimeout(700);

  const aftermath = await page.$eval('.god-overlay', (e) => !e.classList.contains('hidden')).catch(() => false);
  const aftermathText = aftermath
    ? await page.$eval('.god-overlay', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 700))
    : '';
  note(`aftermath overlay: ${aftermath}`);
  note(`aftermath text: ${aftermathText.slice(0, 500)}`);
  await page.screenshot({ path: path.join(SHOTS, '06-aftermath.png') });

  const cont = page.locator('.god-overlay button').filter({ hasText: /CONTINUE/ }).first();
  if (await cont.count()) {
    await cont.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(SHOTS, '07-after-continue.png') });

  const beats = await page.$$eval('.god-beat-head', (els) => els.map((e) => e.textContent.trim()).slice(0, 8));
  note(`visible beat headlines: ${JSON.stringify(beats)}`);

  if (await page.locator('.god-beat-head').count()) {
    await page.locator('.god-beat-head').first().click();
    await page.waitForTimeout(300);
  }
  const whyAfter = await page.$$eval('#god-screen button', (els) =>
    els.filter((e) => /^WHY$/.test(e.textContent.trim())).map((e) => e.textContent.trim())
  );
  note(`WHY buttons after expanding a beat: ${JSON.stringify(whyAfter)}`);
  await page.screenshot({ path: path.join(SHOTS, '08-beat-open.png') });

  const x5 = page.locator('#god-screen button').filter({ hasText: '×5' }).first();
  note(`×5 present: ${await x5.count() > 0}`);
  if (await x5.count()) {
    await x5.click();
    await page.waitForTimeout(800);
    const afterX5 = await page.$eval('.god-overlay', (e) => !e.classList.contains('hidden')).catch(() => false);
    const x5text = afterX5
      ? await page.$eval('.god-overlay', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 400))
      : '';
    note(`after ×5 overlay: ${afterX5}  ${x5text.slice(0, 280)}`);
    await page.screenshot({ path: path.join(SHOTS, '09-x5.png') });
    const c2 = page.locator('.god-overlay button').filter({ hasText: /CONTINUE/ }).first();
    if (await c2.count()) await c2.click();
    await page.waitForTimeout(400);
  }

  const st = await page.evaluate(() => window.SHDOWPIT.__god('state'));
  note(`state after play: cycle=${st.cycle} influence=${st.influence} chaos=${st.chaos} openingDone=${st.openingDone} aftermath=${st.hasAftermath} intention=${st.aftermathIntention}`);

  fs.writeFileSync(path.join(SHOTS, 'notes.txt'), notes.join('\n'));
  await browser.close();
  console.log('\nnotes in', SHOTS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
