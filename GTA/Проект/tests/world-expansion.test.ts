import assert from 'node:assert/strict';
import test from 'node:test';
import { boxIntersects } from '../src/game/collision.ts';
import { createWorld } from '../src/game/world.ts';

test('the expanded city doubles playable area while keeping the original street scale and mission locations', () => {
  const world = createWorld();
  assert.ok(Math.abs(world.size ** 2 / 284 ** 2 - 2) < 1e-12);
  assert.equal(world.roadWidth, 18);
  assert.deepEqual(world.roads, [-160, -80, 0, 80, 160]);
  assert.deepEqual(world.pickup, { x: 14, z: 40 });
  assert.deepEqual(world.destination, { x: 80, z: -58 });
  assert.deepEqual(world.restricted, { x: -100, z: -110, radius: 14 });
});

test('all new architecture types populate the added districts at the original city density', () => {
  const world = createWorld();
  const original = world.buildings.filter(building => !building.architecture);
  const added = world.buildings.filter(building => building.architecture);
  assert.equal(original.length, 41, 'the original downtown buildings remain');
  assert.ok(added.length >= original.length, 'new land has at least as many buildings as the original city');
  assert.deepEqual(new Set(added.map(building => building.architecture)),
    new Set(['apartment', 'warehouse', 'office', 'townhouse', 'supermarket', 'civic']));
  assert.ok(world.obstacles.length >= 48 * 2, 'trees and street furniture grow with the city area');
  for (const type of ['tree', 'planter', 'bench', 'bin']) {
    assert.ok(world.obstacles.some(obstacle => obstacle.id.startsWith('district-') && obstacle.kind === type), `new districts need ${type} props`);
  }
  assert.ok(added.some(building => building.height >= 24), 'office towers add a taller skyline');
  assert.ok(added.some(building => building.height <= 8), 'shops and houses provide low buildings');
});

test('every side of the expanded island contains dense buildings and usable landscaped space', () => {
  const world = createWorld();
  for (const axis of ['x', 'z'] as const) {
    for (const sign of [-1, 1]) {
      assert.ok(world.buildings.filter(building => building[axis] * sign > 170).length >= 10, `${axis}/${sign}: buildings`);
      assert.ok(world.obstacles.filter(obstacle => obstacle[axis] * sign > 170).length >= 12, `${axis}/${sign}: street furniture`);
    }
  }
});

test('new district solids fit their lots without overlapping old or new buildings and props', () => {
  const world = createWorld();
  const solids = [...world.buildings, ...world.obstacles];
  for (const solid of solids.filter(item => item.id.startsWith('district-'))) {
    for (const other of solids) {
      if (solid === other) continue;
      assert.equal(boxIntersects(solid, other, .1), false, `${solid.id} crowds ${other.id}`);
    }
    const extentX = (Math.abs(Math.cos(solid.yaw)) * solid.width + Math.abs(Math.sin(solid.yaw)) * solid.depth) / 2;
    const extentZ = (Math.abs(Math.sin(solid.yaw)) * solid.width + Math.abs(Math.cos(solid.yaw)) * solid.depth) / 2;
    for (const road of world.roads) {
      assert.ok(Math.abs(solid.x - road) - extentX >= 12.8, `${solid.id} blocks X sidewalk ${road}`);
      assert.ok(Math.abs(solid.z - road) - extentZ >= 12.8, `${solid.id} blocks Z sidewalk ${road}`);
    }
  }
});
