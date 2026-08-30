/** Lazy-loaded AI status HUD — mounts after core wiring, before first AI callback. */

export async function loadAiUi() {
  const mod = await import('../ui/AIStatus');
  return { AIStatus: mod.AIStatus };
}

export type AiUiModule = Awaited<ReturnType<typeof loadAiUi>>;
