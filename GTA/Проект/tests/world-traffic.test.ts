import test from 'node:test';
import assert from 'node:assert/strict';
import { createPedestrians, createVehicles, routeToTarget } from '../src/game/ai';
import { boxIntersects, circleIntersectsBox, dist } from '../src/game/collision';
import { Simulation } from '../src/game/simulation';
import { NO_INPUT, type InputFrame } from '../src/game/types';
import { createWorld } from '../src/game/world';

function advance(sim: Simulation, seconds: number, input: Partial<InputFrame> = {}): void {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) sim.step(1 / 60, { ...NO_INPUT, ...input });
}

test('the expanded city has deterministic traffic and clear pedestrians in every outer district', () => {
  const world = createWorld();
  const vehicles = createVehicles(world);
  const pedestrians = createPedestrians(world);
  assert.deepEqual(createVehicles(), vehicles);
  assert.deepEqual(createPedestrians(), pedestrians);
  assert.equal(vehicles.filter(v => v.kind === 'traffic').length, 16);
  assert.equal(vehicles.filter(v => v.kind === 'parked').length, 7);
  assert.equal(pedestrians.length, 72);
  assert.equal(new Set(vehicles.map(v => v.id)).size, vehicles.length);
  assert.equal(new Set(pedestrians.map(p => p.id)).size, pedestrians.length);
  const addedTraffic = vehicles.filter(v => v.kind === 'traffic' && Number(v.id.slice(8)) >= 8);
  assert.deepEqual(new Set(addedTraffic.map(v => v.model)), new Set(['sedan', 'truck', 'pickup', 'hatchback', 'sport']));
  for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
    assert.ok(addedTraffic.some(v => v[axis] * side > 142));
    assert.ok(pedestrians.some(p => p[axis] * side > 142));
    assert.ok(vehicles.some(v => v.kind === 'parked' && v[axis] * side > 142));
  }
  const solids = [...world.buildings, ...world.obstacles];
  const active = vehicles.filter(v => v.active);
  for (const [index, car] of active.entries()) {
    assert.ok(solids.every(solid => !boxIntersects(car, solid)), `${car.id} must clear scenery`);
    assert.ok(active.slice(index + 1).every(other => !boxIntersects(car, other)), `${car.id} must clear other vehicles`);
  }
  for (const pedestrian of pedestrians) {
    assert.ok(active.every(car => !circleIntersectsBox(pedestrian.x, pedestrian.z, 0.36, car)), `${pedestrian.id} spawns clear of vehicles`);
    for (const [index, start] of pedestrian.route.entries()) {
      const end = pedestrian.route[(index + 1) % pedestrian.route.length];
      const steps = Math.ceil(dist(start, end));
      for (let step = 0; step <= steps; step++) {
        const x = start.x + (end.x - start.x) * step / steps;
        const z = start.z + (end.z - start.z) * step / steps;
        assert.ok(Math.abs(x) + 0.36 < world.size / 2 - 1 && Math.abs(z) + 0.36 < world.size / 2 - 1);
        assert.ok(world.roads.every(road => Math.abs(x - road) > world.roadWidth / 2 && Math.abs(z - road) > world.roadWidth / 2), `${pedestrian.id} stays on pavements`);
        assert.ok(solids.every(solid => !circleIntersectsBox(x, z, 0.36, solid)), `${pedestrian.id} has a continuous clear walking loop`);
      }
    }
  }
});

test('perimeter traffic makes continuous progress around the enlarged road loop', () => {
  const sim = new Simulation();
  const traffic = sim.state.vehicles.filter(v => v.kind === 'traffic' && Number(v.id.slice(8)) >= 8);
  const distance = new Map(traffic.map(v => [v.id, 0]));
  const pedestrians = sim.state.pedestrians.filter(p => Number(p.id.slice(4)) >= 20);
  const walkingStarts = new Map(pedestrians.map(p => [p.id, { x: p.x, z: p.z }]));
  for (let frame = 0; frame < 40 * 60; frame++) {
    const before = new Map(traffic.map(v => [v.id, { x: v.x, z: v.z }]));
    sim.step(1 / 60, NO_INPUT);
    for (const car of traffic) {
      const delta = dist(car, before.get(car.id)!);
      assert.ok(delta < 0.2, `${car.id} must move without teleporting`);
      distance.set(car.id, distance.get(car.id)! + delta);
      assert.ok(Number.isFinite(car.speed));
    }
  }
  for (const car of traffic) assert.ok(distance.get(car.id)! > 250, `${car.id} must keep circulating through outer districts`);
  assert.ok(pedestrians.every(p => dist(p, walkingStarts.get(p.id)!) > 5), 'the added residents must walk their neighborhood loops');
});

test('road routing can reach every new map edge and clamps to the current boundary', () => {
  const world = createWorld();
  const edge = world.size / 2 - world.roadWidth / 2 - 1;
  const outerRoad = Math.max(...world.roads);
  for (const side of [-1, 1]) for (const horizontal of [false, true]) {
    const target = horizontal ? { x: side * (edge - 1), z: outerRoad } : { x: outerRoad, z: side * (edge - 1) };
    const route = routeToTarget({ x: 0, z: -70 }, target, world);
    assert.deepEqual(route.at(-1), target, 'the destination must not be clipped at the old world edge');
    for (const point of route) {
      assert.ok(Math.abs(point.x) <= edge && Math.abs(point.z) <= edge);
      assert.ok(world.roads.includes(point.x) || world.roads.includes(point.z));
    }
  }
  const beyond = routeToTarget({ x: 0, z: 0 }, { x: 1000, z: outerRoad }, world);
  assert.deepEqual(beyond.at(-1), { x: edge, z: outerRoad });
});

test('police can dispatch and advance toward an incident beyond the former city boundary', () => {
  const sim = new Simulation();
  const outerRoad = Math.max(...sim.world.roads);
  const target = { x: outerRoad, z: sim.world.size / 2 - 17 };
  Object.assign(sim.state.player, target);
  sim.world.restricted = { ...target, radius: 8 };
  sim.step(1 / 60, NO_INPUT);
  assert.equal(sim.state.police.wanted, 1);
  const units = sim.state.vehicles.filter(v => v.kind === 'police' && v.active);
  assert.equal(units.length, 3);
  const starts = new Map(units.map(v => [v.id, { x: v.x, z: v.z }]));
  assert.ok(units.every(v => dist(v, target) > 40 && dist(v, target) < sim.world.size / 2),
    'three nearby units dispatch with space for concealed approaches');
  assert.ok(units.every(v => v.route.some(point => Math.max(Math.abs(point.x), Math.abs(point.z)) > 142)));
  advance(sim, 5);
  assert.ok(units.every(v => dist(v, starts.get(v.id)!) > 8), 'outer patrols follow their road routes');
  assert.ok(units.some(v => dist(v, target) < 45), 'a patrol must close distance to the outer incident');
});

test('a truck reaches the new boundary, stops safely, and supports exit/reentry and mission reset', () => {
  const sim = new Simulation();
  const truck = sim.state.vehicles.find(v => v.id === 'parked-east')!;
  assert.ok(truck && truck.model === 'truck');
  for (const car of sim.state.vehicles) car.active = car === truck;
  sim.state.pedestrians = [];
  Object.assign(truck, { x: Math.max(...sim.world.roads), z: sim.world.size / 2 - 15, yaw: 0, speed: 0 });
  Object.assign(sim.state.player, { x: truck.x + truck.width / 2 + 0.7, z: truck.z, vehicleId: null });
  sim.interact();
  assert.equal(sim.state.player.vehicleId, truck.id);
  advance(sim, 3, { forward: 1 });
  advance(sim, 1, { brake: true });
  assert.ok(truck.z > 180 && truck.z + truck.depth / 2 < sim.world.size / 2 - 1);
  assert.ok(sim.state.collisions > 0);
  sim.interact();
  assert.equal(sim.state.player.vehicleId, null);
  assert.ok(!circleIntersectsBox(sim.state.player.x, sim.state.player.z, 0.48, truck));
  sim.interact();
  assert.equal(sim.state.player.vehicleId, truck.id);
  const parked = { x: truck.x, z: truck.z, yaw: truck.yaw };
  sim.restartMission();
  assert.deepEqual({ x: truck.x, z: truck.z, yaw: truck.yaw }, parked);
  assert.equal(sim.state.player.vehicleId, null);
  assert.equal(sim.state.mission.phase, 'available');
  assert.ok(dist(sim.state.player, { x: 13, z: 36 }) < 3);
});
