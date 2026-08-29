/**
 * Cross-platform preview launcher (Windows-safe mock mode).
 *
 *   node tools/preview.mjs          # plain preview on 4173
 *   node tools/preview.mjs --mock     # SHDOWPIT_AI_MOCK=1
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mock = process.argv.includes('--mock');
const env = { ...process.env, ...(mock ? { SHDOWPIT_AI_MOCK: '1' } : {}) };
const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(bin, ['vite', 'preview', '--port', '4173'], { cwd: ROOT, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
