/**
 * Lazy-loaded god session bundle — GodRun, oracle UI, and god-only AI helpers.
 * Pit paths keep lightweight god/GodTypes + PitBridge imports in the main chunk.
 */

export async function loadGodLayer() {
  const [
    godRunMod,
    godScreenMod,
    godSpectatorMod,
    godClockMod,
    godTutorialMod,
    legendsMod,
    godAiMod,
    teachingMod,
    autonomyMod,
    godMapMod,
    influenceMod,
    factionsMod,
    aftermathMod,
  ] = await Promise.all([
    import('../god/GodRun'),
    import('../ui/GodScreen'),
    import('../ui/GodSpectator'),
    import('../god/Clock'),
    import('../ui/GodTutorial'),
    import('../ui/LegendsScreen'),
    import('../god/GodAI'),
    import('../god/Teaching'),
    import('../god/Autonomy'),
    import('../ui/GodMap'),
    import('../god/Influence'),
    import('../god/Factions'),
    import('../god/Aftermath'),
  ]);

  return {
    GodRun: godRunMod.GodRun,
    GodScreen: godScreenMod.GodScreen,
    GodSpectator: godSpectatorMod.GodSpectator,
    GodClock: godClockMod.GodClock,
    pickPauseBeat: godClockMod.pickPauseBeat,
    pickSpectacleBeat: godClockMod.pickSpectacleBeat,
    PrimerScreen: godTutorialMod.PrimerScreen,
    LegendsScreen: legendsMod.LegendsScreen,
    RunEndScreen: legendsMod.RunEndScreen,
    Guide: teachingMod.Guide,
    STEP_COUNT: teachingMod.STEP_COUNT,
    STEP_ORDER: teachingMod.STEP_ORDER,
    pickLesson: teachingMod.pickLesson,
    applyGoalAfterAction: autonomyMod.applyGoalAfterAction,
    populatedAreas: godMapMod.populatedAreas,
    addChaos: influenceMod.addChaos,
    chaosTier: influenceMod.chaosTier,
    livingFactions: factionsMod.livingFactions,
    describeBlessedFailure: aftermathMod.describeBlessedFailure,
    describeQuietDecline: aftermathMod.describeQuietDecline,
    spectacleCauseCaption: aftermathMod.spectacleCauseCaption,
    ...godAiMod,
  };
}

export type GodLayer = Awaited<ReturnType<typeof loadGodLayer>>;
