import { boxIntersects, circleIntersectsBox, clamp, dist } from './collision';
import { routeToTarget } from './ai';
import { traceBullet } from './combat';
import type { GameState, Point, PoliceSighting, Vehicle, World } from './types';

export const policeLimit = (wanted: number): number => wanted >= 3 ? 6 : wanted === 2 ? 4 : wanted ? 3 : 0;
export const policeEscapeDuration = (wanted: number): number => wanted >= 3 ? 22 : wanted === 2 ? 17 : 12;

/** A radio report is a snapshot. Search navigation never reads the hidden player. */
export function policeSighting(state: GameState): PoliceSighting {
  const car = state.vehicles.find(vehicle => vehicle.id === state.player.vehicleId);
  const target = car ?? state.player;
  return { x: target.x, z: target.z, yaw: target.yaw + (car && car.speed < 0 ? Math.PI : 0),
    speed: Math.abs(car?.speed ?? (state.player.moving ? 5.2 : 0)), inVehicle: !!car, time: state.time };
}

/** Windshield/eye-height visibility respects cover and recognizes the occupied car. */
export function policeCanSee(world: World, state: GameState, observer: Point, ownCar?: string, maximumRange?: number): boolean {
  const car = state.vehicles.find(vehicle => vehicle.id === state.player.vehicleId);
  const target = car ?? state.player;
  const range = dist(observer, target);
  if (range > (maximumRange ?? (state.police.wanted >= 3 ? car ? 105 : 82 : 62))) return false;
  const origin = { x: observer.x, y: ownCar ? 1.65 : 1.72, z: observer.z };
  const vector = { x: target.x - observer.x, y: (car ? 1.5 : 1.3) - origin.y, z: target.z - observer.z };
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < .1) return true;
  const hit = traceBullet(world, state, origin, vector, length, { sceneryOnly: true, ignoreVehicleId: ownCar });
  return hit.kind === 'miss' || hit.distance >= length - .1 || !!car && hit.id === car.id;
}

const nearestRoad = (roads: number[], value: number): number => roads.reduce((a, b) => Math.abs(a - value) < Math.abs(b - value) ? a : b);

/** Two units follow; the others approach upcoming junctions from different roads. */
export function policeObjective(world: World, sight: PoliceSighting, rank: number, visible: boolean, time: number): Point {
  const extent = world.size / 2 - world.roadWidth;
  const age = Math.max(0, time - sight.time);
  const dx = Math.sin(sight.yaw), dz = Math.cos(sight.yaw);
  const roadX = nearestRoad(world.roads, sight.x), roadZ = nearestRoad(world.roads, sight.z);
  if (!visible && age > 3) {
    if (rank === 0 && age < 7) return { x: sight.x, z: sight.z };
    const phase = (rank + Math.floor((age - 3) / 6)) % 4;
    const radius = rank < 2 ? 24 : 50;
    const alongX = phase % 2 === 0;
    return alongX
      ? { x: clamp(sight.x + (phase === 0 ? radius : -radius), -extent, extent), z: roadZ }
      : { x: roadX, z: clamp(sight.z + (phase === 1 ? radius : -radius), -extent, extent) };
  }
  if (!sight.inVehicle || sight.speed < 4) {
    if (rank < 2) return { x: sight.x, z: sight.z };
    const side = rank % 2 ? -1 : 1;
    return Math.abs(sight.x - roadX) < Math.abs(sight.z - roadZ)
      ? { x: roadX, z: clamp(sight.z + side * (12 + Math.floor(rank / 2) * 4), -extent, extent) }
      : { x: clamp(sight.x + side * (12 + Math.floor(rank / 2) * 4), -extent, extent), z: roadZ };
  }
  if (rank < 2) {
    const lead = sight.speed * (visible ? rank === 0 ? .35 : .7 : Math.min(age, 1.5));
    return { x: clamp(sight.x + dx * lead, -extent, extent), z: clamp(sight.z + dz * lead, -extent, extent) };
  }
  const vertical = Math.abs(dz) >= Math.abs(dx);
  const sign = (vertical ? dz : dx) >= 0 ? 1 : -1;
  const coordinate = vertical ? sight.z : sight.x;
  const ahead = world.roads.filter(road => (road - coordinate) * sign > 7).sort((a, b) => (a - b) * sign);
  const cross = ahead[Math.min(Math.floor((rank - 2) / 2), ahead.length - 1)] ?? clamp(coordinate + sign * 35, -extent, extent);
  const side = rank % 2 ? -1 : 1;
  return vertical ? { x: roadX + side * 9, z: cross } : { x: cross, z: roadZ + side * 9 };
}

/** Right-hand lanes keep opposing responders and following units separated. */
export function policeLaneRoute(car: Vehicle, points: Point[], lane = 2.7): Point[] {
  return points.map((point, index) => {
    const previous = index ? points[index - 1] : car;
    const dx = point.x - previous.x, dz = point.z - previous.z;
    if (Math.abs(dx) > Math.abs(dz) * 2) return { x: point.x, z: point.z + Math.sign(dx) * lane };
    if (Math.abs(dz) > Math.abs(dx) * 2) return { x: point.x - Math.sign(dz) * lane, z: point.z };
    return { ...point };
  });
}

/** A small visibility graph commits officers to a clear route around cover. */
export function policeOfficerPath(world: World, state: GameState, from: Point, target: Point): Point[] {
  const solids = [...world.buildings, ...world.obstacles, ...state.vehicles.filter(car => car.active)];
  const corridor = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
    yaw: Math.atan2(b.x - a.x, b.z - a.z), width: .88, depth: dist(a, b) });
  const clear = (a: Point, b: Point): boolean => {
    const segment = corridor(a, b);
    return !solids.some(solid => boxIntersects(segment, solid));
  };
  if (clear(from, target)) return [{ ...target }];
  const roadRoute = [...routeToTarget(from, target, world), { ...target }];
  const segments = [[from, target], ...roadRoute.map((point, index) => [index ? roadRoute[index - 1] : from, point])].map(([a, b]) => corridor(a, b));
  const blockers = solids.filter(solid => segments.some(segment => boxIntersects(segment, solid)))
    .sort((a, b) => dist(from, a) - dist(from, b)).slice(0, 10);
  const nodes: Point[] = [{ ...from }, { ...target }, ...roadRoute.slice(0, -1)];
  for (const solid of blockers) {
    const c = Math.cos(solid.yaw), s = Math.sin(solid.yaw);
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const x = side * (solid.width / 2 + .8), z = end * (solid.depth / 2 + .8);
      nodes.push({ x: solid.x + c * x + s * z, z: solid.z - s * x + c * z });
    }
  }
  const points = nodes.filter((point, index) => index < 2 || Math.max(Math.abs(point.x), Math.abs(point.z)) < world.size / 2 - 1 &&
    !solids.some(solid => circleIntersectsBox(point.x, point.z, .43, solid)));
  const costs = points.map((_, index) => index ? Infinity : 0), previous = points.map(() => -1), visited = new Set<number>();
  for (let iteration = 0; iteration < points.length; iteration++) {
    let current = -1;
    for (let index = 0; index < points.length; index++) if (!visited.has(index) && (current < 0 || costs[index] < costs[current])) current = index;
    if (current < 0 || !Number.isFinite(costs[current])) break;
    if (current === 1) {
      const route: Point[] = [];
      for (let index = 1; index > 0; index = previous[index]) route.unshift(points[index]);
      return route;
    }
    visited.add(current);
    for (let next = 0; next < points.length; next++) {
      if (visited.has(next)) continue;
      const cost = costs[current] + dist(points[current], points[next]);
      if (cost >= costs[next] || !clear(points[current], points[next])) continue;
      costs[next] = cost; previous[next] = current;
    }
  }
  // If traffic temporarily seals every route, wait at a reachable approach.
  const approach = points.map((point, index) => ({ point, index })).filter(({ index }) => index > 1 && Number.isFinite(costs[index]))
    .sort((a, b) => dist(a.point, target) - dist(b.point, target))[0];
  const route: Point[] = [];
  if (approach) for (let index = approach.index; index > 0; index = previous[index]) route.unshift(points[index]);
  return route;
}
