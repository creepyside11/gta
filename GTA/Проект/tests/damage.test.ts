import test from 'node:test';
import assert from 'node:assert/strict';
import { contactNormal, driveEfficiency, freshDamage, resolveVehicleImpact, VEHICLE_MASS, velocity } from '../src/game/damage';
import { createVehicles } from '../src/game/ai';
import { Simulation } from '../src/game/simulation';
import { NO_INPUT, type Vehicle } from '../src/game/types';
import { engineMix, spatialMix } from '../src/game/audioMix';

function car(model: Vehicle['model'] = 'sedan', speed = 0): Vehicle {
  const v = structuredClone(createVehicles().find(v => v.model === model)!);
  return { ...v, x: 0, z: 0, yaw: 0, speed, steer: 0, damage: undefined };
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('damage follows squared normal closing speed, not absolute speed or scraping speed', () => {
  const slow = car('sedan', 8), fast = car('sedan', 16), grazing = car('sedan', 16);
  const e1 = resolveVehicleImpact(slow, null, { x: 0, z: 1 }, 1);
  const e2 = resolveVehicleImpact(fast, null, { x: 0, z: 1 }, 1);
  near(e2 / e1, 4);
  const eg = resolveVehicleImpact(grazing, null, { x: Math.sqrt(.96), z: .2 }, 1);
  near(eg / e2, .04);
  assert.ok(fast.damage!.front > slow.damage!.front);
  const convoyA = car('sedan', 20), convoyB = car('sedan', 20);
  assert.equal(resolveVehicleImpact(convoyA, convoyB, { x: 0, z: 1 }, 1), 0);
  assert.equal(convoyA.damage, undefined);
});

test('inelastic collision conserves linear momentum in both axes and dissipates kinetic energy', () => {
  const a = car('sport', 23), b = car('truck', -3); b.yaw = .7;
  const ma = VEHICLE_MASS[a.model], mb = VEHICLE_MASS[b.model];
  const va = velocity(a), vb = velocity(b);
  const beforeEnergy = .5 * ma * (va.x ** 2 + va.z ** 2) + .5 * mb * (vb.x ** 2 + vb.z ** 2);
  const loss = resolveVehicleImpact(a, b, { x: .3, z: .8 }, 1);
  const aa = velocity(a), bb = velocity(b);
  near(va.x * ma + vb.x * mb, aa.x * ma + bb.x * mb);
  near(va.z * ma + vb.z * mb, aa.z * ma + bb.z * mb);
  const afterEnergy = .5 * ma * (aa.x ** 2 + aa.z ** 2) + .5 * mb * (bb.x ** 2 + bb.z ** 2);
  near(beforeEnergy - afterEnergy, loss);
  assert.ok(loss > 0);
});

test('mass matters, separation generates no new damage, and gentle parking contacts stay cosmetic-free', () => {
  const light = car('hatchback', 15), heavy = car('truck', 0);
  resolveVehicleImpact(light, heavy, { x: 0, z: 1 }, 1);
  assert.ok(Math.abs(light.speed - 15) > Math.abs(heavy.speed));
  const revision = light.damage!.revision;
  assert.equal(resolveVehicleImpact(light, heavy, { x: 0, z: 1 }, 2), 0);
  assert.equal(light.damage!.revision, revision);
  const gentle = car('sedan', .7);
  resolveVehicleImpact(gentle, null, { x: 0, z: 1 }, 1);
  assert.equal(gentle.damage!.integrity, 1);
});

test('damage is localized, bounded, persists until repair, and severe engine damage disables power', () => {
  const v = car('sedan', 28);
  resolveVehicleImpact(v, null, { x: 0, z: 1 }, 1);
  assert.equal(v.damage!.front, 1); assert.equal(v.damage!.rear, 0);
  assert.equal(driveEfficiency(v), 0);
  const side = car(); side.yaw = Math.PI / 2; side.speed = 20;
  // Give a world-Z lateral impulse to an east-facing car.
  side.damage = freshDamage(); side.damage.driftZ = 20;
  resolveVehicleImpact(side, null, { x: 0, z: 1 }, 1);
  assert.ok(side.damage.left > 0); assert.equal(side.damage.right, 0);
  for (let i = 2; i < 20; i++) { v.speed = 28; resolveVehicleImpact(v, null, { x: 0, z: 1 }, i); }
  assert.equal(v.damage!.integrity, 0); assert.equal(v.damage!.engine, 0);
});

test('SAT returns the rotated contact face normal', () => {
  const a = { x: 0, z: 0, width: 2, depth: 4, yaw: Math.PI / 4 };
  const n = contactNormal(a, { ...a, x: 2.5, z: 2.5 });
  near(n.x, Math.SQRT1_2); near(n.z, Math.SQRT1_2);
});

test('simulation wall impact damages a moving car, blocks penetration and mission reset repairs it', () => {
  const sim = new Simulation();
  sim.world.buildings = []; sim.world.obstacles = [{ id: 'wall', kind: 'barrier', x: 0, z: 4, yaw: 0, width: 20, depth: 1, height: 2, color: '#aaa' }];
  const v = sim.state.vehicles.find(v => v.kind === 'mission')!;
  sim.state.vehicles = [v]; sim.state.pedestrians = []; v.x = 0; v.z = 0; v.yaw = 0; v.speed = 22;
  sim.state.player.vehicleId = v.id; sim.state.player.x = 0; sim.state.player.z = 0;
  for (let i = 0; i < 20; i++) sim.step(1 / 60, NO_INPUT);
  assert.ok(v.damage && v.damage.front > .1);
  assert.ok(v.z + v.depth / 2 < 3.5);
  sim.restartMission(); assert.equal(v.damage, undefined);
});

test('audio gears drop engine pitch, throttle adds load, damaged engines rattle and dead engines stop', () => {
  const v = car('sedan', 6.49); v.throttle = 1;
  const first = engineMix(v); v.speed = 6.51; const second = engineMix(v);
  assert.equal(first.gear, 1); assert.equal(second.gear, 2); assert.ok(second.rpm < first.rpm);
  v.throttle = 0; assert.ok(engineMix(v).engine < second.engine);
  v.speed = 20; v.braking = true; assert.ok(engineMix(v).skid > 0);
  v.damage = freshDamage(); v.damage.engine = .3; assert.ok(engineMix(v).rattle > 0);
  v.damage.engine = 0; assert.equal(engineMix(v).engine, 0);
  assert.equal(engineMix().engine, 0);
  assert.ok(spatialMix(5, 0, 0).volume > spatialMix(100, 0, 0).volume);
  assert.ok(spatialMix(5, 0, 0).pan > 0); assert.ok(spatialMix(-5, 0, 0).pan < 0);
});
