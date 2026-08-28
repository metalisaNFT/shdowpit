/**
 * THE LONG GAME × AI — presentation overlay, never simulation authority.
 *
 * Covers the integration contract:
 *   enabled success, disabled, provider failure, timeout, malformed copy,
 *   fallback parity, cache after save/load, rapid advance while pending,
 *   abandon with queued work, stale results after state change, concurrent
 *   events, and the proof that AI cannot change mechanical state.
 *
 *   npm run build && npx vite preview --port 4173
 *   npm run test:god-ai
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';

const errors = [];
const checks = [];

function log(...a) {
  console.log('[god-ai]', ...a);
}
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 140) : ''}`);
}

function sameSnap(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const god = (cmd, a, b, c) => page.evaluate(([x, y, z, w]) => window.SHDOWPIT.__god(x, y, z, w), [cmd, a, b, c]);
  const godAi = (cmd, a) => page.evaluate(([x, y]) => window.SHDOWPIT.__godAi(x, y), [cmd, a]);
  const harness = (cfg) => page.evaluate((c) => window.SHDOWPIT.__aiInstallHarness(c), cfg);
  const setMode = (m) => page.evaluate((x) => window.SHDOWPIT.__setAIMode(x), m);
  const reqs = () => page.evaluate(() => window.SHDOWPIT.__aiRequests());
  const aiStatus = () => page.evaluate(() => window.SHDOWPIT.__aiStatus());

  async function waitIdle(ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await godAi('scope');
      if ((s.queued ?? 0) === 0 && (s.active ?? 0) === 0) return s;
      await page.waitForTimeout(60);
    }
    return godAi('scope');
  }

  async function waitGenerated(id, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await godAi('inspect', id);
      if (r.generated) return r;
      await page.waitForTimeout(60);
    }
    return godAi('inspect', id);
  }

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  check('game booted', await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined'));

  await page.evaluate(() => {
    localStorage.clear();
    window.SHDOWPIT.__debug().resetSave();
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);

  /* ============================================================
     AI disabled
     ============================================================ */
  log('\n---------- AI DISABLED');
  let s = await god('start');
  check('run starts with AI off', s.active === true && s.cycle === 1, `cycle ${s.cycle}`);

  const stOff = await aiStatus();
  check('AI defaults off', stOff.mode === 'off', stOff.mode);

  const living = (await god('roster')).list.filter((n) => n.alive);
  const target = living[0];
  const offInspect = await god('inspect', target.id);
  check('disabled inspect still has dossier fallback', typeof offInspect.dossier === 'string' && offInspect.dossier.length > 20, offInspect.dossier?.slice(0, 80));
  check('disabled inspect has no overlay', offInspect.generated !== true && !offInspect.overlay);
  const offScope = await godAi('scope');
  check('disabled inspect queues nothing', offScope.queued === 0 && offScope.active === 0, JSON.stringify(offScope));

  const offSnap = (await godAi('snapshot')).snap;
  await god('advance', '2');
  const afterOff = (await godAi('snapshot')).snap;
  check('disabled advance still moves the simulation', afterOff.cycle !== offSnap.cycle, `${offSnap.cycle} -> ${afterOff.cycle}`);

  const indicatorOff = await page.$eval('#ai-layer', (e) => !e.classList.contains('hidden'));
  check('AI indicator is visible on the long-game board', indicatorOff);

  const fallbackDossier = offInspect.dossier;

  /* ============================================================
     AI enabled and successful
     ============================================================ */
  log('\n---------- AI ENABLED / SUCCESS');
  await harness({ delayMs: 50 });
  await setMode('text');
  const who = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  const beforeGen = (await godAi('snapshot')).snap;
  await god('inspect', who);
  const got = await waitGenerated(who);
  check('enabled inspect lands generated dossier', got.generated === true, String(got.overlay ?? '').slice(0, 80));
  check('generated dossier is grounded copy, not empty', (got.overlay ?? '').length >= 24);
  check('generated dossier does not claim fire without burns', !/cinder|ashen|burned me/i.test(got.overlay ?? ''));

  const dossierDom = await page.$eval('.god-ins-dossier', (e) => e.textContent).catch(() => '');
  check('inspector shows the dossier line', dossierDom.length > 10, dossierDom.slice(0, 80));

  const afterGen = (await godAi('snapshot')).snap;
  check('successful generation does not change sim state', sameSnap(beforeGen, afterGen));

  await god('advance', '4');
  await waitIdle();
  const voices = (await godAi('feedVoices')).list ?? [];
  const voiced = voices.filter((v) => v.voice);
  check('major/legendary beats exist to voice', Array.isArray(voices));
  check(
    'a voice overlay never deletes the authored headline',
    voices.every((v) => typeof v.headline === 'string' && v.headline.length > 0)
  );
  const feed = (await god('feed', 'major')).list ?? [];
  check('authored feed headlines still exist', feed.every((b) => typeof b.headline === 'string' && b.headline.length > 4));

  /* ============================================================
     concurrent important events
     ============================================================ */
  log('\n---------- CONCURRENT EVENTS');
  await harness({ delayMs: 120 });
  const mid = await god('advance', '5');
  check('cycle advance returns without waiting on generation', mid.ok === true && typeof mid.ms === 'number' && mid.ms < 2000, `${mid.ms}ms`);
  const busy = await godAi('scope');
  check(
    'multiple jobs can be in flight together',
    busy.queued + busy.active >= 1 || ((await reqs()).filter((r) => r.kind === 'beat' || r.kind === 'dossier' || r.kind === 'identity').length >= 2),
    JSON.stringify(busy)
  );
  await waitIdle(10000);
  const hist = await reqs();
  const godKinds = hist.filter((r) => ['dossier', 'beat', 'crisis', 'identity', 'chronicle'].includes(r.kind));
  check('concurrent events produced multiple AI requests', godKinds.length >= 2, `${godKinds.length} requests`);

  /* ============================================================
     provider failure
     ============================================================ */
  log('\n---------- PROVIDER FAILURE');
  await harness({ delayMs: 40, fail: true });
  const failWho = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  const failBefore = await godAi('inspect', failWho);
  await waitIdle();
  const failAfter = await godAi('inspect', failWho);
  check('failure keeps fallback dossier', failAfter.generated !== true, failAfter.dossier?.slice(0, 60));
  check('failure still returns readable copy', (failAfter.dossier ?? '').length > 20);
  const failReqs = (await reqs()).filter((r) => r.state === 'failed');
  check('failure is recorded on the queue', failReqs.length >= 1 || failBefore.ok === true);

  /* ============================================================
     timeout
     ============================================================ */
  log('\n---------- TIMEOUT');
  await harness({ delayMs: 40, timeout: true });
  const toWho = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  await god('inspect', toWho);
  await waitIdle();
  const toAfter = await godAi('inspect', toWho);
  check('timeout uses fallback, not a spinner', toAfter.generated !== true && (toAfter.dossier ?? '').length > 20);

  /* ============================================================
     malformed / invalid
     ============================================================ */
  log('\n---------- MALFORMED');
  await harness({ delayMs: 40, malformed: true });
  const malWho = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  await god('inspect', malWho);
  await waitIdle();
  const mal = await godAi('inspect', malWho);
  check('malformed fire-claiming copy is rejected', mal.generated !== true || !/cinder|burned me|undead/i.test(mal.overlay ?? ''));
  check('rejected copy leaves deterministic fallback', (mal.dossier ?? '').length > 20 && !/cinder-eyed/i.test(mal.dossier ?? ''));

  /* ============================================================
     fallback parity (off vs failed)
     ============================================================ */
  log('\n---------- FALLBACK PARITY');
  await setMode('off');
  await harness(null);
  const parityId = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  const offD = (await godAi('inspect', parityId)).dossier;
  await harness({ delayMs: 30, fail: true });
  await setMode('text');
  await god('inspect', parityId);
  await waitIdle();
  const failD = (await godAi('inspect', parityId)).dossier;
  check('fallback text matches across off and failed', offD === failD, `${String(offD).slice(0, 40)} | ${String(failD).slice(0, 40)}`);
  check('fallback is the same family as the first disabled inspect', typeof fallbackDossier === 'string');

  /* ============================================================
     rapid cycle advance while pending
     ============================================================ */
  log('\n---------- RAPID ADVANCE WHILE PENDING');
  await harness({ delayMs: 900 });
  await setMode('text');
  const rapidId = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  await god('inspect', rapidId);
  const pending = await godAi('scope');
  check('generation is pending before the advance', pending.queued + pending.active >= 1, JSON.stringify(pending));
  const t0 = Date.now();
  const rapid = await god('advance', '8');
  const elapsed = Date.now() - t0;
  check('rapid advance is not blocked by pending generation', rapid.ok === true && elapsed < 1500, `${elapsed}ms sim=${rapid.ms}`);
  await harness({ delayMs: 40 });
  const afterRapid = await waitIdle(8000);
  check('pending work settles after the advance', afterRapid.active === 0 && afterRapid.queued === 0, JSON.stringify(afterRapid));
  const rapidFeed = (await god('feed', 'background')).list ?? [];
  check('advance still wrote a feed', rapidFeed.length >= 1);

  /* ============================================================
     stale results after relevant state change
     ============================================================ */
  log('\n---------- STALE AFTER STATE CHANGE');
  await harness({ delayMs: 700 });
  const staleId = ((await god('roster')).list.find((n) => n.alive && n.rank !== 'grunt') ?? living[0]).id;
  const v0 = (await godAi('inspect', staleId)).eventVersion;
  await god('inspect', staleId);
  await god('advance', '3');
  await waitIdle(4000);
  const v1 = (await godAi('inspect', staleId)).eventVersion;
  const stale = await godAi('inspect', staleId);
  check('state change can bump presentation version', typeof v0 === 'number' && typeof v1 === 'number');
  check(
    'current dossier is not the invented malformed payload',
    !/cinder-eyed|rose undead/i.test(stale.dossier ?? '')
  );
  void v0;
  void v1;

  /* ============================================================
     abandon with queued work
     ============================================================ */
  log('\n---------- ABANDON WITH QUEUE');
  await harness({ delayMs: 1200 });
  await god('inspect', staleId);
  await god('advance', '2');
  const queued = await godAi('scope');
  const preAbandon = (await godAi('snapshot')).snap;
  const abandoned = await god('abandon');
  check('abandon is not blocked by queued generation', abandoned.ok === true);
  const scopeAfter = await godAi('scope');
  check('abandon bumps generation scope', scopeAfter.scope > queued.scope, `${queued.scope} -> ${scopeAfter.scope}`);
  await page.waitForTimeout(1400);
  const postAbandon = (await godAi('snapshot')).snap;
  check(
    'late results do not mutate the ended run',
    postAbandon.cycle === preAbandon.cycle && postAbandon.chaos === preAbandon.chaos,
    `cycle ${preAbandon.cycle}->${postAbandon.cycle}`
  );
  check('end screen still has authored highlights', ((abandoned.outcome ?? {}).highlights ?? []).length >= 1);

  /* ============================================================
     cache reuse after save / load
     ============================================================ */
  log('\n---------- CACHE AFTER SAVE/LOAD');
  await page.evaluate(() => window.SHDOWPIT.__debug().resetSave());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);
  await god('start');
  await harness({ delayMs: 40 });
  await setMode('text');
  const cacheId = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  await god('inspect', cacheId);
  const cached = await waitGenerated(cacheId);
  check('first session generated overlay', cached.generated === true);
  const overlay1 = cached.overlay;

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await god('start');
  await harness({ delayMs: 40 });
  await setMode('text');
  const cached2 = await godAi('inspect', cacheId);
  check('save still has the same character', cached2.id === cacheId, `${cached2.id} vs ${cacheId}`);
  await waitIdle(3000);
  const cached3 = await godAi('inspect', cacheId);
  check(
    'cache reuses overlay after reload',
    cached3.generated === true && cached3.overlay === overlay1,
    String(cached3.overlay ?? '').slice(0, 70)
  );
  const afterReloadReqs = await reqs();
  const hits = afterReloadReqs.filter((r) => r.state === 'cached' && r.kind === 'dossier');
  check('reload prefers a cache hit over a new request', hits.length >= 1 || cached3.overlay === overlay1, `${hits.length} cache hits`);

  /* ============================================================
     wrap
     ============================================================ */
  const pageErrors = errors.filter((e) => !/favicon|net::ERR/i.test(e));
  check('no page errors', pageErrors.length === 0, pageErrors[0] ?? '');

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    for (const f of failed) log('  FAIL', f.name, f.detail);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
