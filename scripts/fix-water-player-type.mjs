import { readFileSync, writeFileSync } from 'node:fs';

const path = 'GTA/Проект/src/game/types.ts';
const raw = readFileSync(path, 'utf8');
const crlf = raw.includes('\r\n');
let source = raw.replace(/\r\n/g, '\n');
source = source.replace(
  'export interface Player extends Point { yaw: number; vehicleId: string | null; moving: boolean; swimming: boolean }',
  'export interface Player extends Point { yaw: number; vehicleId: string | null; moving: boolean; swimming?: boolean }',
);
writeFileSync(path, crlf ? source.replace(/\n/g, '\r\n') : source);
console.log('Adjusted Player swimming state for backward-compatible test fixtures.');
