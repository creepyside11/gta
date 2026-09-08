import { readFileSync, writeFileSync } from 'node:fs';

const paths = [
  'GTA/Проект/src/render/GameRenderer.ts',
  'GTA/Проект/src/game/simulation.ts',
  'GTA/Проект/src/ui/App.tsx',
];
const originalEndings = new Map();

for (const path of paths) {
  const source = readFileSync(path, 'utf8');
  originalEndings.set(path, source.includes('\r\n') ? '\r\n' : '\n');
  writeFileSync(path, source.replace(/\r\n/g, '\n'));
}

await import('./apply-mobile-city-optimization-v3.mjs');

for (const path of paths) {
  if (originalEndings.get(path) !== '\r\n') continue;
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(path, source.replace(/\n/g, '\r\n'));
}
