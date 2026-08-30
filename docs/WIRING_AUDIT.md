# Wiring Audit — Closed

**Last verified:** 2026-08-30 · **Status:** all P0/P1 gaps from the 2026-08-28 audit are closed in source.

Automated checks: `npm run test:wiring` (static audit) and `npm run test:wiring:browser` (in-browser self-test).

---

## Closed items (formerly gaps)

| Item | Fixed in |
|------|----------|
| OverlayGate `showBanner` / `showToasts` / `allowRemnantPrompt` consumed | `Game.ts` overlay tick |
| `player_dead` event wired | `Game.ts` |
| `onPanelReady` passed to comic service | `Game.ts` |
| `setEnabled()` on comic pipeline | `Game.ts` |
| `runLootChoices()` called from gameplay | `Game.ts` |
| EffectTrigger / `effects.trigger()` wired | `CombatSystem.ts`, `Game.ts` |
| `AbilityManager.ts` removed (superseded by `OfferRoller`) | deleted |
| `telemetryOptIn`, favorites, unlockedStarting read | `PauseScreen`, `Progression`, `BuildScreen` |
| EventBus events wired | `Game.ts` |

## Still open

| Item | Notes |
|------|-------|
| `ComicService.setStyle()` uncalled | one profile never selected; cosmetic |

See `docs/MAESTRO_AUDIT.md` for the full findings register and regression harness map.
