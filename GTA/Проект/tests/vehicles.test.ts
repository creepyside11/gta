import assert from 'node:assert/strict';
import test from 'node:test';
import { boxIntersects, circleIntersectsBox, dist } from '../src/game/collision.ts';
import { Simulation } from '../src/game/simulation.ts';
import { NO_INPUT, type InputFrame, type Vehicle } from '../src/game/types.ts';

const ROAD_MODELS = ['sedan', 'truck', 'pickup', 'hatchback', 'sport'] as const;
const FOOT_RADIUS = 0.48;

function advance(sim: Simulation, seconds: number, input: Partial<InputFrame> = {}): void {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) sim.step(1 / 60, { ...NO_INPUT, ...input });
}

/** Keep an actual road vehicle and its model while arranging a clear test scene. */
function isolateTraffic(sim: Simulation, model: Vehicle['model'], x = 0, z = 0, yaw = 0): Vehicle {
  const car = sim.state.vehicles.find(v => v.kind === 'traffic' && v.model === model);
  assert.ok(car, `${model} must appear in the road fleet`);
  for (const other of sim.state.vehicles) other.active = false;
  sim.state.pedestrians = [];
  Object.assign(car, { x, z, yaw, speed: 0, active: true });
  const beside = car.width / 2 + FOOT_RADIUS + 0.15;
  Object.assign(sim.state.player, {
    x: x + Math.cos(yaw) * beside,
    z: z - Math.sin(yaw) * beside,
    yaw, vehicleId: null,
  });
  return car;
}

test('the live road fleet includes all five body models with clear spawn footprints', () => {
  const sim = new Simulation();
  const traffic = sim.state.vehicles.filter(v => v.kind === 'traffic' && v.active);
  assert.deepEqual(new Set(traffic.map(v => v.model)), new Set(ROAD_MODELS));
  const active = sim.state.vehicles.filter(v => v.active);
  for (const [index, car] of active.entries()) {
    assert.ok(![...sim.world.buildings, ...sim.world.obstacles].some(solid => boxIntersects(car, solid)), `${car.id} spawns inside scenery`);
    assert.ok(!circleIntersectsBox(sim.state.player.x, sim.state.player.z, FOOT_RADIUS, car), `${car.id} spawns over the player`);
    for (const other of active.slice(index + 1)) assert.ok(!boxIntersects(car, other), `${car.id} spawns inside ${other.id}`);
  }
});

for (const model of ROAD_MODELS) {
  test(`${model} can be borrowed, driven, exited and entered again without changing its body`, () => {
    const sim = new Simulation();
    const car = isolateTraffic(sim, model, 0, 0, Math.PI / 2);
    const body = { model: car.model, width: car.width, depth: car.depth, color: car.color };
    const start = { x: car.x, z: car.z };
    assert.ok(car.route.length > 0, 'the borrowed vehicle starts as working traffic');
    sim.interact();
    assert.equal(sim.state.player.vehicleId, car.id);
    assert.equal(car.kind, 'parked');
    assert.deepEqual(car.route, []);
    advance(sim, 1, { forward: 1 });
    assert.ok(car.speed > 5);
    assert.ok(dist(car, start) > 3, 'the selected model must actually drive');
    sim.interact();
    assert.equal(sim.state.player.vehicleId, car.id, 'exit remains blocked at speed');
    advance(sim, 1, { brake: true });
    assert.equal(car.speed, 0);
    for (let repeat = 0; repeat < 3; repeat++) {
      sim.interact();
      assert.equal(sim.state.player.vehicleId, null);
      assert.ok(!circleIntersectsBox(sim.state.player.x, sim.state.player.z, FOOT_RADIUS, car), 'exiting clears the rotated body');
      sim.interact();
      assert.equal(sim.state.player.vehicleId, car.id);
    }
    assert.deepEqual({ model: car.model, width: car.width, depth: car.depth, color: car.color }, body);
    const parked = { x: car.x, z: car.z, yaw: car.yaw };
    sim.restartMission();
    assert.deepEqual({ x: car.x, z: car.z, yaw: car.yaw }, parked, 'mission restart preserves the borrowed vehicle');
    assert.equal(car.model, model);
  });
}

test('a truck with blocked sides offers a clear rear exit and can be entered there again', () => {
  const sim = new Simulation();
  const truck = isolateTraffic(sim, 'truck');
  sim.interact();
  assert.equal(sim.state.player.vehicleId, truck.id);
  sim.world.obstacles.push(...[-1, 1].map(side => ({
    id: `test-garage-wall-${side}`, kind: 'barrier' as const,
    x: side * (truck.width / 2 + 1), z: 0, yaw: 0,
    width: 0.8, depth: truck.depth + 1, height: 2, color: '#777777',
  })));
  sim.interact();
  assert.equal(sim.state.player.vehicleId, null, 'the longer truck must have a usable fallback exit');
  const p = sim.state.player;
  assert.ok(p.z < -truck.depth / 2, 'the fallback places the player behind the actual cargo body');
  for (const solid of [truck, ...sim.world.obstacles]) assert.ok(!circleIntersectsBox(p.x, p.z, FOOT_RADIUS, solid));
  sim.interact();
  assert.equal(sim.state.player.vehicleId, truck.id, 'a player standing at the rear can enter the truck again');
});

test('the long truck nose stops at a facade without cargo body penetration', () => {
  const sim = new Simulation();
  const truck = isolateTraffic(sim, 'truck', 24, 7, 0);
  const facade = sim.world.buildings.find(solid => solid.x === 24 && solid.z === 20)!;
  assert.ok(facade);
  assert.ok(!boxIntersects(truck, facade));
  sim.interact();
  assert.equal(sim.state.player.vehicleId, truck.id);
  advance(sim, 2, { forward: 1 });
  assert.ok(sim.state.collisions > 0);
  assert.ok(truck.z + truck.depth / 2 < facade.z - facade.depth / 2);
  assert.ok(!boxIntersects(truck, facade));
  truck.speed = 29;
  sim.step(2, { ...NO_INPUT, forward: 1 });
  assert.ok(!boxIntersects(truck, facade), 'a stalled frame must respect the full truck collider');
});
