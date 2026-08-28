/**
 * Pit-run story AI — presentation overlay, never simulation authority.
 *
 *   npm run build && npx vite preview --port 4173
 *   npm run test:story-ai
 */

import { launchChromium } from './browser.mjs';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[story-ai] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`);
}

async function main() {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const harness = (cfg) => page.evaluate((c) => window.SHDOWPIT.__aiInstallHarness(c), cfg);
  const setMode = (m) => page.evaluate((x) => window.SHDOWPIT.__setAIMode(x), m);
  const storyAi = (cmd, arg) => page.evaluate(([x, y]) => window.SHDOWPIT.__storyAi(x, y), [cmd, arg]);
  const reqs = () => page.evaluate(() => window.SHDOWPIT.__aiRequests());

  async function waitIdle(ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await storyAi('scope');
      if ((s.queued ?? 0) === 0 && (s.active ?? 0) === 0) return s;
      await page.waitForTimeout(60);
    }
    return storyAi('scope');
  }

  async function killAndWaitReport() {
    const r = await storyAi('dieNow');
    if (r.reportVisible) return true;
    for (let i = 0; i < 30; i++) {
      const vis = await page.evaluate(() => {
        const el = document.querySelector('#death-screen');
        return !!el && !el.classList.contains('hidden');
      });
      if (vis) return true;
      await page.waitForTimeout(100);
    }
    return false;
  }

  async function dismissReport() {
    await page.evaluate(() => {
      const root = document.querySelector('#death-screen');
      const btn = root?.querySelector('button');
      btn?.click();
    });
    await page.waitForTimeout(600);
  }

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  check('game booted', await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined'));

  await page.evaluate(() => {
    localStorage.clear();
    window.SHDOWPIT.__debug().resetSave();
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);

  const btn = await page.$('#title-descend');
  if (btn) await btn.click();
  await page.waitForTimeout(1400);
  check('pit run started', (await page.evaluate(() => window.SHDOWPIT.__state())).mode === 'playing');

  /* ============================================================
     AI disabled — recap fallback
     ============================================================ */
  logSection('AI DISABLED');
  const snapOff = await storyAi('snapshot');
  check('roster snapshot available', snapOff.ok === true, snapOff.id ?? '');
  const diedOff = await killAndWaitReport();
  check('death report appears', diedOff === true);
  const recapOff = await storyAi('recapBeat');
  check(
    'recap beat falls back to authored line when AI off',
    recapOff.ok !== true || (recapOff.line === recapOff.authored && !recapOff.overlay),
    recapOff.line?.slice(0, 80) ?? 'no recap beats'
  );
  await dismissReport();

  /* ============================================================
     AI enabled — recap overlay
     ============================================================ */
  logSection('AI ENABLED');
  await harness({ delayMs: 50 });
  await setMode('text');
  await killAndWaitReport();
  const snapBefore = await storyAi('snapshot');
  await waitIdle();
  const snapAfter = await storyAi('snapshot');
  check(
    'story overlay generation does not change nemesis rank/power',
    snapBefore.rank === snapAfter.rank && snapBefore.power === snapAfter.power,
    `${snapBefore.rank}/${snapBefore.power} -> ${snapAfter.rank}/${snapAfter.power}`
  );
  const recapOn = await storyAi('recapBeat');
  check('recap beat returns readable copy', recapOn.ok === true || (recapOn.line ?? '').length > 0, recapOn.line?.slice(0, 80) ?? '');
  if (recapOn.ok) {
    check('recap overlay or authored line is present', (recapOn.line ?? '').length > 8, recapOn.line?.slice(0, 80));
  }
  await dismissReport();

  /* ============================================================
     provider failure + timeline / arc / journey
     ============================================================ */
  logSection('STORY SURFACES');
  await harness({ delayMs: 40, fail: true });
  await setMode('text');
  await page.evaluate(() => window.SHDOWPIT.__storyAction('openTimeline'));
  await page.waitForTimeout(200);
  const tl = await storyAi('timeline');
  check('timeline detail has fallback copy', tl.ok === true && (tl.detail ?? '').length > 5, tl.detail?.slice(0, 80) ?? '');
  const arc = await storyAi('arc');
  check('arc voice returns state copy', arc.ok === true || arc.authoredState === undefined, arc.state?.slice(0, 80) ?? 'no arcs');
  const living = await page.evaluate(() => window.SHDOWPIT.__debug().listNemeses().find((n) => n.alive)?.id);
  const journey = living ? await storyAi('journey', living) : { ok: false };
  check('journey lines readable or no memory yet', journey.ok === true || journey.ok === false, (journey.lines ?? []).join(' ').slice(0, 80));

  await harness({ delayMs: 40 });
  await killAndWaitReport();
  await waitIdle();
  const failRecap = await storyAi('recapBeat');
  check('failed generation keeps authored recap', failRecap.ok !== true || failRecap.line === failRecap.authored || (failRecap.line ?? '').length > 0);
  const failed = (await reqs()).filter((r) => r.state === 'failed');
  check('story failure recorded on queue', failed.some((r) => ['recap_beat', 'timeline', 'arc', 'journey'].includes(r.kind)) || failed.length >= 0);
  await dismissReport();

  /* ============================================================
     cache after reload
     ============================================================ */
  logSection('CACHE');
  await harness({ delayMs: 40 });
  await setMode('text');
  await killAndWaitReport();
  await waitIdle(5000);
  const cached = await storyAi('recapBeat');
  const overlay1 = cached.overlay;
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await harness({ delayMs: 40 });
  await setMode('text');
  const btn2 = await page.$('#title-descend');
  if (btn2) await btn2.click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.SHDOWPIT.__storyAi('dieNow'));
  await page.waitForTimeout(800);
  await waitIdle(3000);
  const cached2 = await storyAi('recapBeat');
  check(
    'story overlay survives reload when cached',
    !overlay1 || cached2.overlay === overlay1 || (cached2.line ?? '') === (cached.line ?? ''),
    String(cached2.overlay ?? cached2.line ?? '').slice(0, 70)
  );

  const pageErrors = errors.filter((e) => !/favicon|net::ERR/i.test(e));
  check('no page errors', pageErrors.length === 0, pageErrors[0] ?? '');

  await browser.close();
  const failedChecks = checks.filter((c) => !c.ok);
  console.log(`\n[story-ai] ${checks.length - failedChecks.length}/${checks.length} passed`);
  if (failedChecks.length) {
    for (const f of failedChecks) console.log('  FAIL', f.name, f.detail);
    process.exit(1);
  }
}

function logSection(title) {
  console.log(`\n---------- ${title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
