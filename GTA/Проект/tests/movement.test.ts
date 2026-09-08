import assert from 'node:assert/strict';
import test from 'node:test';
import { circleIntersectsBox, dist } from '../src/game/collision.ts';
import { Simulation } from '../src/game/simulation.ts';
import { NO_INPUT, type InputFrame } from '../src/game/types.ts';

function advance(sim: Simulation, seconds: number, input: Partial<InputFrame> = {}): void {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) sim.step(1 / 60, { ...NO_INPUT, ...input });
}

function clearRoad(): Simulation {
  const sim = new Simulation();
  for (const car of sim.state.vehicles) car.active = false;
  sim.state.pedestrians = [];
  Object.assign(sim.state.player, { x: 0, z: 0 });
  return sim;
}

test('WASD moves in screen directions for every cardinal camera heading', () => {
  const headings = [
    { yaw: 0, forward: { x: 0, z: 1 }, right: { x: -1, z: 0 } },
    { yaw: Math.PI / 2, forward: { x: 1, z: 0 }, right: { x: 0, z: 1 } },
    { yaw: Math.PI, forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } },
    { yaw: -Math.PI / 2, forward: { x: -1, z: 0 }, right: { x: 0, z: -1 } },
  ];
  for (const heading of headings) {
    for (const key of ['W', 'A', 'S', 'D']) {
      const sim = clearRoad();
      const forward = key === 'W' ? 1 : key === 'S' ? -1 : 0;
      const turn = key === 'D' ? 1 : key === 'A' ? -1 : 0;
      advance(sim, 0.5, { forward, turn, viewYaw: heading.yaw });
      const expectedX = (forward * heading.forward.x + turn * heading.right.x) * 2.6;
      const expectedZ = (forward * heading.forward.z + turn * heading.right.z) * 2.6;
      assert.ok(Math.abs(sim.state.player.x - expectedX) < 1e-10, `${key} x with camera ${heading.yaw}`);
      assert.ok(Math.abs(sim.state.player.z - expectedZ) < 1e-10, `${key} z with camera ${heading.yaw}`);
      assert.ok(Math.sin(sim.state.player.yaw) * expectedX + Math.cos(sim.state.player.yaw) * expectedZ > 2.59,
        'the avatar should face its movement direction');
    }
  }
});

test('rotating the camera redirects forward movement immediately without requiring an avatar turn', () => {
  const sim = clearRoad();
  advance(sim, 0.25, { forward: 1, viewYaw: Math.PI });
  const before = { ...sim.state.player };
  sim.step(1 / 60, { ...NO_INPUT, forward: 1, viewYaw: Math.PI / 2 });
  assert.ok(sim.state.player.x > before.x + 0.08);
  assert.ok(Math.abs(sim.state.player.z - before.z) < 1e-10);
});

test('diagonal input keeps normal walking and sprint speeds at arbitrary camera headings', () => {
  for (const viewYaw of [0.37, -1.7, Math.PI]) {
    for (const sprint of [false, true]) {
      for (const turn of [0, 1, -1]) {
        const sim = clearRoad();
        advance(sim, 0.5, { forward: 1, turn, sprint, viewYaw });
        assert.ok(Math.abs(dist(sim.state.player, { x: 0, z: 0 }) - (sprint ? 4 : 2.6)) < 1e-10);
      }
    }
  }
});

test('camera-relative movement stops at a real facade and slides along it', () => {
  const sim = new Simulation();
  advance(sim, 16 / 5.2, { forward: 1 });
  advance(sim, 3, { forward: 1, viewYaw: Math.PI / 2 });
  assert.ok(sim.state.player.x < 16.53 && sim.state.player.x > 16.3);
  const beforeZ = sim.state.player.z;
  advance(sim, 0.5, { forward: 1, turn: 1, viewYaw: Math.PI / 2 });
  assert.ok(sim.state.player.z > beforeZ + 1.5);
  assert.ok(!sim.world.buildings.some(solid => circleIntersectsBox(sim.state.player.x, sim.state.player.z, 0.48, solid)));
});

test('missing or non-finite camera headings preserve keyboard-only movement without poisoning the player', () => {
  const reference = clearRoad();
  advance(reference, 0.5, { forward: 1, turn: -1 });
  for (const viewYaw of [undefined, NaN, Infinity, -Infinity]) {
    const sim = clearRoad();
    advance(sim, 0.5, { forward: 1, turn: -1, viewYaw });
    assert.deepEqual(sim.state.player, reference.state.player);
  }
});

test('looking around while idle does not move or turn the avatar', () => {
  const sim = clearRoad();
  const before = { ...sim.state.player };
  advance(sim, 0.5, { viewYaw: Math.PI / 2 });
  assert.deepEqual(sim.state.player, before);
});

test('mouse view headings never alter vehicle acceleration, braking, or steering', () => {
  const sims = [clearRoad(), clearRoad()];
  for (const sim of sims) {
    const car = sim.state.vehicles.find(vehicle => vehicle.id === 'courier-01')!;
    Object.assign(car, { x: 0, z: 0, yaw: Math.PI, active: true });
    Object.assign(sim.state.player, { x: 0, z: 0, yaw: Math.PI, vehicleId: car.id });
  }
  for (let frame = 0; frame < 90; frame++) {
    const input = { ...NO_INPUT, forward: frame < 50 ? 1 : -1, turn: frame < 40 ? 1 : -1, brake: frame >= 75 };
    sims[0].step(1 / 60, input);
    sims[1].step(1 / 60, { ...input, viewYaw: frame % 7 ? frame * 0.37 : NaN });
    assert.deepEqual(sims[1].state.player, sims[0].state.player);
    assert.deepEqual(sims[1].getControlled(), sims[0].getControlled());
  }
});
