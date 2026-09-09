import { clamp, type Box } from './collision';
import type { Point, Vehicle, VehicleDamage } from './types';

export const VEHICLE_MASS = { sedan: 1450, truck: 4800, pickup: 2200, hatchback: 1100, sport: 1350 };
export function freshDamage(): VehicleDamage {
  return { integrity: 1, front: 0, rear: 0, left: 0, right: 0, engine: 1,
    driftX: 0, driftZ: 0, revision: 0, lastImpact: -100, impactEnergy: 0 };
}
export function driveEfficiency(car: Vehicle): number {
  const d = car.damage;
  return !d ? 1 : d.integrity < .08 || d.engine < .08 ? 0 : .25 + .75 * d.engine;
}
export function velocity(car: Vehicle): Point {
  return { x: Math.sin(car.yaw) * car.speed + (car.damage?.driftX ?? 0),
    z: Math.cos(car.yaw) * car.speed + (car.damage?.driftZ ?? 0) };
}
/** SAT minimum-penetration normal, pointing from the moving box toward its obstacle. */
export function contactNormal(a: Box, b: Box): Point {
  const ac = Math.cos(a.yaw), as = Math.sin(a.yaw), bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
  let minimum = Infinity, normal = { x: 0, z: 1 };
  for (const [x, z] of [[ac, -as], [as, ac], [bc, -bs], [bs, bc]]) {
    const dot = (b.x - a.x) * x + (b.z - a.z) * z;
    const radius = a.width / 2 * Math.abs(ac * x - as * z) + a.depth / 2 * Math.abs(as * x + ac * z)
      + b.width / 2 * Math.abs(bc * x - bs * z) + b.depth / 2 * Math.abs(bs * x + bc * z);
    const penetration = radius - Math.abs(dot);
    if (penetration < minimum) { minimum = penetration; normal = { x: x * (dot < 0 ? -1 : 1), z: z * (dot < 0 ? -1 : 1) }; }
  }
  return normal;
}
function markDamage(car: Vehicle, energy: number, normal: Point, time: number) {
  const d = car.damage ??= freshDamage();
  // Soft low-speed contacts have no structural damage. Energy is in joules.
  if (energy < VEHICLE_MASS[car.model] * 1.2 || time - d.lastImpact < .12) return;
  const loss = clamp(energy / (VEHICLE_MASS[car.model] * 300), 0, .92);
  const localX = normal.x * Math.cos(car.yaw) - normal.z * Math.sin(car.yaw);
  const localZ = normal.x * Math.sin(car.yaw) + normal.z * Math.cos(car.yaw);
  const side = Math.abs(localZ) >= Math.abs(localX) ? localZ > 0 ? 'front' : 'rear' : localX > 0 ? 'right' : 'left';
  d[side] = clamp(d[side] + loss * 1.6, 0, 1);
  d.integrity = clamp(d.integrity - loss, 0, 1);
  d.engine = clamp(d.engine - loss * (side === 'front' ? 1.5 : .3), 0, 1);
  d.lastImpact = time; d.impactEnergy = energy; d.revision++;
}
/** Inelastic normal impulse: mass and relative approach velocity, never absolute road speed. */
export function resolveVehicleImpact(a: Vehicle, b: Vehicle | null, normal: Point, time: number): number {
  const length = Math.hypot(normal.x, normal.z);
  if (!Number.isFinite(length) || length < 1e-8) return 0;
  const n = { x: normal.x / length, z: normal.z / length };
  const va = velocity(a), vb = b ? velocity(b) : { x: 0, z: 0 };
  const closing = (va.x - vb.x) * n.x + (va.z - vb.z) * n.z;
  if (!Number.isFinite(closing) || closing <= 0) return 0;
  const ma = VEHICLE_MASS[a.model], mb = b ? VEHICLE_MASS[b.model] : Infinity;
  const reducedMass = 1 / (1 / ma + 1 / mb);
  const restitution = closing > 2 ? .08 : 0;
  const impulse = (1 + restitution) * closing * reducedMass;
  const energy = .5 * reducedMass * closing * closing * (1 - restitution * restitution);
  const apply = (car: Vehicle, sign: number, mass: number) => {
    const d = car.damage ??= freshDamage();
    const dx = sign * n.x * impulse / mass, dz = sign * n.z * impulse / mass;
    const longitudinal = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
    car.speed += longitudinal;
    d.driftX += dx - longitudinal * Math.sin(car.yaw);
    d.driftZ += dz - longitudinal * Math.cos(car.yaw);
    // Offset side impacts bend alignment; translational impulse remains momentum-conserving.
    markDamage(car, b ? energy / 2 : energy, { x: -sign * n.x, z: -sign * n.z }, time);
  };
  apply(a, -1, ma);
  if (b) apply(b, 1, mb);
  return energy;
}
