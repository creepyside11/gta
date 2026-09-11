import type { Pedestrian, Point, Vehicle, World } from './types';
import { angleDelta, clamp, dist } from './collision';
import { VEHICLE_SPECS } from './vehicles';
import { createWorld } from './world';

export const MISSION_CAR_ID = 'courier-01';
export const VEHICLE_WIDTH = VEHICLE_SPECS.sedan.width;
export const VEHICLE_DEPTH = VEHICLE_SPECS.sedan.depth;

function vehicle(id: string, kind: Vehicle['kind'], x: number, z: number, yaw: number, color: string, route: Point[] = [], waypoint = 0, model: Vehicle['model'] = 'sedan'): Vehicle {
  const { width, depth } = VEHICLE_SPECS[model];
  return { id, kind, model, x, z, yaw, color, route, waypoint, width, depth, speed: 0, steer: 0, blocked: 0, active: kind !== 'police' };
}

export function createVehicles(world: World = createWorld()): Vehicle[] {
  const outer: Point[] = [{ x: 76, z: -76 }, { x: 76, z: 76 }, { x: -76, z: 76 }, { x: -76, z: -76 }];
  const inner: Point[] = [{ x: -4, z: -84 }, { x: -4, z: -4 }, { x: 84, z: -4 }, { x: 84, z: -84 }];
  const vehicles = [
    vehicle(MISSION_CAR_ID, 'mission', 6, 40, Math.PI, '#f6c452'),
    vehicle('parked-coral', 'parked', -6, 105, 0, '#4b6f95', [], 0, 'bmw-m5-f90'),
    vehicle('parked-mint', 'parked', 86, 110, Math.PI, '#22282d', [], 0, 'mercedes-g63'),
    vehicle('parked-cream', 'parked', -110, -86, Math.PI / 2, '#b84c45', [], 0, 'nissan-gtr-r35'),
    vehicle('traffic-0', 'traffic', 76, -43, 0, '#c5604b', outer, 1),
    vehicle('traffic-1', 'traffic', 76, 49, 0, '#e8d7b3', outer, 1, 'truck'),
    vehicle('traffic-2', 'traffic', -22, 76, -Math.PI / 2, '#7da8b7', outer, 2, 'hatchback'),
    vehicle('traffic-3', 'traffic', -76, 37, Math.PI, '#b3c785', outer, 3, 'pickup'),
    vehicle('traffic-4', 'traffic', -76, -49, Math.PI, '#c19ac7', outer, 3, 'sport'),
    vehicle('traffic-5', 'traffic', -13, -76, Math.PI / 2, '#edba61', outer, 0),
    vehicle('traffic-6', 'traffic', -4, -65, 0, '#7f92b4', inner, 1, 'hatchback'),
    vehicle('traffic-7', 'traffic', 84, -55, Math.PI, '#e0a88c', inner, 3, 'pickup'),
    vehicle('police-0', 'police', 0, 117, Math.PI, '#233e52'),
    vehicle('police-1', 'police', -80, -121, 0, '#233e52'),
  ];
  if (world.roads.length > 3) {
    const firstRoad = Math.min(...world.roads);
    const lastRoad = Math.max(...world.roads);
    const lane = world.roadWidth * 2 / 9;
    const perimeter = [
      { x: lastRoad - lane, z: firstRoad + lane },
      { x: lastRoad - lane, z: lastRoad - lane },
      { x: firstRoad + lane, z: lastRoad - lane },
      { x: firstRoad + lane, z: firstRoad + lane },
    ];
    const models: Vehicle['model'][] = ['hatchback', 'truck', 'sedan', 'pickup', 'sport', 'hatchback', 'pickup', 'sport'];
    const colors = ['#7ba9ba', '#dca562', '#bd7b83', '#85ad93', '#ebbd54', '#9e99bd', '#d17861', '#acc0bd'];
    for (let edge = 0; edge < perimeter.length; edge++) {
      const a = perimeter[edge], b = perimeter[(edge + 1) % perimeter.length];
      for (let slot = 0; slot < 2; slot++) {
        const index = edge * 2 + slot;
        const t = slot === 0 ? 0.23 : 0.72;
        vehicles.push(vehicle(`traffic-${8 + index}`, 'traffic', a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t,
          Math.atan2(b.x - a.x, b.z - a.z), colors[index], perimeter, (edge + 1) % perimeter.length, models[index]));
      }
    }
    const curb = world.roadWidth / 3;
    const quarter = (lastRoad - firstRoad) / 8;
    vehicles.push(
      vehicle('parked-north', 'parked', firstRoad + quarter, firstRoad - curb, -Math.PI / 2, '#86acb3', [], 0, 'hatchback'),
      vehicle('parked-east', 'parked', lastRoad + curb, -quarter, Math.PI, '#d9ae75', [], 0, 'truck'),
      vehicle('parked-south', 'parked', lastRoad - quarter, lastRoad + curb, Math.PI / 2, '#c78472', [], 0, 'pickup'),
      vehicle('parked-west', 'parked', firstRoad - curb, quarter, 0, '#9aa5cc', [], 0, 'sport'),
    );
  }
  return vehicles;
}

export function createPedestrians(world: World = createWorld()): Pedestrian[] {
  const loops: Point[][] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const corners = [{ x: 11.3 * sx, z: 11.3 * sz }, { x: 68.7 * sx, z: 11.3 * sz }, { x: 68.7 * sx, z: 68.7 * sz }, { x: 11.3 * sx, z: 68.7 * sz }];
    if (sx * sz < 0) corners.reverse();
    loops.push(corners);
  }
  const rectangle = (x0: number, z0: number, x1: number, z1: number): Point[] =>
    [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  if (world.roads.includes(-400) && world.roads.includes(-320) && world.roads.includes(320) && world.roads.includes(400)) {
    // Four local neighborhood loops put residents in each satellite city without making
    // pedestrians cross the high-speed regional arterials between cities.
    loops.push(
      rectangle(331.3, 11.3, 388.7, 68.7),
      rectangle(-388.7, -68.7, -331.3, -11.3).reverse(),
      rectangle(-68.7, -388.7, -11.3, -331.3),
      rectangle(11.3, 331.3, 68.7, 388.7).reverse(),
    );
  } else if (world.roads.length > 3) {
    const firstRoad = Math.min(...world.roads);
    const lastRoad = Math.max(...world.roads);
    const sidewalk = world.roadWidth / 2 + 2.3;
    const edge = world.size / 2 - sidewalk;
    const centralRoads = world.roads.filter(road => road !== firstRoad && road !== lastRoad);
    const left = centralRoads[0] + sidewalk;
    const right = centralRoads[centralRoads.length - 1] - sidewalk;
    loops.push(
      rectangle(left, -edge, -sidewalk, firstRoad - sidewalk),
      rectangle(lastRoad + sidewalk, left, edge, -sidewalk),
      rectangle(sidewalk, lastRoad + sidewalk, right, edge),
      rectangle(-edge, sidewalk, firstRoad - sidewalk, right),
    );
  }
  const colors = ['#ee9973', '#7d9cae', '#edcb73', '#9bbb99', '#c9a2b6', '#3f6974'];
  return loops.flatMap((route, loop) => Array.from({ length: 9 }, (_, index) => {
    const edge = index % 4;
    const a = route[edge];
    const b = route[(edge + 1) % 4];
    const t = index < 5 ? index === 4 ? .76 : .14 + index * .13 : .82;
    return { id: `ped-${index < 5 ? loop * 5 + index : loops.length * 5 + loop * 4 + index - 5}`, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
      yaw: Math.atan2(b.x - a.x, b.z - a.z), color: colors[(loop * 3 + index) % colors.length],
      speed: 1.15 + ((index * 7 + loop * 3) % 9) * 0.085, route, waypoint: (edge + 1) % 4,
      phase: index * 1.9 + loop * 0.8, state: 'walking' as const, timer: 0, health: 100, deadAt: null };
  }));
}

/** Road graph routing first projects both entities onto an unobstructed road. */
export function routeToTarget(from: Point, target: Point, world: World): Point[] {
  const roadEnd = world.size / 2 - world.roadWidth / 2 - 1;
  const project = (p: Point) => {
    const rx = world.roads.reduce((a, b) => Math.abs(p.x - a) < Math.abs(p.x - b) ? a : b);
    const rz = world.roads.reduce((a, b) => Math.abs(p.z - a) < Math.abs(p.z - b) ? a : b);
    return Math.abs(p.x - rx) < Math.abs(p.z - rz)
      ? { point: { x: rx, z: clamp(p.z, -roadEnd, roadEnd) }, axis: 'z' }
      : { point: { x: clamp(p.x, -roadEnd, roadEnd), z: rz }, axis: 'x' };
  };
  const a = project(from);
  const b = project(target);
  const points: Point[] = [];
  if (dist(from, a.point) > 3) points.push(a.point);
  if (a.axis === b.axis && (a.axis === 'z' ? a.point.x === b.point.x : a.point.z === b.point.z)) {
    points.push(b.point);
  } else if (a.axis !== b.axis) {
    points.push(a.axis === 'z' ? { x: a.point.x, z: b.point.z } : { x: b.point.x, z: a.point.z });
    points.push(b.point);
  } else {
    const cross = world.roads.reduce((best, road) => {
      const score = a.axis === 'z' ? Math.abs(a.point.z - road) + Math.abs(b.point.z - road) : Math.abs(a.point.x - road) + Math.abs(b.point.x - road);
      const bestScore = a.axis === 'z' ? Math.abs(a.point.z - best) + Math.abs(b.point.z - best) : Math.abs(a.point.x - best) + Math.abs(b.point.x - best);
      return score < bestScore ? road : best;
    });
    points.push(a.axis === 'z' ? { x: a.point.x, z: cross } : { x: cross, z: a.point.z });
    points.push(a.axis === 'z' ? { x: b.point.x, z: cross } : { x: cross, z: b.point.z });
    points.push(b.point);
  }
  return points.filter((p, i) => dist(i === 0 ? from : points[i - 1], p) > 2.8);
}

export function steerToward(car: Vehicle, target: Point, dt: number, targetSpeed: number): void {
  const desired = Math.atan2(target.x - car.x, target.z - car.z);
  const angle = angleDelta(car.yaw, desired);
  const turnSpeed = Math.abs(angle) > 0.62 ? Math.min(targetSpeed, 4.2) : targetSpeed;
  car.speed += clamp(turnSpeed - car.speed, -11 * dt, 5.5 * dt);
  const turnRate = Math.min(2.1, 0.5 + Math.abs(car.speed) * 0.14);
  car.yaw += clamp(angle, -turnRate * dt, turnRate * dt);
  car.steer = clamp(-angle, -0.55, 0.55);
}