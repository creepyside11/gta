import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, boxIntersects, circleIntersectsBox, clamp, dist } from '../src/game/collision.ts';
import type { Box } from '../src/game/collision.ts';
import { createWorld } from '../src/game/world.ts';

const unitBox: Box = { x: 0, z: 0, width: 2, depth: 2, yaw: 0 };

test('OBB collision includes touching edges and rejects a real gap', () => {
  assert.equal(boxIntersects(unitBox, { ...unitBox, x: 2 }), true);
  assert.equal(boxIntersects(unitBox, { ...unitBox, x: 2.001 }), false);
  assert.equal(boxIntersects(unitBox, { ...unitBox, x: 2, z: 2 }), true);
  assert.equal(boxIntersects(unitBox, { ...unitBox, x: 2.1 }, .06), true);
});

test('parallel rotated boxes can have overlapping AABBs while their OBBs are separate', () => {
  const diagonal: Box = { x: 0, z: 0, width: 1, depth: 8, yaw: Math.PI / 4 };
  const acrossWidth = (distance: number): Box => ({
    ...diagonal, x: distance / Math.SQRT2, z: -distance / Math.SQRT2,
  });
  // Each world-axis half extent exceeds 3; these center offsets are under 1.
  assert.equal(boxIntersects(diagonal, acrossWidth(1.2)), false);
  assert.equal(boxIntersects(diagonal, acrossWidth(.8)), true);
  assert.equal(boxIntersects(diagonal, acrossWidth(1)), true);
  assert.equal(boxIntersects(acrossWidth(1.2), diagonal), false);
});

test('crossing rotated vehicles intersect and a rotated long axis follows Three.js yaw', () => {
  const thin: Box = { x: 0, z: 0, width: 1, depth: 8, yaw: Math.PI / 4 };
  assert.equal(boxIntersects(thin, { ...thin, yaw: -Math.PI / 4 }), true);
  const sideways = { ...thin, yaw: Math.PI / 2 };
  assert.equal(boxIntersects(sideways, { ...unitBox, x: 4.5 }), true);
  assert.equal(boxIntersects(sideways, { ...unitBox, z: 2 }), false);
  assert.equal(boxIntersects(sideways, { ...unitBox, x: 5.01 }), false);
});

test('circle collision uses the actual corner distance instead of an expanded rectangle', () => {
  assert.equal(circleIntersectsBox(1.6, 1.8, 1, unitBox), true);
  assert.equal(circleIntersectsBox(1.6, 1.8, .999, unitBox), false);
  assert.equal(circleIntersectsBox(1.8, 1.8, 1, unitBox), false);
  assert.equal(circleIntersectsBox(2, 0, 1, unitBox), true);
  assert.equal(circleIntersectsBox(0, 0, 0, unitBox), true);
});

test('translated and rotated box corners give correct circle contacts in world coordinates', () => {
  const rotated: Box = { x: 7, z: -9, width: 6, depth: 8, yaw: Math.PI / 3 };
  const x = 7 + 3.6 * Math.cos(rotated.yaw) + 4.8 * Math.sin(rotated.yaw);
  const z = -9 - 3.6 * Math.sin(rotated.yaw) + 4.8 * Math.cos(rotated.yaw);
  assert.equal(circleIntersectsBox(x, z, 1, rotated), true);
  assert.equal(circleIntersectsBox(x, z, .99, rotated), false);
  assert.equal(circleIntersectsBox(7, -9, .1, rotated), true);
});

test('angleDelta takes the short signed route through the negative/positive pi seam', () => {
  assert.ok(Math.abs(angleDelta(Math.PI - .1, -Math.PI + .1) - .2) < 1e-10);
  assert.ok(Math.abs(angleDelta(-Math.PI + .1, Math.PI - .1) + .2) < 1e-10);
  assert.ok(Math.abs(angleDelta(0, Math.PI * 4 + .3) - .3) < 1e-10);
  assert.equal(angleDelta(1.2, 1.2), 0);
});

test('distance and clamp work across negative city coordinates', () => {
  assert.equal(dist({ x: -3, z: -4 }, { x: 0, z: 0 }), 5);
  assert.equal(clamp(-8, -5, 5), -5);
  assert.equal(clamp(8, -5, 5), 5);
  assert.equal(clamp(-2, -5, 5), -2);
});

test('the world is deterministic, has unique collider IDs, and all solids fit inside its bounds', () => {
  const world = createWorld();
  assert.deepEqual(world, createWorld());
  const solids = [...world.buildings, ...world.obstacles];
  assert.ok(world.buildings.length >= 30);
  assert.ok(world.obstacles.length >= 20);
  assert.equal(new Set(solids.map(solid => solid.id)).size, solids.length);
  for (const solid of solids) {
    const extentX = (Math.abs(Math.cos(solid.yaw)) * solid.width + Math.abs(Math.sin(solid.yaw)) * solid.depth) / 2;
    const extentZ = (Math.abs(Math.sin(solid.yaw)) * solid.width + Math.abs(Math.cos(solid.yaw)) * solid.depth) / 2;
    assert.ok(solid.width > 0 && solid.depth > 0 && solid.height > 0, solid.id);
    assert.ok(Math.abs(solid.x) + extentX < world.size / 2, `${solid.id}: X bound`);
    assert.ok(Math.abs(solid.z) + extentZ < world.size / 2, `${solid.id}: Z bound`);
  }
});

test('every road and its full adjacent sidewalks are free of solid footprints', () => {
  const world = createWorld();
  const solids = [...world.buildings, ...world.obstacles];
  for (const road of world.roads) {
    const streetAndSidewalks = world.roadWidth + 3.5 * 2;
    const northSouth: Box = { x: road, z: 0, width: streetAndSidewalks, depth: world.size, yaw: 0 };
    const eastWest: Box = { x: 0, z: road, width: world.size, depth: streetAndSidewalks, yaw: 0 };
    for (const solid of solids) {
      assert.equal(boxIntersects(solid, northSouth), false, `${solid.id}: street X=${road}`);
      assert.equal(boxIntersects(solid, eastWest), false, `${solid.id}: street Z=${road}`);
    }
  }
});

test('pedestrian sidewalks and the original perimeter promenades have body clearance', () => {
  const world = createWorld();
  const routes = [
    ...world.roads.flatMap(road => [road - 11.3, road + 11.3]).map(line => ({ line, length: world.size })),
    // The former waterfront promenade keeps its original extent as the city grows.
    ...[-131, 131].map(line => ({ line, length: 284 })),
  ];
  for (const solid of [...world.buildings, ...world.obstacles]) {
    for (const { line, length } of routes) {
      assert.equal(boxIntersects(solid, { x: line, z: 0, width: 1.5, depth: length, yaw: 0 }), false, `${solid.id}: sidewalk X=${line}`);
      assert.equal(boxIntersects(solid, { x: 0, z: line, width: length, depth: 1.5, yaw: 0 }), false, `${solid.id}: sidewalk Z=${line}`);
    }
  }
});

test('pickup plaza, player spawn, mission car and restricted circle are unobstructed', () => {
  const world = createWorld();
  const pickupPlaza: Box = { x: 22.5, z: 40, width: 25, depth: 26, yaw: 0 };
  const missionCar: Box = { x: 6, z: 40, width: 2.3, depth: 4.5, yaw: 0 };
  for (const solid of [...world.buildings, ...world.obstacles]) {
    assert.equal(boxIntersects(solid, pickupPlaza), false, `${solid.id}: pickup plaza`);
    assert.equal(circleIntersectsBox(13, 36, 1, solid), false, `${solid.id}: spawn`);
    assert.equal(boxIntersects(solid, missionCar), false, `${solid.id}: mission car`);
    assert.equal(circleIntersectsBox(world.restricted.x, world.restricted.z, 16, solid), false, `${solid.id}: restricted plaza`);
  }
});

test('buildings never overlap and garden colliders are outside buildings', () => {
  const world = createWorld();
  world.buildings.forEach((building, index) => {
    for (const other of world.buildings.slice(index + 1)) {
      assert.equal(boxIntersects(building, other), false, `${building.id} overlaps ${other.id}`);
    }
    for (const obstacle of world.obstacles) {
      assert.equal(boxIntersects(building, obstacle), false, `${obstacle.id} inside ${building.id}`);
    }
  });
});
