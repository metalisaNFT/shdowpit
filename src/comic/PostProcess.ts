/**
 * Potato comic post-process — CSS-free canvas filters on a capture.
 * Always available; no models required.
 */

import type { ComicStyleProfile } from './Types';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * Apply ink / contrast / grain / halftone / border. Returns a JPEG data URL.
 */
export async function stylizeCapture(rgbDataUrl: string, style: ComicStyleProfile): Promise<string> {
  const img = await loadImage(rgbDataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const contrast = style.contrast;
  const ink = style.inkStrength;
  const grain = style.grain;
  const half = style.halftone;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255;
    let g = d[i + 1] / 255;
    let b = d[i + 2] / 255;
    // Contrast around mid-grey
    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    // Desaturate toward ink comic
    const lum = r * 0.3 + g * 0.59 + b * 0.11;
    r = r * (1 - ink * 0.65) + lum * ink * 0.65;
    g = g * (1 - ink * 0.65) + lum * ink * 0.65;
    b = b * (1 - ink * 0.55) + lum * ink * 0.55;
    // Posterize a touch
    const levels = 5;
    r = Math.round(r * levels) / levels;
    g = Math.round(g * levels) / levels;
    b = Math.round(b * levels) / levels;
    // Halftone-ish darkening by pixel grid
    if (half > 0) {
      const x = (i / 4) % w;
      const y = Math.floor(i / 4 / w);
      const cell = ((x >> 2) + (y >> 2)) & 1;
      if (cell && lum < 0.55) {
        r *= 1 - half * 0.35;
        g *= 1 - half * 0.35;
        b *= 1 - half * 0.28;
      }
    }
    // Grain
    if (grain > 0) {
      const n = (Math.random() - 0.5) * grain;
      r += n;
      g += n;
      b += n;
    }
    d[i] = Math.max(0, Math.min(255, r * 255));
    d[i + 1] = Math.max(0, Math.min(255, g * 255));
    d[i + 2] = Math.max(0, Math.min(255, b * 255));
  }
  ctx.putImageData(imageData, 0, 0);

  // Soft paper tint multiply
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = style.paperTint;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Ink border
  const border = Math.max(2, style.borderPx);
  ctx.strokeStyle = style.inkColor;
  ctx.lineWidth = border;
  ctx.strokeRect(border / 2, border / 2, w - border, h - border);

  return canvas.toDataURL('image/jpeg', 0.9);
}
