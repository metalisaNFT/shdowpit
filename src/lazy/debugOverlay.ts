/** Lazy-loaded F1 debug panel — dev-only surface, not on the pit critical path. */

export async function loadDebugOverlay() {
  const mod = await import('../ui/DebugOverlay');
  return { DebugOverlay: mod.DebugOverlay };
}

export type DebugOverlayModule = Awaited<ReturnType<typeof loadDebugOverlay>>;
