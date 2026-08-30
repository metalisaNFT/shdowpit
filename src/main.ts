/**
 * SHDOWPIT — entry point.
 */

import './style.css';
import { Game } from './core/Game';
import { syncPaletteToCss } from './ui/paletteSync';

function boot(): void {
  syncPaletteToCss();
  const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui');
  if (!canvas || !ui) {
    console.error('[SHDOWPIT] missing #viewport or #ui');
    return;
  }

  let game: Game;
  try {
    game = new Game(canvas, ui);
    game.start();
  } catch (err) {
    console.error('[SHDOWPIT] failed to start', err);
    ui.innerHTML =
      '<div class="screen"><h1>NO</h1><h2>THIS BROWSER COULD NOT START THE GAME</h2>' +
      `<div class="body"><pre style="white-space:pre-wrap">${String(err)}</pre></div></div>`;
    return;
  }

  // Handy for debugging from the console; harmless in a shipped build.
  (window as unknown as { SHDOWPIT: Game }).SHDOWPIT = game;

  window.addEventListener('error', (e) => {
    console.error('[SHDOWPIT] uncaught', e.error ?? e.message);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
