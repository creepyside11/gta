import test from 'node:test';
import assert from 'node:assert/strict';
import { createPedestrians, createVehicles } from '../src/game/ai';
import { boxIntersects, circleIntersectsBox, dist } from '../src/game/collision';
import type { Point, Solid } from '../src/game/types';
import { createWorld } from '../src/game/world';

const furniture = (solids: Solid[]): Solid[] => solids.filter(solid => solid.id.startsWith('streetscape-'));
const metroFurniture = (solids: Solid[]): Solid[] => solids.filter(solid => /^metro-.*-(tree|planter|bench|bin)-/.test(solid.id));

/** The swept body must have clearance all the way between route waypoints. */
function assertPathClear(path: Point[], radius: number, props: Solid[], label: string): void {
  for (let index = 0; index < path.length - 1; index++) {
    const a = path[index], b = path[index + 1];
    const corridor = {
      x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, width: radius * 2, depth: dist(a, b),
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
    };
    for (const prop of props) {
      assert.equal(boxIntersects(prop, corridor), false, `${prop.id}: ${label} segment ${index}`);
      assert.equal(circleIntersectsBox(a.x, a.z, radius, prop), false, `${prop.id}: ${label} start ${index}`);
      assert.equal(circleIntersectsBox(b.x, b.z, radius, prop), false, `${prop.id}: ${label} end ${index}`);
    }
  }
}

test('the streetscape adds substantial, deterministic greenery and usable furniture throughout the original city', () => {
  const world = createWorld();
  const added = furniture(world.obstacles);
  assert.ok(added.length >= 300, 'the original city needs a substantial furnishing pass');
  assert.deepEqual(furniture(createWorld().obstacles), added);
  assert.equal(new Set(world.obstacles.map(prop => prop.id)).size, world.obstacles.length);
  const kinds = ['tree', 'planter', 'bench', 'bin'] as const;
  for (const kind of kinds) assert.ok(added.filter(prop => prop.kind === kind).length >= 15, `the city needs numerous ${kind} props`);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const quadrant = added.filter(prop => prop.x * sx > 0 && prop.z * sz > 0);
    assert.ok(quadrant.length >= 35, `quadrant ${sx}/${sz} must receive more than a small decorative cluster`);
    for (const kind of kinds) assert.ok(quadrant.some(prop => prop.kind === kind), `quadrant ${sx}/${sz} needs ${kind} props`);
  }
  for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
    assert.ok(added.filter(prop => prop[axis] * side > 170).length >= 12, `${axis}/${side}: the old outer neighborhoods also need furnishings`);
  }
});

test('legacy avenues retain furniture while each satellite city has its own local streetscape', () => {
  const world = createWorld();
  const added = furniture(world.obstacles);
  const legacyRoads = world.roads.filter(road => Math.abs(road) <= 160);
  assert.ok(added.length > 0);
  for (const road of legacyRoads) for (const axis of ['x', 'z'] as const) {
    for (const side of [-1, 1]) {
      const frontage = added.filter(prop => {
        const offset = (prop[axis] - road) * side;
        return offset > world.roadWidth / 2 && offset < world.roadWidth / 2 + 13;
      });
      assert.ok(frontage.length >= 6, `legacy avenue ${axis}=${road}, side ${side} needs furnishings along its frontage`);
    }
    const corridor = {
      x: axis === 'x' ? road : 0, z: axis === 'z' ? road : 0,
      width: axis === 'x' ? world.roadWidth + 7 : world.size,
      depth: axis === 'z' ? world.roadWidth + 7 : world.size, yaw: 0,
    };
    for (const prop of added) assert.equal(boxIntersects(prop, corridor), false, `${prop.id} blocks the road or sidewalk at ${axis}=${road}`);
  }
  const local = metroFurniture(world.obstacles);
  for (const district of world.districts.filter(district => district.id !== 'portside-core')) {
    const props = local.filter(prop => Math.abs(prop.x - district.x) <= district.width / 2 && Math.abs(prop.z - district.z) <= district.depth / 2);
    assert.ok(props.length >= 4, `${district.name} needs its own trees and street furniture`);
    assert.ok(new Set(props.map(prop => prop.kind)).size >= 2, `${district.name} needs more than one furniture type`);
  }
});

test('new furniture has real, finite footprints with clearance from buildings, existing props and vehicles', () => {
  const world = createWorld();
  const added = furniture(world.obstacles);
  assert.ok(added.length > 0);
  const solids = [...world.buildings, ...world.obstacles];
  const vehicles = createVehicles(world).filter(car => car.active);
  for (const prop of added) {
    assert.ok([prop.x, prop.z, prop.yaw, prop.width, prop.depth, prop.height].every(Number.isFinite), `${prop.id}: finite geometry`);
    assert.ok(prop.width > 0 && prop.depth > 0 && prop.height > 0, `${prop.id}: solid dimensions`);
    const extentX = (Math.abs(Math.cos(prop.yaw)) * prop.width + Math.abs(Math.sin(prop.yaw)) * prop.depth) / 2;
    const extentZ = (Math.abs(Math.sin(prop.yaw)) * prop.width + Math.abs(Math.cos(prop.yaw)) * prop.depth) / 2;
    assert.ok(Math.abs(prop.x) + extentX < world.size / 2 - 1 && Math.abs(prop.z) + extentZ < world.size / 2 - 1, `${prop.id}: usable map boundary`);
    for (const other of solids) {
      if (other === prop) continue;
      assert.equal(boxIntersects(prop, other, 0.1), false, `${prop.id} crowds ${other.id}`);
    }
    for (const car of vehicles) assert.equal(boxIntersects(prop, car, 0.1), false, `${prop.id} blocks ${car.id}`);
  }
});

test('furniture preserves complete pedestrian loops, promenades and the physical mission approaches', () => {
  const world = createWorld();
  const added = furniture(world.obstacles);
  assert.ok(added.length > 0);
  const routes = new Map(createPedestrians(world).map(person => [JSON.stringify(person.route), person.route]));
  for (const [key, route] of routes) assertPathClear([...route, route[0]], 0.48, added, `walking loop ${key}`);
  for (const line of [-131, 131]) {
    assertPathClear([{ x: line, z: -142 }, { x: line, z: 142 }], 0.75, added, `original X promenade ${line}`);
    assertPathClear([{ x: -142, z: line }, { x: 142, z: line }], 0.75, added, `original Z promenade ${line}`);
  }
  assertPathClear([{ x: 13, z: 36 }, { x: 13, z: 40 }, { x: 8, z: 40 }], 0.48, added, 'courier pickup and entry');
  assertPathClear([
    { x: 13, z: 36 }, { x: 13, z: -68.7 }, { x: -68.7, z: -68.7 },
    { x: -68.7, z: -91.3 }, { x: -91.3, z: -91.3 }, { x: -91.3, z: -110 }, world.restricted,
  ], 0.48, added, 'on-foot approach to the restricted depot');
  const plaza = { x: 22.5, z: 40, width: 29, depth: 30, yaw: 0 };
  for (const prop of added) {
    assert.equal(boxIntersects(prop, plaza), false, `${prop.id}: dispatch plaza`);
    assert.equal(circleIntersectsBox(13, 36, 1, prop), false, `${prop.id}: player spawn`);
    assert.equal(circleIntersectsBox(world.restricted.x, world.restricted.z, 17, prop), false, `${prop.id}: restricted depot access`);
    assert.equal(circleIntersectsBox(world.destination.x, world.destination.z, 7, prop), false, `${prop.id}: delivery zone`);
  }
});