import type { Point } from './types';

/** Width is local X, depth is local Z, yaw is a Three.js rotation about Y. */
export interface Box extends Point {
  width: number;
  depth: number;
  yaw: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Signed shortest rotation from `from` toward `to`. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Separating-axis test for two oriented rectangles in the ground plane. */
export function boxIntersects(a: Box, b: Box, margin = 0): boolean {
  const aw = Math.max(0, a.width / 2 + margin);
  const ad = Math.max(0, a.depth / 2 + margin);
  const bw = Math.max(0, b.width / 2 + margin);
  const bd = Math.max(0, b.depth / 2 + margin);
  const dx = b.x - a.x, dz = b.z - a.z;
  // This conservative bound contains both boxes at any yaw. Distant scenery
  // needs no trigonometry or temporary SAT axes on every vehicle movement.
  const reach = aw + ad + bw + bd + 2e-8;
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
  const ac = Math.cos(a.yaw), as = Math.sin(a.yaw);
  const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
  const axes = [[ac, -as], [as, ac], [bc, -bs], [bs, bc]];
  for (const [x, z] of axes) {
    const separation = Math.abs(dx * x + dz * z);
    const ar = aw * Math.abs(ac * x - as * z) + ad * Math.abs(as * x + ac * z);
    const br = bw * Math.abs(bc * x - bs * z) + bd * Math.abs(bs * x + bc * z);
    if (separation > ar + br + 1e-8) return false;
  }
  return true;
}

export function circleIntersectsBox(x: number, z: number, radius: number, box: Box): boolean {
  const dx = x - box.x, dz = z - box.z;
  const safeRadius = Math.max(0, radius);
  // sqrt(1e-8) also preserves the squared-distance tolerance for radius zero.
  const reach = Math.abs(box.width) / 2 + Math.abs(box.depth) / 2 + safeRadius + 1e-4;
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const localX = dx * c - dz * s;
  const localZ = dx * s + dz * c;
  const nearX = clamp(localX, -box.width / 2, box.width / 2);
  const nearZ = clamp(localZ, -box.depth / 2, box.depth / 2);
  return (localX - nearX) ** 2 + (localZ - nearZ) ** 2 <= safeRadius ** 2 + 1e-8;
}
