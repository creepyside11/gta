import { angleDelta, boxIntersects, circleIntersectsBox, dist } from './collision';
import type { GameState, Point, Vehicle, World } from './types';

export interface TrafficPose extends Point { yaw: number }
export function trafficPoseClear(world: World, state: GameState, car: Vehicle, pose: TrafficPose, forecast = false, marginScale = 1): boolean {
  const box = { ...pose, width: car.width + .24 * marginScale, depth: car.depth + .3 * marginScale };
  const ex = Math.abs(Math.cos(pose.yaw)) * box.width / 2 + Math.abs(Math.sin(pose.yaw)) * box.depth / 2;
  const ez = Math.abs(Math.sin(pose.yaw)) * box.width / 2 + Math.abs(Math.cos(pose.yaw)) * box.depth / 2;
  if (Math.abs(pose.x) + ex > world.size / 2 - 1 || Math.abs(pose.z) + ez > world.size / 2 - 1) return false;
  // All four corners must stay on road surface; pavements are not passing lanes.
  for (const x of [-box.width / 2, box.width / 2]) for (const z of [-box.depth / 2, box.depth / 2]) {
    const wx = pose.x + x * Math.cos(pose.yaw) + z * Math.sin(pose.yaw);
    const wz = pose.z - x * Math.sin(pose.yaw) + z * Math.cos(pose.yaw);
    if (!world.roads.some(road => Math.abs(wx - road) < world.roadWidth / 2 - .15 || Math.abs(wz - road) < world.roadWidth / 2 - .15)) return false;
  }
  for (const solid of world.buildings) if (boxIntersects(box, solid)) return false;
  for (const solid of world.obstacles) if (boxIntersects(box, solid)) return false;
  for (const other of state.vehicles) {
    if (!other.active || other.id === car.id) continue;
    if (boxIntersects(box, other, .12 * marginScale)) return false;
    if (forecast && Math.abs(other.speed) > .8) {
      // Reserve the space swept by approaching traffic during the next two seconds.
      const travel = other.speed * 2;
      const swept = { ...other, x: other.x + Math.sin(other.yaw) * travel / 2,
        z: other.z + Math.cos(other.yaw) * travel / 2, depth: other.depth + Math.abs(travel) };
      if (boxIntersects(box, swept, .3)) return false;
    }
  }
  if (!state.player.vehicleId && circleIntersectsBox(state.player.x, state.player.z, .65, box)) return false;
  if (state.pedestrians.some(p => p.state !== 'dead' && circleIntersectsBox(p.x, p.z, .65, box))) return false;
  return !state.officers.some(p => p.state !== 'dead' && p.state !== 'riding' && circleIntersectsBox(p.x, p.z, .65, box));
}

/** Samples the whole footprint along two smooth lane changes, including the return to the original lane. */
export function planTrafficBypass(world: World, state: GameState, car: Vehicle, obstacle: Vehicle): TrafficPose[] | null {
  if (Math.abs(obstacle.speed) > .8 || !car.route.length) return null;
  const goal = car.route[car.waypoint], previous = car.route[(car.waypoint + car.route.length - 1) % car.route.length];
  const heading = Math.atan2(goal.x - previous.x, goal.z - previous.z);
  if (Math.abs(angleDelta(car.yaw, heading)) > .65) return null;
  const f = { x: Math.sin(heading), z: Math.cos(heading) }, r = { x: f.z, z: -f.x };
  const dx = obstacle.x - car.x, dz = obstacle.z - car.z;
  const along = dx * f.x + dz * f.z, across = dx * r.x + dz * r.z;
  const relative = obstacle.yaw - heading;
  const halfLength = Math.abs(Math.cos(relative)) * obstacle.depth / 2 + Math.abs(Math.sin(relative)) * obstacle.width / 2;
  const halfWidth = Math.abs(Math.sin(relative)) * obstacle.depth / 2 + Math.abs(Math.cos(relative)) * obstacle.width / 2;
  const laneChange = Math.max(8, car.depth * 1.7);
  const lead = along - halfLength - car.depth / 2 - 1.5;
  const endPass = along + halfLength + car.depth / 2 + 2;
  if (lead < laneChange || dist(car, goal) < endPass + laneChange + 4) return null;
  const returnOffset = (goal.x - car.x) * r.x + (goal.z - car.z) * r.z;
  for (const side of [-1, 1]) {
    const shift = across + side * (halfWidth + car.width / 2 + 1.2);
    const total = endPass + laneChange;
    const poses: TrafficPose[] = [{ x: car.x, z: car.z, yaw: car.yaw }];
    let valid = true;
    const count = Math.ceil(total / .35);
    for (let i = 1; i <= count; i++) {
      const s = total * i / count;
      let lateral = shift, derivative = 0;
      if (s < lead) { const t = s / lead; lateral = shift * (3 * t * t - 2 * t * t * t); derivative = shift * 6 * t * (1 - t) / lead; }
      else if (s > endPass) { const t = (s - endPass) / laneChange; lateral = shift + (returnOffset - shift) * (3 * t * t - 2 * t * t * t); derivative = (returnOffset - shift) * 6 * t * (1 - t) / laneChange; }
      const pose = { x: car.x + f.x * s + r.x * lateral, z: car.z + f.z * s + r.z * lateral,
        yaw: heading + Math.atan(derivative) };
      if (!trafficPoseClear(world, state, car, pose, true)) { valid = false; break; }
      poses.push(pose);
    }
    if (valid) return poses;
  }
  return null;
}
