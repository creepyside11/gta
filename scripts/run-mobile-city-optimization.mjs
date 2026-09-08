import { readFileSync, writeFileSync } from 'node:fs';

for (const path of [
  'GTA/Проект/src/render/GameRenderer.ts',
  'GTA/Проект/src/game/simulation.ts',
  'GTA/Проект/src/game/ai.ts',
  'GTA/Проект/src/ui/App.tsx',
]) {
  const source = readFileSync(path, 'utf8');
  writeFileSync(path, source.replace(/\r\n/g, '\n'));
}

await import('./apply-mobile-city-optimization.mjs');
