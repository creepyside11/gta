import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/game/simulation';
import { NO_INPUT } from '../src/game/types';
import { boxIntersects, dist } from '../src/game/collision';
import { planTrafficBypass } from '../src/game/traffic';

function scene(model = 'sedan') {
  const sim = new Simulation(); sim.world.buildings = []; sim.world.obstacles = [];
  sim.world.roads = [0]; sim.world.roadWidth = 18; sim.state.pedestrians = []; sim.state.officers = [];
  sim.state.player.x = 50; sim.state.player.z = 50;
  const car = sim.state.vehicles.find(v => v.kind === 'traffic' && v.model === model)!;
  const obstacle = sim.state.vehicles.find(v => v.id === 'parked-coral')!;
  Object.assign(car, { x: 0, z: -25, yaw: 0, speed: 0, active: true, route: [{ x: 0, z: -100 }, { x: 0, z: 100 }], waypoint: 1 });
  Object.assign(obstacle, { x: 0, z: 0, yaw: 0, speed: 0, active: true });
  sim.state.vehicles = [car, obstacle];
  return { sim, car, obstacle };
}
for (const model of ['sedan', 'truck']) test(`${model} bypasses a parked car and returns to its lane without impact or teleport`, () => {
  const { sim, car, obstacle } = scene(model);
  assert.ok(planTrafficBypass(sim.world, sim.state, car, obstacle));
  let side = 0;
  for (let i = 0; i < 25 * 60 && car.z < 22; i++) {
    const before = { x: car.x, z: car.z }; sim.step(1 / 60, NO_INPUT);
    assert.ok(dist(before, car) < .3); assert.ok(!boxIntersects(car, obstacle));
    side = Math.max(side, Math.abs(car.x));
  }
  assert.ok(car.z > 22, `stuck: ${JSON.stringify(car)}`);
  assert.ok(side > 3); assert.ok(Math.abs(car.x) < .6);
  assert.equal(obstacle.x, 0); assert.equal(obstacle.z, 0); assert.equal(obstacle.damage, undefined);
});

test('full-width blocked road has no bypass and a waiting driver resumes once cleared', () => {
  const { sim, car, obstacle } = scene(); obstacle.width = 17;
  assert.equal(planTrafficBypass(sim.world, sim.state, car, obstacle), null);
  for (let i = 0; i < 8 * 60; i++) { sim.step(1 / 60, NO_INPUT); assert.ok(!boxIntersects(car, obstacle)); }
  assert.ok(car.z < -4); assert.ok(Math.abs(car.x) < .01);
  obstacle.active = false;
  for (let i = 0; i < 8 * 60; i++) sim.step(1 / 60, NO_INPUT);
  assert.ok(car.z > 10);
});

test('occupied passing lanes are rejected; parked player vehicle is also avoided', () => {
  const { sim, car, obstacle } = scene();
  sim.state.player.vehicleId = obstacle.id;
  assert.ok(planTrafficBypass(sim.world, sim.state, car, obstacle));
  const left = { ...obstacle, id: 'oncoming-left', x: -4, z: -2, yaw: Math.PI, speed: 8 };
  const right = { ...left, id: 'oncoming-right', x: 4 };
  sim.state.vehicles.push(left, right);
  assert.equal(planTrafficBypass(sim.world, sim.state, car, obstacle), null);
});

test('a pedestrian entering the bypass stops the car without being hit', () => {
  const { sim, car } = scene();
  for (let i = 0; i < 3 * 60; i++) sim.step(1 / 60, NO_INPUT);
  const x = car.x + Math.sin(car.yaw) * 7, z = car.z + Math.cos(car.yaw) * 7;
  sim.state.player.vehicleId = null; sim.state.player.x = x; sim.state.player.z = z;
  for (let i = 0; i < 2 * 60; i++) { sim.step(1 / 60, NO_INPUT); assert.ok(dist(car, sim.state.player) > 2); }
});

test('a car stopped close to a bumper makes room safely before going around', () => {
  const { sim, car, obstacle } = scene(); car.z = -8; car.speed = 0;
  let backedUp = false;
  for (let i = 0; i < 35 * 60 && car.z < 20; i++) {
    const before = { x: car.x, z: car.z }; sim.step(1 / 60, NO_INPUT);
    backedUp ||= car.z < -10;
    assert.ok(dist(before, car) < .3); assert.ok(!boxIntersects(car, obstacle));
  }
  assert.ok(backedUp); assert.ok(car.z > 20, `failed close recovery: ${car.x}, ${car.z}`);
  assert.equal(obstacle.damage, undefined);
});
