/**
 * CSS import-order validator — does NOT rewrite domain files.
 *
 * Ensures src/style.css only @imports the expected domain sheets in order.
 * Run: node scripts/split-css.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STYLE = path.join(ROOT, 'src/style.css');

const EXPECTED = [
  './ui/tokens.css',
  './ui/base.css',
  './ui/motion.css',
  './ui/title.css',
  './ui/god.css',
  './ui/hud.css',
  './ui/meta.css',
];

const imports = fs
  .readFileSync(STYLE, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith('@import'));

const found = imports.map((l) => {
  const m = l.match(/@import\s+['"]([^'"]+)['"]/);
  return m?.[1] ?? l;
});

let ok = true;
if (found.length !== EXPECTED.length) {
  console.error(`[split-css] expected ${EXPECTED.length} @imports, found ${found.length}`);
  ok = false;
}
for (let i = 0; i < EXPECTED.length; i++) {
  if (found[i] !== EXPECTED[i]) {
    console.error(`[split-css] import[${i}]: expected ${EXPECTED[i]}, got ${found[i] ?? '(missing)'}`);
    ok = false;
  }
}

for (const rel of EXPECTED) {
  const abs = path.join(ROOT, 'src', rel.replace(/^\.\//, ''));
  if (!fs.existsSync(abs)) {
    console.error(`[split-css] missing file: ${rel}`);
    ok = false;
  }
}

if (ok) {
  console.log('[split-css] import order OK (' + EXPECTED.length + ' sheets)');
} else {
  process.exit(1);
}
