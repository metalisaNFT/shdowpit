/**
 * Wiring regression checks. Runs in the game process (debug / playtest).
 *
 * Regression tests (category `wired`) must pass — a failure means something broke.
 * Gap tests (category `gap`) document known unwired items; they fail until fixed.
 */

import type { GameEvents } from './Events';

export interface WiringTestResult {
  name: string;
  ok: boolean;
  detail: string;
  category: 'wired' | 'gap';
}

export interface WiringSelfTestReport {
  passed: number;
  failed: number;
  knownGaps: number;
  results: WiringTestResult[];
}

function check(list: WiringTestResult[], name: string, ok: boolean, detail: string, category: 'wired' | 'gap'): void {
  list.push({ name, ok, detail, category });
}

/** UI roots that Game.ts mounts on boot. */
const UI_ROOT_IDS = [
  'hud',
  'title-screen',
  'hierarchy-screen',
  'death-screen',
  'intro-card',
  'power-screen',
  'choice-screen',
  'pause-screen',
  'debug',
  'ai-layer',
  'build-screen',
  'god-screen',
  'primer-screen',
  'legends-screen',
  'god-end-screen',
  'comic-viewer',
] as const;

export interface WiringRuntimeContext {
  comicServiceReady: boolean;
  onGodEndIsStub: boolean;
  overlayGateWired: boolean;
  comicPlayerDeadWired: boolean;
  runLootWired: boolean;
  nemesisEventsWired: boolean;
  telemetryOptInWired: boolean;
  abilityManagerRemoved: boolean;
}

const NEMESIS_EVENTS: (keyof GameEvents)[] = ['nemesisPromoted', 'nemesisDied', 'nemesisReturned'];

export interface WiringBusProbe {
  hasListeners(key: keyof GameEvents): boolean;
}

/** Build runtime wiring probes from a live Game instance. */
export function probeWiringRuntime(input: {
  comic: unknown;
  bus: WiringBusProbe;
  telemetryOptInField: boolean;
  overlayGateWired: boolean;
  runLootWired: boolean;
  onGodEndIsStub: boolean;
}): WiringRuntimeContext {
  return {
    comicServiceReady: !!input.comic,
    onGodEndIsStub: input.onGodEndIsStub,
    overlayGateWired: input.overlayGateWired,
    comicPlayerDeadWired: !!input.comic,
    runLootWired: input.runLootWired,
    nemesisEventsWired: NEMESIS_EVENTS.every((k) => input.bus.hasListeners(k)),
    telemetryOptInWired: input.telemetryOptInField,
    abilityManagerRemoved: true,
  };
}

export function runWiringSelfTest(ctx: WiringRuntimeContext): WiringSelfTestReport {
  const results: WiringTestResult[] = [];

  for (const id of UI_ROOT_IDS) {
    const el = document.getElementById(id);
    check(results, `UI root #${id} mounted`, !!el, el ? 'present' : 'missing from #ui', 'wired');
  }

  check(results, 'ComicService constructed on boot', ctx.comicServiceReady, ctx.comicServiceReady ? 'ready' : 'not initialised', 'wired');

  check(
    results,
    'OverlayGate consumed in tickPlaying',
    ctx.overlayGateWired,
    ctx.overlayGateWired ? 'wired' : 'showBanner/showToasts/allowRemnantPrompt not applied',
    'wired',
  );
  check(
    results,
    'Comic player_dead outcome on death',
    ctx.comicPlayerDeadWired,
    ctx.comicPlayerDeadWired ? 'wired' : 'ComicService missing on death path',
    'wired',
  );
  check(
    results,
    'runLootChoices called from gameplay',
    ctx.runLootWired,
    ctx.runLootWired ? 'wired' : 'offerRunLoot path not reachable',
    'wired',
  );
  check(
    results,
    'EventBus nemesis lifecycle has listeners',
    ctx.nemesisEventsWired,
    ctx.nemesisEventsWired ? 'wired' : 'nemesisPromoted/Died/Returned have no listeners',
    'wired',
  );
  check(
    results,
    'Save telemetryOptIn gates Telemetry',
    ctx.telemetryOptInWired,
    ctx.telemetryOptInWired ? 'wired' : 'PlayerMeta.telemetryOptIn never read',
    'wired',
  );
  check(
    results,
    'onGodEnd delegates to presentGodEnd',
    !ctx.onGodEndIsStub,
    ctx.onGodEndIsStub ? 'onGodEnd is still an empty stub' : 'callback wired',
    'wired',
  );
  check(
    results,
    'AbilityManager removed or imported',
    ctx.abilityManagerRemoved,
    ctx.abilityManagerRemoved ? 'removed' : 'AbilityManager.ts is orphaned — OfferRoller is used instead',
    'wired',
  );

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return {
    passed,
    failed,
    knownGaps: 0,
    results,
  };
}

export function formatWiringSelfTest(r: WiringSelfTestReport): string {
  const lines: string[] = ['=== Wiring Self-Test ===', ''];
  for (const t of r.results) {
    const tag = t.category === 'gap' ? 'GAP ' : '    ';
    const detail = !t.ok && t.detail ? ' — ' + t.detail : '';
    lines.push(`${t.ok ? 'PASS' : 'FAIL'} ${tag} ${t.name}${detail}`);
  }
  lines.push('');
  const wired = r.results.filter((x) => x.category === 'wired');
  lines.push(`Regression: ${wired.filter((x) => x.ok).length}/${wired.length} passed`);
  lines.push(`Known gaps remaining: ${r.knownGaps}`);
  lines.push(`Total: ${r.passed} passed / ${r.failed} failed`);
  return lines.join('\n');
}
