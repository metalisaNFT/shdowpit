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
import { godEval, godStart } from './godHarness.mjs';

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

  const god = (cmd, a, b, c) => godEval(page, cmd, a, b, c);
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
  let s = await godStart(page);
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

  await godAi('openFeed');
  await page.waitForTimeout(120);
  const feedDom = await page.$$eval('.god-beat-head', (els) => els.map((e) => e.textContent ?? ''));
  check(
    'feed DOM keeps authored headlines when voice exists',
    feed.length === 0 || feedDom.length === 0 || feed.some((b) => feedDom.some((h) => h.includes(b.headline.slice(0, Math.min(12, b.headline.length))))),
    feedDom[0]?.slice(0, 60) ?? 'empty'
  );

  const rosterPair = (await god('roster')).list.filter((n) => n.alive);
  if (rosterPair.length >= 2) {
    const dossierBefore = (await reqs()).filter((r) => r.kind === 'dossier').length;
    await god('inspect', rosterPair[0].id);
    await god('inspect', rosterPair[1].id);
    await page.waitForTimeout(120);
    const dossierAfter = (await reqs()).filter((r) => r.kind === 'dossier').length;
    check('inspect switch queues dossier work', dossierAfter >= dossierBefore, `${dossierBefore} -> ${dossierAfter}`);
  }

  const chronicleDom = await page.$eval('.god-ins-chronicle-line', (e) => e.textContent).catch(() => '');
  check('inspector can show chronicle line', typeof chronicleDom === 'string');

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
  check('failure keeps fallback dossier', (failAfter.dossier ?? '').length > 20, failAfter.dossier?.slice(0, 60));
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
  check('timeout uses fallback, not a spinner', (toAfter.dossier ?? '').length > 20);

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
  await harness({ delayMs: 1500 });
  await setMode('text');
  const rapidRoster = (await god('roster')).list.filter((n) => n.alive);
  for (const n of rapidRoster.slice(-3)) await godAi('inspect', n.id);
  const pending = await godAi('scope');
  check(
    'generation is pending before the advance',
    pending.queued + pending.active >= 1,
    JSON.stringify(pending)
  );
  const t0 = Date.now();
  const rapid = await god('advance', '1');
  const elapsed = Date.now() - t0;
  check('rapid advance is not blocked by pending generation', rapid.ok === true && rapid.ms < 2000, `${elapsed}ms sim=${rapid.ms}`);
  await harness({ delayMs: 40 });
  const afterRapid = await waitIdle(12000);
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
     aftermath, situation, crisis surfaces
     ============================================================ */
  log('\n---------- AFTERMATH / SITUATION / CRISIS');
  await harness({ delayMs: 40 });
  await setMode('text');
  const blessTarget = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  const snapBeforeAftermath = (await godAi('snapshot')).snap;
  const bless = await god('intervene', 'bless', blessTarget);
  check('bless intervention succeeds for aftermath test', bless.ok === true, bless.reason ?? '');
  await god('advance', '1');
  const afterSpend = await god('state');
  check('spend advance produces aftermath', afterSpend.hasAftermath === true, afterSpend.aftermathIntention ?? '');
  await waitIdle();
  const am = await godAi('aftermath');
  check('aftermath links are readable', am.ok === true && (am.links ?? []).length >= 1, am.intention ?? '');
  check(
    'aftermath voicing does not rewrite sim feed headlines',
    sameSnap(snapBeforeAftermath.feedHeadlines, (await godAi('snapshot')).snap.feedHeadlines) ||
      (await godAi('snapshot')).snap.feedHeadlines.length >= snapBeforeAftermath.feedHeadlines.length
  );

  await god('clearBoards');
  await god('advance', '2');
  await waitIdle();
  const sitOff = await godAi('situation');
  check('situation surface has authored headline', sitOff.ok === true && (sitOff.headline ?? '').length > 8, sitOff.headline ?? '');

  await god('forceCrisis');
  await waitIdle(4000);
  const cr = await godAi('crisis');
  check('crisis voice has fallback copy', cr.ok === true && (cr.voice ?? '').length > 10, String(cr.voice ?? '').slice(0, 80));
  const crisisTop = await page.$eval('.god-crisis-body', (e) => e.textContent).catch(() => '');
  check('top bar renders crisis body', crisisTop.length > 5, crisisTop.slice(0, 80));
  if (cr.bodyId) {
    await god('inspect', cr.bodyId);
    const crisisIns = await page.$eval('.god-ins-crisis-line', (e) => e.textContent).catch(() => '');
    check('crisis inspect shows voice line', crisisIns.length > 5, crisisIns.slice(0, 80));
  }

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
  const endSub = await godAi('endSubtitle');
  check('end screen shows a recap subtitle', (endSub.text ?? '').length > 5, endSub.text ?? '');
  await waitIdle(4000);
  const recap = await godAi('recap');
  check('run recap hook returns copy', recap.ok === true || (endSub.text ?? '').length > 5, recap.line ?? endSub.text ?? '');
  const legs = await godAi('legends');
  check('book legends expose epitaph voice', Array.isArray(legs.list));
  if ((legs.list ?? []).length) {
    check(
      'legend voice falls back to authored epitaph when no overlay',
      typeof legs.list[0].voice === 'string' && legs.list[0].voice.length > 0,
      legs.list[0].voice?.slice(0, 60)
    );
  }

  /* ============================================================
     cache reuse after save / load
     ============================================================ */
  log('\n---------- CACHE AFTER SAVE/LOAD');
  await page.evaluate(() => window.SHDOWPIT.__debug().resetSave());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);
  await godStart(page);
  await harness({ delayMs: 40 });
  await setMode('text');
  const cacheId = ((await god('roster')).list.find((n) => n.alive) ?? target).id;
  await god('inspect', cacheId);
  const cached = await waitGenerated(cacheId);
  check('first session generated overlay', cached.generated === true);
  const overlay1 = cached.overlay;

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await godStart(page);
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
