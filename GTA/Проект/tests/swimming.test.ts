import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/game/simulation';
import { NO_INPUT } from '../src/game/types';

test('player can enter the ocean, swims slower, and returns to shore', () => {
  const sim = new Simulation();
  const edge = sim.world.size / 2;
  sim.state.player.x = edge - 1.25;
  sim.state.player.z = 0;
  const outward = { ...NO_INPUT, forward: 1, viewYaw: Math.PI / 2 };
  for (let i = 0; i < 60; i++) sim.step(1 / 60, outward);
  assert.ok(sim.state.player.x > edge);
  assert.equal(sim.state.player.swimming, true);
  const start = sim.state.player.x;
  for (let i = 0; i < 60; i++) sim.step(1 / 60, outward);
  const swimDistance = sim.state.player.x - start;
  assert.ok(swimDistance > 2.4 && swimDistance < 4.2);
  const inward = { ...NO_INPUT, forward: 1, viewYaw: -Math.PI / 2 };
  for (let i = 0; i < 180; i++) sim.step(1 / 60, inward);
  assert.ok(sim.state.player.x < edge - .7);
  assert.equal(sim.state.player.swimming, false);
});

test('mission reset always returns a swimmer to dry land', () => {
  const sim = new Simulation();
  sim.state.player.x = sim.world.size / 2 + 20;
  sim.state.player.swimming = true;
  sim.restartMission();
  assert.equal(sim.state.player.swimming, false);
  assert.ok(Math.abs(sim.state.player.x) < sim.world.size / 2);
});
