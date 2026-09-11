import assert from 'node:assert/strict';
import test from 'node:test';
import { boxIntersects } from '../src/game/collision.ts';
import { createWorld } from '../src/game/world.ts';

test('the metro map is dramatically larger while keeping the original street scale and mission locations', () => {
  const world = createWorld();
  assert.equal(world.size, 960);
  assert.ok(world.size ** 2 / (284 * Math.SQRT2) ** 2 > 5.5, 'the playable land area grows by more than five times');
  assert.equal(world.roadWidth, 18);
  assert.deepEqual(world.roads, [-400, -320, -160, -80, 0, 80, 160, 320, 400]);
  assert.deepEqual(world.pickup, { x: 14, z: 40 });
  assert.deepEqual(world.destination, { x: 80, z: -58 });
  assert.deepEqual(world.restricted, { x: -100, z: -110, radius: 14 });
  assert.deepEqual(world.districts?.map(district => district.name), ['PORTSIDE', 'VICE BEACH', 'WEST HARBOR', 'NORTHSIDE', 'SUNPORT']);
  assert.deepEqual(new Set(world.districts?.map(district => district.kind)), new Set(['downtown', 'beach', 'industrial', 'residential', 'airport']));
});

test('the original downtown survives intact while four satellite cities add distinct skylines', () => {
  const world = createWorld();
  const original = world.buildings.filter(building => !building.architecture);
  const added = world.buildings.filter(building => building.architecture);
  assert.equal(original.length, 41, 'the original downtown buildings remain');
  assert.ok(added.length >= original.length * 2, 'the regional cities substantially increase the building count');
  assert.deepEqual(new Set(added.map(building => building.architecture)),
    new Set(['apartment', 'warehouse', 'office', 'townhouse', 'supermarket', 'civic']));
  assert.ok(world.obstacles.length >= 96, 'trees and street furniture remain dense in the enlarged world');
  assert.ok(added.some(building => building.height >= 25), 'satellite downtowns add tall skyline buildings');
  assert.ok(added.some(building => building.height <= 8), 'shops and houses provide low-rise neighborhoods');

  for (const district of world.districts?.filter(district => district.id !== 'portside-core') ?? []) {
    const buildings = world.buildings.filter(building => building.id.startsWith(`metro-${district.id}-building-`));
    assert.ok(buildings.length >= 8, `${district.name} needs a real cluster of buildings`);
    assert.ok(buildings.some(building => building.label), `${district.name} needs a named landmark`);
  }
});

test('every satellite direction contains a separate dense city beyond the former island', () => {
  const world = createWorld();
  const satellites = world.districts?.filter(district => district.id !== 'portside-core') ?? [];
  assert.equal(satellites.length, 4);
  for (const district of satellites) {
    assert.ok(Math.max(Math.abs(district.x), Math.abs(district.z)) >= 320);
    const nearbyBuildings = world.buildings.filter(building =>
      Math.abs(building.x - district.x) <= district.width / 2 + 20 && Math.abs(building.z - district.z) <= district.depth / 2 + 20);
    assert.ok(nearbyBuildings.length >= 8, `${district.name} must read as a separate city`);
  }
});

test('new metro solids fit their blocks without overlapping roads, buildings or pedestrian reserves', () => {
  const world = createWorld();
  const solids = [...world.buildings, ...world.obstacles];
  for (const solid of solids.filter(item => item.id.startsWith('metro-'))) {
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