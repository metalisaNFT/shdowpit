/**
 * Static wiring audit — scans source for known integration gaps.
 *
 *   node tools/wiringaudit.mjs
 *
 * Regression checks must pass. Gap checks are informational (expected fail until fixed).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src');

const checks = [];

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(SRC, rel));
}

function grepFiles(pattern, dir = SRC, skip = new Set(['core/WiringSelfTest.ts'])) {
  const hits = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== 'node_modules') hits.push(...grepFiles(pattern, p, skip));
    else if (ent.isFile() && ent.name.endsWith('.ts')) {
      const rel = path.relative(SRC, p).replace(/\\/g, '/');
      if (skip.has(rel)) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (pattern.test(text)) hits.push(rel);
    }
  }
  return hits;
}

function fieldUsed(field, exclude = []) {
  const skip = new Set(['core/WiringSelfTest.ts', ...exclude]);
  const pat = new RegExp(`\\.${field}\\b|${field}\\s*[:?]|${field}\\s*=`);
  return grepFiles(pat, SRC, skip).filter((f) => !exclude.includes(f));
}

function check(name, ok, detail = '', category = 'wired') {
  checks.push({ name, ok, detail, category });
  const tag = category === 'gap' ? 'GAP ' : '    ';
  const suffix = !ok && detail ? ' — ' + detail : '';
  console.log(`[wiring] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${suffix}`);
}

function main() {
  const game = read('core/Game.ts');
  const lazyBundles = exists('core/LazyBundles.ts') ? read('core/LazyBundles.ts') : '';
  const events = read('core/Events.ts');

  /* Regression — must stay true */

  const uiScreens = [
    { label: 'new HUD()', ok: game.includes('new HUD()') },
    { label: 'new TitleScreen()', ok: game.includes('new TitleScreen()') },
    { label: 'new GodScreen()', ok: /new\s+(L\.)?GodScreen\s*\(/.test(game + lazyBundles) },
    { label: 'new ComicViewer()', ok: /new\s+(pipe\.)?ComicViewer\s*\(/.test(game + lazyBundles) },
    { label: 'new BuildScreen()', ok: game.includes('new BuildScreen()') },
    { label: 'new LegendsScreen()', ok: /new\s+(L\.)?LegendsScreen\s*\(/.test(game + lazyBundles) },
  ];
  for (const s of uiScreens) {
    check(`Game mounts ${s.label}`, s.ok, '', 'wired');
  }

  check('worldEvent listener in Game', /bus\.on\(['"]worldEvent['"]/.test(game), '', 'wired');
  check('ComicService imported in Game', game.includes('ComicService'), '', 'wired');
  check('decideOverlays called in tickPlaying', game.includes('decideOverlays('), '', 'wired');

  check(
    'AbilityManager removed or imported',
    !exists('abilities/AbilityManager.ts') || grepFiles(/from ['"].*AbilityManager['"]/).length > 0,
    exists('abilities/AbilityManager.ts') ? 'orphaned file remains' : 'removed',
    'wired',
  );

  check(
    'runLootChoices called from src',
    grepFiles(/runLootChoices\s*\(/).some((f) => f !== 'progress/Progression.ts'),
    'only defined in Progression.ts',
    'wired',
  );

  check(
    'OverlayGate consumed in Game',
    /overlay\.showBanner/.test(game) &&
      /overlay\.showToasts/.test(game) &&
      /overlay\.allowRemnantPrompt/.test(game),
    'showBanner/showToasts/allowRemnantPrompt',
    'wired',
  );

  check(
    'Comic player_dead onNamedOutcome in death flow',
    /onNamedOutcome\([^)]*['"]player_dead['"]/.test(game),
    'death path fires player_dead outcome',
    'wired',
  );

  for (const ev of ['nemesisPromoted', 'nemesisDied', 'nemesisReturned']) {
    const emitted = grepFiles(new RegExp(`emit\\(['"]${ev}['"]`)).length > 0;
    const listened = grepFiles(new RegExp(`on\\(['"]${ev}['"]`)).length > 0;
    check(`EventBus ${ev} has listener`, emitted && listened, emitted ? 'emitted, no listener' : 'not emitted', 'wired');
  }

  check(
    'telemetryOptIn read outside SaveSystem',
    fieldUsed('telemetryOptIn', ['core/SaveSystem.ts']).length > 0,
    'save field never gates Telemetry',
    'wired',
  );

  check(
    'EffectTrigger dispatched in combat',
    grepFiles(/effects\.trigger\s*\(/).some((f) => f === 'combat/CombatSystem.ts'),
    'EffectBus.trigger never called from CombatSystem',
    'wired',
  );

  check(
    'onGodEnd delegates to presentGodEnd',
    !/private onGodEnd\([^)]*\):\s*void\s*\{\s*void outcome;\s*\}/.test(game) &&
      /presentGodEnd\(outcome\)/.test(game),
    'empty callback registered as GodRun onEnd hook',
    'wired',
  );

  /* Known gaps — expected fail until fixed */

  check(
    'bus.emit sfx anywhere',
    !/bus\.on\(['"]sfx['"]/.test(game) || grepFiles(/emit\(['"]sfx['"]/).length > 0,
    'sfx listener without emitter',
    'gap',
  );

  for (const dead of ['toast', 'rosterChanged', 'saveRequested', 'hudDirty']) {
    const inSchema = events.includes(`${dead}:`);
    const used = grepFiles(new RegExp(`(emit|on)\\(['"]${dead}['"]`)).length > 0;
    check(`EventBus ${dead} removed or used`, !inSchema || used, inSchema ? 'defined but unused' : 'removed', 'gap');
  }

  check(
    'unlockedStarting read outside SaveSystem',
    fieldUsed('unlockedStarting', ['core/SaveSystem.ts']).length > 0,
    'save field never used in gameplay',
    'gap',
  );
  check(
    'progress.favorites read outside Progression migrate',
    fieldUsed('favorites', ['progress/Types.ts', 'progress/Progression.ts']).length > 0,
    'save field never used in UI',
    'gap',
  );

  check(
    'comic/index barrel removed or imported',
    !exists('comic/index.ts') ||
      grepFiles(/from ['"][^'"]*\/comic['"]/).length > 0 ||
      grepFiles(/from ['"][^'"]*\/comic\/index['"]/).length > 0,
    exists('comic/index.ts') ? 'barrel unused' : 'removed',
    'gap',
  );

  for (const fn of ['filterFeed', 'legendHome', 'describeFaction', 'unlockName', 'nodePreview']) {
    const defs = grepFiles(new RegExp(`export function ${fn}`));
    const uses = grepFiles(new RegExp(`\\b${fn}\\s*\\(`)).filter((f) => !defs.includes(f));
    check(`${fn} has consumer`, uses.length > 0, uses.length ? uses.join(', ') : 'exported, never imported', 'gap');
  }

  const regression = checks.filter((c) => c.category === 'wired');
  const gaps = checks.filter((c) => c.category === 'gap' && !c.ok);
  const regFailed = regression.filter((c) => !c.ok).length;

  console.log('');
  console.log(`[wiring] Regression: ${regression.length - regFailed}/${regression.length} passed`);
  console.log(`[wiring] Known gaps: ${gaps.length} (informational until fixed)`);

  if (regFailed) {
    console.error('[wiring] REGRESSION FAILURES — wiring broke');
    process.exit(1);
  }
  process.exit(0);
}

main();
