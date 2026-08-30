/**
 * Shared helpers for browser harnesses that drive THE LONG GAME after lazy-load split.
 */

/** Evaluate a __god command (sync API on the game side). */
export function godEval(page, cmd, a, b, c) {
  return page.evaluate(([x, y, z, w]) => window.SHDOWPIT.__god(x, y, z, w), [cmd, a, b, c]);
}

/** Load the god layer without starting a run (inspect / AI tests). */
export async function ensureGodLayer(page) {
  await page.evaluate(async () => {
    await window.SHDOWPIT.__ensureGodLayer();
  });
}

/** Ensure the god layer chunk is loaded, then start a run. */
export async function godStart(page) {
  await ensureGodLayer(page);
  // Separate evaluate from ensureGodLayer — combined async evaluate destroys the context in Chromium.
  await page.evaluate(() => {
    window.SHDOWPIT.__god('start');
  });
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(125);
    const st = await godEval(page, 'state');
    if (st.active) return st;
  }
  throw new Error('god run did not become active after start');
}
