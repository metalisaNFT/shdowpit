/**
 * Wiring regression checks. Runs in the game process (debug / playtest).
 *
 * Regression tests (category `wired`) must pass — a failure means something broke.
 * Gap tests (category `gap`) document known unwired items; they fail until fixed.
 */

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
  onGodEndIsStub?: boolean;
  overlayGateWired?: boolean;
  comicPlayerDeadWired?: boolean;
  runLootWired?: boolean;
  nemesisEventsWired?: boolean;
  telemetryOptInWired?: boolean;
  abilityManagerRemoved?: boolean;
}

export function runWiringSelfTest(ctx?: Partial<WiringRuntimeContext>): WiringSelfTestReport {
  const results: WiringTestResult[] = [];
  const comicReady = ctx?.comicServiceReady ?? false;
  const onGodEndStub = ctx?.onGodEndIsStub ?? true;
  const overlayGateWired = ctx?.overlayGateWired ?? false;
  const comicPlayerDeadWired = ctx?.comicPlayerDeadWired ?? false;
  const runLootWired = ctx?.runLootWired ?? false;
  const nemesisEventsWired = ctx?.nemesisEventsWired ?? false;
  const telemetryOptInWired = ctx?.telemetryOptInWired ?? false;
  const abilityManagerRemoved = ctx?.abilityManagerRemoved ?? false;

  for (const id of UI_ROOT_IDS) {
    const el = document.getElementById(id);
    check(results, `UI root #${id} mounted`, !!el, el ? 'present' : 'missing from #ui', 'wired');
  }

  check(results, 'ComicService constructed on boot', comicReady, comicReady ? 'ready' : 'not initialised', 'wired');

  check(
    results,
    'OverlayGate.showBanner consumed in tickPlaying',
    overlayGateWired,
    overlayGateWired ? 'wired' : 'Computed in OverlayGate.ts but Game.ts never reads overlay.showBanner',
    'gap'
  );
  check(
    results,
    'OverlayGate.showToasts consumed in tickPlaying',
    overlayGateWired,
    overlayGateWired ? 'wired' : 'Computed in OverlayGate.ts but Game.ts never reads overlay.showToasts',
    'gap'
  );
  check(
    results,
    'OverlayGate.allowRemnantPrompt consumed in tickPlaying',
    overlayGateWired,
    overlayGateWired ? 'wired' : 'Computed in OverlayGate.ts but Game.ts never reads overlay.allowRemnantPrompt',
    'gap'
  );
  check(
    results,
    'Comic player_dead outcome on death',
    comicPlayerDeadWired,
    comicPlayerDeadWired ? 'wired' : 'Game.ts dismisses comic on death without comic.onNamedOutcome(..., player_dead)',
    'gap'
  );
  check(
    results,
    'runLootChoices called from gameplay',
    runLootWired,
    runLootWired ? 'wired' : 'Progression.runLootChoices exported but only debug runLoot command writes runLoot',
    'gap'
  );
  check(
    results,
    'EventBus nemesis lifecycle has listeners',
    nemesisEventsWired,
    nemesisEventsWired ? 'wired' : 'nemesisPromoted/Died/Returned emitted in NemesisManager with no listeners',
    'gap'
  );
  check(
    results,
    'Save telemetryOptIn gates Telemetry',
    telemetryOptInWired,
    telemetryOptInWired ? 'wired' : 'PlayerMeta.telemetryOptIn migrated but never read',
    'gap'
  );
  check(
    results,
    'onGodEnd delegates to presentGodEnd',
    !onGodEndStub,
    onGodEndStub ? 'onGodEnd is still an empty stub' : 'callback wired',
    'gap'
  );
  check(
    results,
    'AbilityManager removed or imported',
    abilityManagerRemoved,
    abilityManagerRemoved ? 'removed' : 'AbilityManager.ts is orphaned — OfferRoller is used instead',
    'gap'
  );

  const gaps = results.filter((r) => r.category === 'gap');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return {
    passed,
    failed,
    knownGaps: gaps.filter((r) => !r.ok).length,
    results,
  };
}

export function formatWiringSelfTest(r: WiringSelfTestReport): string {
  const lines: string[] = ['=== Wiring Self-Test ===', ''];
  for (const t of r.results) {
    const tag = t.category === 'gap' ? 'GAP ' : '    ';
    lines.push(`${t.ok ? 'PASS' : 'FAIL'} ${tag} ${t.name}${t.detail ? ' — ' + t.detail : ''}`);
  }
  lines.push('');
  lines.push(`Regression: ${r.results.filter((x) => x.category === 'wired' && x.ok).length}/${r.results.filter((x) => x.category === 'wired').length} passed`);
  lines.push(`Known gaps remaining: ${r.knownGaps}`);
  lines.push(`Total: ${r.passed} passed / ${r.failed} failed`);
  return lines.join('\n');
}
