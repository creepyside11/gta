import test from 'node:test';
import assert from 'node:assert/strict';
import { circleIntersectsBox, dist } from '../src/game/collision';
import { createCombatState, damagePlayer } from '../src/game/combat';
import { Simulation } from '../src/game/simulation';
import { NO_INPUT, type InputFrame, type Pedestrian, type PoliceOfficer, type Vehicle } from '../src/game/types';

function advance(sim: Simulation, seconds: number, input: Partial<InputFrame> = {}): void {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) sim.step(1 / 60, { ...NO_INPUT, ...input });
}

function scene() {
  const sim = new Simulation();
  const pedestrian = structuredClone(sim.state.pedestrians[0]);
  sim.world.buildings = [];
  sim.world.obstacles = [];
  sim.state.pedestrians = [];
  for (const car of sim.state.vehicles) car.active = false;
  sim.state.police.reinforcementTimer = 1000;
  Object.assign(sim.state.player, { x: 0, z: 0, yaw: 0, vehicleId: null });
  return { sim, pedestrian };
}

function patrol(sim: Simulation, index = 0, x = 0, z = -40): Vehicle {
  const car = sim.state.vehicles.find(vehicle => vehicle.id === `police-${index}`)!;
  Object.assign(car, { x, z, yaw: Math.atan2(-x, -z), speed: 0, active: true, route: [], waypoint: 0 });
  return car;
}

function until(sim: Simulation, condition: () => boolean, seconds = 10, input: Partial<InputFrame> = {}): void {
  for (let frame = 0; frame < seconds * 60 && !condition(); frame++) sim.step(1 / 60, { ...NO_INPUT, ...input });
  assert.ok(condition(), 'the requested police transition must complete without a teleport');
}

function officerFor(sim: Simulation, car: Vehicle): PoliceOfficer {
  const officer = sim.state.officers.find(unit => unit.vehicleId === car.id);
  assert.ok(officer);
  return officer;
}

function personAt(template: Pedestrian, x: number, z: number): Pedestrian {
  return { ...structuredClone(template), x, z, yaw: 0, speed: 0, state: 'walking', health: 100, deadAt: null,
    route: [{ x, z }, { x, z: z + 8 }], waypoint: 1 };
}

test('a fatal attack immediately overrides cooldown with three stars and dispatches live patrols', () => {
  const { sim, pedestrian } = scene();
  const victim = personAt(pedestrian, 0, 1.6);
  sim.state.pedestrians = [victim];
  sim.state.police.wanted = 1;
  sim.state.police.cooldown = 99;
  sim.state.police.escape = 7;
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'knife', fire: true, viewYaw: 0 });
  assert.equal(victim.health, 0);
  assert.equal(victim.state, 'dead');
  assert.equal(sim.state.police.wanted, 3);
  assert.equal(sim.state.police.cooldown, 0);
  assert.ok(sim.state.police.escape <= 1 / 60, 'the new report resets escape; a patrol still behind cover starts a fresh search');
  const units = sim.state.vehicles.filter(car => car.kind === 'police' && car.active);
  assert.equal(units.length, 3);
  assert.equal(sim.state.officers.length, 3);
  assert.ok(units.every(car => dist(car, sim.state.player) > 34));
  advance(sim, 0.6);
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'pistol', fire: true, viewYaw: Math.PI / 2 });
  assert.equal(sim.state.police.wanted, 3, 'later gunfire reports cannot downgrade a lethal incident');
});

test('dead pedestrians neither move nor make traffic stop for their former live body', () => {
  const { sim, pedestrian } = scene();
  const victim = { ...personAt(pedestrian, 0, 5), state: 'dead' as const, health: 0, deadAt: 0 };
  sim.state.pedestrians = [victim];
  Object.assign(sim.state.player, { x: 90, z: 0 });
  const traffic = sim.state.vehicles.find(car => car.id === 'traffic-0')!;
  Object.assign(traffic, { x: 0, z: 0, yaw: 0, active: true, route: [{ x: 0, z: 50 }], waypoint: 0 });
  const body = { x: victim.x, z: victim.z, phase: victim.phase };
  advance(sim, 4);
  assert.ok(traffic.z > 15 && traffic.speed > 5);
  assert.deepEqual({ x: victim.x, z: victim.z, phase: victim.phase }, body);
  assert.equal(sim.state.police.wanted, 0);
});

test('armed patrols drive in, brake, dismount clear of the car and fire after an initial delay', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, -42);
  sim.state.police.wanted = 3;
  const start = { x: car.x, z: car.z };
  until(sim, () => sim.state.officers.some(unit => unit.state === 'engaging'));
  const officer = officerFor(sim, car);
  assert.ok(dist(car, start) > 10, 'the response arrives by driving');
  assert.ok(Math.abs(car.speed) < 0.25);
  assert.ok(!circleIntersectsBox(officer.x, officer.z, 0.38, car));
  assert.ok(dist(officer, sim.state.player) > 10 && dist(officer, sim.state.player) < 23);
  assert.equal(sim.state.combat.health, 100);
  advance(sim, 0.7);
  assert.equal(sim.state.combat.health, 100, 'the player has time to react after dismount');
  advance(sim, 1.2);
  assert.ok(sim.state.combat.health < 100 && sim.state.combat.health > 0);
  assert.ok(officer.phase > 0, 'the officer approaches on foot while engaging');
  assert.equal(sim.state.police.wanted, 3);
  assert.equal(sim.state.police.caught, 0);
});

test('officers respect solid cover and resume shooting when a clear line opens', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, -16);
  sim.state.police.wanted = 3;
  sim.step(1 / 60, NO_INPUT);
  const officer = officerFor(sim, car);
  assert.equal(officer.state, 'engaging');
  sim.world.obstacles.push({ id: 'test-cover', kind: 'barrier', x: 0, z: -7, width: 12, depth: 1, height: 3, yaw: 0, color: '#777777' });
  advance(sim, 1.5);
  assert.equal(sim.state.combat.health, 100);
  assert.ok(!sim.state.combat.shots.some(shot => shot.owner === 'police'));
  sim.world.obstacles = [];
  advance(sim, 1.2);
  assert.ok(sim.state.combat.health < 100, 'exposed players can be hit after leaving cover');
});

test('police engage a stationary driver, then physically return to their car before chasing', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, -16);
  const playerCar = sim.state.vehicles.find(vehicle => vehicle.id === 'courier-01')!;
  Object.assign(playerCar, { x: 0, z: 0, yaw: 0, speed: 0, active: true });
  Object.assign(sim.state.player, { x: 0, z: 0, yaw: 0, vehicleId: playerCar.id });
  sim.state.police.wanted = 3;
  until(sim, () => sim.state.officers.some(unit => unit.state === 'engaging'));
  advance(sim, 2);
  assert.ok(sim.state.combat.health < 100, 'a stopped vehicle does not make its driver invulnerable');
  const officer = officerFor(sim, car);
  let returning = false;
  for (let frame = 0; frame < 4 * 60; frame++) {
    const before = { x: officer.x, z: officer.z, state: officer.state };
    sim.step(1 / 60, { ...NO_INPUT, forward: 1 });
    if (officer.state === 'returning') returning = true;
    if (officer.state !== 'riding') {
      assert.equal(car.speed, 0, 'the patrol cannot drive away without its officer');
      if (before.state !== 'riding') assert.ok(dist(officer, before) < 0.08, 'the officer returns using normal walking steps');
    }
  }
  assert.ok(returning);
  assert.equal(officer.state, 'riding');
  assert.ok(playerCar.speed > 3 && car.speed > 3);
  assert.ok(dist(car, { x: 0, z: -16 }) > 5, 'the boarded patrol resumes vehicle pursuit');
});

test('a moving driver is pursued by occupied police vehicles without premature dismounts', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, -18);
  const playerCar = sim.state.vehicles.find(vehicle => vehicle.id === 'courier-01')!;
  Object.assign(playerCar, { x: 0, z: 0, yaw: 0, speed: 12, active: true });
  Object.assign(sim.state.player, { x: 0, z: 0, yaw: 0, vehicleId: playerCar.id });
  sim.state.police.wanted = 3;
  for (let frame = 0; frame < 3 * 60; frame++) {
    sim.step(1 / 60, { ...NO_INPUT, forward: 1 });
    assert.equal(officerFor(sim, car).state, 'riding');
  }
  assert.ok(car.z > 0 && car.speed > 10);
  assert.equal(sim.state.combat.health, 100);
});

test('a killed officer stays dead and leaves their car stopped while the surviving unit engages', () => {
  const { sim } = scene();
  const first = patrol(sim, 0, -4, -18);
  const second = patrol(sim, 1, 4, -21);
  sim.state.police.wanted = 3;
  until(sim, () => sim.state.officers.length === 2 && sim.state.officers.every(unit => unit.state === 'engaging'));
  const victim = officerFor(sim, first);
  Object.assign(sim.state.player, { x: victim.x, z: victim.z + 1.5, yaw: Math.PI });
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'knife', fire: true, viewYaw: Math.PI });
  assert.equal(victim.state, 'dead');
  assert.equal(victim.health, 0);
  const fallen = { x: victim.x, z: victim.z, phase: victim.phase };
  const survivor = officerFor(sim, second);
  const before = { x: survivor.x, z: survivor.z };
  advance(sim, 1.5);
  assert.deepEqual({ x: victim.x, z: victim.z, phase: victim.phase }, fallen);
  assert.equal(first.speed, 0);
  assert.equal(survivor.state, 'engaging');
  assert.ok(dist(before, survivor) > 0.5 || sim.state.combat.health < 100);
  assert.equal(sim.state.police.wanted, 3);
});

test('a later killing beside defeated patrols dispatches replacements without reviving the fallen units', () => {
  const { sim, pedestrian } = scene();
  const originals = [patrol(sim, 0, -4, -18), patrol(sim, 1, 4, -18)];
  sim.state.police.wanted = 3;
  until(sim, () => sim.state.officers.length === 2 && sim.state.officers.every(unit => unit.state === 'engaging'));
  const originalOfficers = [...sim.state.officers];
  for (const officer of originalOfficers) {
    Object.assign(sim.state.player, { x: officer.x, z: officer.z + 1.5, yaw: Math.PI });
    sim.step(1 / 60, { ...NO_INPUT, weapon: 'knife', fire: true, viewYaw: Math.PI });
    assert.equal(officer.state, 'dead');
    advance(sim, 0.6);
  }
  until(sim, () => sim.state.police.wanted === 0, 24);
  assert.ok(originalOfficers.every(officer => dist(officer, sim.state.player) < 45));
  const oldCars = originals.map(car => ({ id: car.id, x: car.x, z: car.z }));
  const bodies = originalOfficers.map(officer => ({ id: officer.id, x: officer.x, z: officer.z, deadAt: officer.deadAt }));
  const victim = personAt(pedestrian, sim.state.player.x, sim.state.player.z + 1.6);
  sim.state.pedestrians = [victim];
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'knife', fire: true, viewYaw: 0 });
  assert.equal(victim.state, 'dead');
  assert.equal(sim.state.police.wanted, 3);
  const replacements = sim.state.officers.filter(officer => officer.state !== 'dead');
  assert.equal(replacements.length, 3);
  assert.ok(replacements.every(officer => officer.state === 'riding' && dist(officer, sim.state.player) > 34));
  assert.ok(replacements.every(officer => !originalOfficers.some(old => old.id === officer.id)));
  assert.deepEqual(originals.map(car => ({ id: car.id, x: car.x, z: car.z })), oldCars);
  assert.deepEqual(originalOfficers.map(officer => ({ id: officer.id, x: officer.x, z: officer.z, deadAt: officer.deadAt })), bodies);
  assert.ok(originalOfficers.every(officer => officer.state === 'dead' && officer.health === 0));
  sim.restartMission();
  assert.deepEqual(sim.state.officers, []);
  assert.equal(sim.state.vehicles.filter(car => car.kind === 'police').length, 2, 'reset also clears retired replacement patrols');
});

test('live officers stop traffic and driven vehicles, while their dead bodies no longer block the road', () => {
  for (const mode of ['traffic', 'driving'] as const) {
    const { sim } = scene();
    const officer: PoliceOfficer = { id: 'test-officer', vehicleId: 'police-0', x: 0, z: 7, yaw: Math.PI,
      health: 100, state: 'engaging', fireCooldown: 10, phase: 0, deadAt: null };
    sim.state.officers = [officer];
    const car = sim.state.vehicles.find(vehicle => vehicle.id === (mode === 'traffic' ? 'traffic-0' : 'courier-01'))!;
    Object.assign(car, { x: 0, z: 0, yaw: 0, speed: 0, active: true, route: [{ x: 0, z: 50 }], waypoint: 0 });
    Object.assign(sim.state.player, mode === 'driving' ? { x: 0, z: 0, vehicleId: car.id } : { x: 90, z: 0 });
    const input = mode === 'driving' ? { forward: 1 } : {};
    advance(sim, 3, input);
    assert.ok(car.z < officer.z - car.depth / 2 - 0.38, `${mode} respects the live officer body`);
    assert.ok(!circleIntersectsBox(officer.x, officer.z, 0.38, car));
    assert.equal(officer.health, 100, 'body collision does not add an extra damage mechanic');
    officer.state = 'dead'; officer.health = 0; officer.deadAt = sim.state.time;
    advance(sim, 3, input);
    assert.ok(car.z > 15, `${mode} can resume after the obstruction is no longer alive`);
  }
});

test('the on-foot player cannot walk through a live officer but can pass a fallen body', () => {
  const { sim } = scene();
  const officer: PoliceOfficer = { id: 'test-officer', vehicleId: 'police-0', x: 0, z: 7, yaw: Math.PI,
    health: 100, state: 'engaging', fireCooldown: 10, phase: 0, deadAt: null };
  sim.state.officers = [officer];
  Object.assign(sim.state.player, { x: -3, z: 7 });
  advance(sim, 1, { turn: 1 });
  assert.ok(sim.state.player.x < -0.8 && sim.state.player.x > -1);
  officer.state = 'dead'; officer.health = 0; officer.deadAt = sim.state.time;
  advance(sim, 0.5, { turn: 1 });
  assert.ok(sim.state.player.x > 1);
});

test('three-star response uses health damage while the original one-star capture still works', () => {
  for (const wanted of [1, 3]) {
    const { sim } = scene();
    patrol(sim, 0, 0, -3.2);
    sim.state.police.wanted = wanted;
    advance(sim, 4);
    if (wanted === 1) {
      assert.equal(sim.state.police.wanted, 0);
      assert.equal(sim.state.combat.health, 100);
      assert.equal(sim.state.officers.length, 0);
      assert.match(sim.state.message, /^Stopped by the patrol/);
    } else {
      assert.equal(sim.state.police.wanted, 3);
      assert.equal(sim.state.police.caught, 0);
      assert.ok(sim.state.combat.health > 0 && sim.state.combat.health < 100);
    }
  }
});

test('escaping sends officers back on foot and clears their encounter on mission reset', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, -18);
  sim.state.police.wanted = 3;
  until(sim, () => sim.state.officers.some(unit => unit.state === 'engaging'));
  const officer = officerFor(sim, car);
  Object.assign(sim.state.player, { x: 180, z: 0 });
  until(sim, () => sim.state.police.wanted === 0, 24);
  assert.equal(officer.state, 'returning');
  assert.equal(car.speed, 0);
  until(sim, () => officer.state === 'riding', 20);
  sim.restartMission();
  assert.deepEqual(sim.state.officers, []);
  assert.ok(sim.state.vehicles.filter(vehicle => vehicle.kind === 'police').every(vehicle => !vehicle.active));
});

test('a fresh one-star report does not make a returning officer resume lethal fire', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, -18);
  sim.state.police.wanted = 3;
  until(sim, () => sim.state.officers.some(unit => unit.state === 'engaging'));
  advance(sim, 1);
  sim.state.police.wanted = 0;
  sim.step(1 / 60, NO_INPUT);
  const officer = officerFor(sim, car);
  assert.equal(officer.state, 'returning');
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'pistol', fire: true, viewYaw: Math.PI / 2 });
  assert.equal(sim.state.police.wanted, 1);
  assert.notEqual(officer.state, 'engaging');
  advance(sim, 1.3);
  assert.equal(sim.state.combat.health, 100);
  assert.notEqual(officer.state, 'engaging');
});

test('a returning officer commits to a clear path around a building and reaches the patrol', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 14, 0);
  car.yaw = 0;
  Object.assign(sim.state.player, { x: 180, z: 180 });
  const wall = { id: 'return-cover', kind: 'barrier' as const, x: 0, z: 0, width: 20, depth: 20, height: 10, yaw: 0, color: '#777777' };
  sim.world.obstacles = [wall];
  const officer: PoliceOfficer = { id: 'officer-police-0', vehicleId: car.id, x: -12, z: 0, yaw: Math.PI / 2,
    health: 100, state: 'returning', fireCooldown: 1, phase: 0, deadAt: null };
  sim.state.officers = [officer];
  let aroundCorner = false;
  for (let frame = 0; frame < 20 * 60 && !['riding'].includes(officer.state); frame++) {
    const before = { x: officer.x, z: officer.z };
    sim.step(1 / 60, NO_INPUT);
    if (officer.state !== 'riding') {
      assert.ok(dist(officer, before) < .08, 'returning uses ordinary walking steps');
      assert.ok(!circleIntersectsBox(officer.x, officer.z, .38, wall), 'the detour stays outside cover');
    }
    aroundCorner ||= Math.abs(officer.z) > 10.4;
  }
  assert.ok(aroundCorner);
  assert.equal(officer.state, 'riding');
});

test('a dead officer far away cannot retire or revive their empty patrol beside the player', () => {
  const { sim } = scene();
  const car = patrol(sim, 0, 0, 0);
  sim.state.time = 100;
  sim.state.police.wanted = 3;
  Object.assign(sim.state.player, { x: 3, z: 0 });
  const officer: PoliceOfficer = { id: 'officer-police-0', vehicleId: car.id, x: 60, z: 0, yaw: 0,
    health: 0, state: 'dead', fireCooldown: 1, phase: 0, deadAt: 0 };
  sim.state.officers = [officer];
  sim.step(1 / 60, NO_INPUT);
  assert.equal(car.active, true);
  assert.equal(car.speed, 0);
  assert.equal(sim.state.officers[0], officer);
  assert.equal(officer.state, 'dead');
  Object.assign(sim.state.player, { x: 180, z: 180 });
  sim.step(1 / 60, NO_INPUT);
  assert.equal(car.active, false);
  assert.equal(sim.state.officers.length, 0);
});

test('armed patrols physically pursue or intercept the borrowed courier in the furnished city', () => {
  const sim = new Simulation();
  const victim = sim.state.pedestrians.find(person => person.id === 'ped-18')!;
  const car = sim.state.vehicles.find(vehicle => vehicle.id === 'courier-01')!;
  Object.assign(sim.state.player, { x: victim.x - 1.4, z: victim.z, yaw: Math.PI / 2 });
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'knife', fire: true, viewYaw: Math.PI / 2 });
  assert.equal(victim.state, 'dead');
  until(sim, () => sim.state.officers.some(unit => unit.state === 'engaging'), 12);
  const officer = sim.state.officers.find(unit => unit.state === 'engaging')!;
  const responder = sim.state.vehicles.find(vehicle => vehicle.id === officer.vehicleId)!;
  const policeStart = { x: responder.x, z: responder.z };
  sim.interact();
  assert.equal(sim.state.player.vehicleId, car.id);
  let resumedDriving = false;
  for (let frame = 0; frame < 240; frame++) {
    sim.step(1 / 60, { ...NO_INPUT, forward: 1 });
    resumedDriving ||= officer.state === 'riding' && responder.speed > .5;
  }
  assert.ok(car.z < 35, 'the courier moves using driving controls before escaping or meeting an interception');
  assert.ok(resumedDriving && dist(responder, policeStart) > 1, 'the dismounted officer boards and drives again before pursuit or a close interception');
  assert.ok(sim.state.vehicles.filter(vehicle => vehicle.kind === 'police' && vehicle.active).length >= 3);
  advance(sim, 1.6, { brake: true });
  sim.interact();
  assert.equal(sim.state.player.vehicleId, null);
  until(sim, () => officer.state === 'engaging', 14);
  assert.equal(sim.state.combat.dead, false);
  assert.equal(sim.state.police.wanted, 3);
});

test('death blocks input for four seconds, then restores health and ammunition at a clear safe spawn', () => {
  const { sim } = scene();
  const borrowed = sim.state.vehicles.find(car => car.id === 'parked-east')!;
  Object.assign(borrowed, { x: 20, z: 20, yaw: 0, speed: 0, active: true });
  Object.assign(sim.state.player, { x: borrowed.x, z: borrowed.z, yaw: 0, vehicleId: borrowed.id });
  const blocker = sim.state.vehicles.find(car => car.id === 'parked-coral')!;
  Object.assign(blocker, { x: 13, z: 36, yaw: 0, speed: 0, active: true });
  sim.state.mission.phase = 'deliver';
  sim.state.mission.best = 77;
  sim.state.combat.ammo.pistol = { magazine: 2, reserve: 5 };
  const patrolCar = patrol(sim, 0, -10, -10);
  sim.state.police.wanted = 3;
  sim.step(1 / 60, NO_INPUT);
  damagePlayer(sim.state, 100);
  const fallen = { x: sim.state.player.x, z: sim.state.player.z };
  const parked = { x: borrowed.x, z: borrowed.z, yaw: borrowed.yaw };
  advance(sim, 2, { forward: 1, turn: 1, fire: true, reload: true, interact: true, restart: true });
  assert.equal(sim.state.combat.dead, true);
  assert.equal(sim.state.combat.health, 0);
  assert.equal(sim.state.mission.phase, 'failed');
  assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, fallen);
  assert.deepEqual(sim.state.combat.ammo.pistol, { magazine: 2, reserve: 5 });
  assert.equal(sim.state.combat.reload, null);
  sim.interact();
  sim.restartMission();
  assert.equal(sim.state.combat.dead, true, 'manual actions cannot bypass the death delay');
  advance(sim, 2.1);
  assert.equal(sim.state.combat.dead, false);
  assert.equal(sim.state.combat.health, 100);
  assert.deepEqual(sim.state.combat.ammo, createCombatState().ammo);
  assert.equal(sim.state.player.vehicleId, null);
  assert.equal(sim.state.mission.phase, 'available');
  assert.equal(sim.state.mission.best, 77);
  assert.deepEqual({ x: borrowed.x, z: borrowed.z, yaw: borrowed.yaw }, parked);
  assert.deepEqual(sim.state.officers, []);
  assert.equal(patrolCar.active, false);
  assert.equal(sim.state.police.wanted, 0);
  assert.ok(sim.state.vehicles.filter(car => car.active).every(car => !circleIntersectsBox(sim.state.player.x, sim.state.player.z, 0.48, car)));
  assert.ok(dist(sim.state.player, { x: 13, z: 36 }) < 9, 'respawn uses a nearby clear dispatch position');
});
