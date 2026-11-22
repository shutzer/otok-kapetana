import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '..', 'index.html');

export function loadEngine() {
  const html = fs.readFileSync(indexPath, 'utf8');
  const startMarker = '/* === ENGINE_START === */';
  const endMarker = '/* === ENGINE_END === */';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('Could not locate ENGINE_START / ENGINE_END markers in index.html');
  }

  const engineSource = html.slice(startIdx + startMarker.length, endIdx);
  const wrapped = `
    'use strict';
    ${engineSource}
    ({ CONFIG, Locale, PRNG, HexGrid, Combat, MapGenerator, GameRules, AI });
  `;

  // Execute in an isolated VM context with NO DOM globals (proves zero DOM coupling!)
  const sandbox = Object.create(null);
  const context = vm.createContext(sandbox);
  const exportsObj = vm.runInContext(wrapped, context, { filename: 'index.html#engine' });

  // Verify no stray globals leaked into sandbox
  const leakedKeys = Object.keys(sandbox);
  if (leakedKeys.length > 0) {
    throw new Error(`Engine leaked globals into sandbox: ${leakedKeys.join(', ')}`);
  }

  return exportsObj;
}
