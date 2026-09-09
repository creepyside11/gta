import assert from 'node:assert/strict';
import test from 'node:test';
import { angleDelta, boxIntersects, circleIntersectsBox, clamp, dist } from '../src/game/collision';
import { clearShot } from '../src/game/combat';
import { policeCanSee } from '../src/game/policePursuit';
import { Simulation } from '../src/game/simulation';
import { NO_INPUT, type Point, type Vehicle } from '../src/game/types';

const patrols = (sim: Simulation): Vehicle[] => sim.state.vehicles.filter(car => car.kind === 'police' && car.active);
const patrolPoses = (sim: Simulation) => patrols(sim).map(car => ({ id: car.id, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, route: car.route, waypoint: car.waypoint }));

/** Isolate observation and navigation while retaining all 551 city props and buildings. */
function searchScene(player: Point, wanted = 1): Simulation {
  const sim = new Simulation();
  assert.ok(sim.world.obstacles.length >= 500);
  sim.state.pedestrians = [];
  for (const car of sim.state.vehicles) car.active = false;
  Object.assign(sim.state.player, player);
  assert.ok(![...sim.world.buildings, ...sim.world.obstacles].some(solid => circleIntersectsBox(player.x, player.z, .48, solid)), 'the hidden player needs a valid playable position');
  const car = sim.state.vehicles.find(vehicle => vehicle.id === 'police-0')!;
  Object.assign(car, { x: 35, z: 34, yaw: Math.PI, active: true, speed: 0, route: [], waypoint: 0 });
  Object.assign(sim.state.police, { wanted, spotted: false, reinforcementTimer: 1000,
    lastSeen: { x: 35, z: 0, yaw: 0, speed: 0, inVehicle: false, time: 0 } });
  return sim;
}

function assertPatrolGeometry(sim: Simulation): void {
  for (const car of patrols(sim)) {
    assert.ok([car.x, car.z, car.yaw, car.speed].every(Number.isFinite), `${car.id} must stay finite`);
    const xExtent = (Math.abs(Math.cos(car.yaw)) * car.width + Math.abs(Math.sin(car.yaw)) * car.depth) / 2;
    const zExtent = (Math.abs(Math.sin(car.yaw)) * car.width + Math.abs(Math.cos(car.yaw)) * car.depth) / 2;
    assert.ok(Math.abs(car.x) + xExtent < sim.world.size / 2 && Math.abs(car.z) + zExtent < sim.world.size / 2, `${car.id} left the island`);
    for (const solid of [...sim.world.buildings, ...sim.world.obstacles]) assert.equal(boxIntersects(car, solid), false, `${car.id} penetrates ${solid.id}`);
    for (const other of sim.state.vehicles) {
      if (other !== car && other.active) assert.equal(boxIntersects(car, other), false, `${car.id} overlaps ${other.id}`);
    }
  }
}

function fatalReport(sim: Simulation, point: Point): void {
  Object.assign(sim.state.player, point, { yaw: 0, vehicleId: null });
  const victim = { ...structuredClone(sim.state.pedestrians[0]), id: 'pursuit-test-victim', x: point.x, z: point.z + 1.5,
    state: 'walking' as const, health: 100, speed: 0, deadAt: null, route: [{ x: point.x, z: point.z + 1.5 }], waypoint: 0 };
  sim.state.pedestrians.push(victim);
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'knife', fire: true, viewYaw: 0 });
  assert.equal(victim.state, 'dead');
  assert.equal(sim.state.police.wanted, 3);
}

test('police see an occupied car while buildings and parked vehicles conceal an on-foot player', () => {
  const sim = new Simulation();
  const playerCar = sim.state.vehicles.find(vehicle => vehicle.id === 'courier-01')!;
  const observer = sim.state.vehicles.find(vehicle => vehicle.id === 'police-0')!;
  Object.assign(observer, { x: 6, z: 0, yaw: 0, active: true });
  sim.state.police.wanted = 3;
  Object.assign(sim.state.player, { x: playerCar.x, z: playerCar.z, vehicleId: playerCar.id });
  assert.equal(policeCanSee(sim.world, sim.state, observer, observer.id), true, 'the occupied body must count as a visible target');
  Object.assign(sim.state.player, { x: 6, z: 45, vehicleId: null });
  assert.equal(policeCanSee(sim.world, sim.state, observer, observer.id), false, 'a parked vehicle is physical cover');
  const covered = searchScene({ x: 68.7, z: 29 });
  const unit = patrols(covered)[0];
  assert.equal(policeCanSee(covered.world, covered.state, unit, unit.id), false, 'the actual courier building blocks sight');
});

test('patrol navigation keeps the same last-seen route when an unseen player changes position behind a building', () => {
  const sims = [searchScene({ x: 68.7, z: 24 }), searchScene({ x: 68.7, z: 39 })];
  for (let frame = 0; frame < 21; frame++) {
    for (const sim of sims) {
      sim.step(1 / 60, NO_INPUT);
      assert.equal(sim.state.police.spotted, false);
      assert.equal(sim.state.police.lastSeen!.time, 0, 'concealment cannot refresh a sighting');
    }
    assert.deepEqual(patrolPoses(sims[0]), patrolPoses(sims[1]), 'hidden coordinates must not steer the patrol');
  }
  assert.ok(patrols(sims[0])[0].route.length > 0, 'this must exercise active searching');
});

test('backup dispatch uses the same radio report for different concealed player positions', () => {
  const sims = [searchScene({ x: 68.7, z: -110 }), searchScene({ x: 68.7, z: -130 })];
  for (const sim of sims) {
    assert.equal(clearShot(sim.world, sim.state, { x: 0, z: -95, y: 1.65 }, { ...sim.state.player, y: 1.3 }), false,
      'both positions are hidden even from the candidate arrival road');
    sim.state.police.reinforcementTimer = 0;
    sim.step(1 / 60, NO_INPUT);
    assert.equal(sim.state.police.spotted, false);
    assert.ok(patrols(sim).length > 1, 'a real backup wave must be dispatched');
  }
  assert.deepEqual(patrolPoses(sims[0]), patrolPoses(sims[1]), 'backup placement cannot follow an unseen target');
});

test('reports bring multiple approaches and staged reinforcements stop at each wanted-level cap', () => {
  const sim = new Simulation();
  Object.assign(sim.state.player, { x: 6, z: 60 });
  sim.step(1 / 60, { ...NO_INPUT, weapon: 'pistol', fire: true, viewYaw: 0 });
  assert.equal(sim.state.police.wanted, 1);
  assert.equal(patrols(sim).length, 3);
  const angles = patrols(sim).map(car => Math.atan2(car.x - sim.state.player.x, car.z - sim.state.player.z));
  assert.ok(angles.some(a => angles.some(b => Math.abs(angleDelta(a, b)) > Math.PI / 2)), 'dispatch should approach from different directions');
  sim.state.police.wanted = 2;
  sim.state.police.reinforcementTimer = 0;
  sim.step(1 / 60, NO_INPUT);
  assert.equal(patrols(sim).length, 4);
  sim.state.police.wanted = 3;
  for (let wave = 0; wave < 9; wave++) {
    const previous = new Map(patrols(sim).map(car => [car.id, { x: car.x, z: car.z }]));
    sim.state.police.reinforcementTimer = 0;
    sim.step(1 / 60, NO_INPUT);
    assert.ok(patrols(sim).length <= 6, 'new calls must respect the six-patrol ceiling');
    for (const car of patrols(sim)) if (previous.has(car.id)) assert.ok(dist(car, previous.get(car.id)!) < 1, 'dispatch never relocates an existing patrol');
    assertPatrolGeometry(sim);
  }
  assert.equal(patrols(sim).length, 6);
  assert.equal(sim.state.vehicles.filter(car => car.kind === 'police').length, 6, 'full response must not allocate unused vehicles on every wave');
});

test('a patrol physically passes a parked lane blocker instead of repeating a permanent traffic jam', () => {
  const sim = searchScene({ x: -2.7, z: -65 });
  const unit = patrols(sim)[0];
  Object.assign(unit, { x: 2.7, z: 55, yaw: Math.PI, speed: 8 });
  const blocker = sim.state.vehicles.find(car => car.id === 'parked-coral')!;
  Object.assign(blocker, { x: 2.7, z: 40, yaw: Math.PI, speed: 0, active: true });
  sim.state.police.lastSeen = { x: -2.7, z: -65, yaw: Math.PI, speed: 0, inVehicle: false, time: 0 };
  const originalBlocker = { x: blocker.x, z: blocker.z, yaw: blocker.yaw };
  for (let frame = 0; frame < 12 * 60 && unit.z >= 30; frame++) {
    const before = { x: unit.x, z: unit.z };
    sim.step(1 / 60, NO_INPUT);
    assert.ok(dist(before, unit) < .9, 'recovery must drive instead of teleporting');
    if (frame % 12 === 0) assertPatrolGeometry(sim);
  }
  assert.ok(unit.z < 30, `the patrol failed to get around the parked car: ${JSON.stringify({ x: unit.x, z: unit.z, blocked: unit.blocked })}`);
  assert.ok(dist(blocker, originalBlocker) < 5, 'an impacted parked car may roll a short distance, never teleport');
  assert.ok(blocker.damage && blocker.damage.integrity < 1, 'the patrol impact damages the movable blocker');
  assertPatrolGeometry(sim);
});

test('real cover allows a hidden player to escape while the patrol continues searching the last sighting', () => {
  const sim = searchScene({ x: 143, z: 143 }, 3);
  sim.state.mission.phase = 'deliver';
  const initialCar = { x: patrols(sim)[0].x, z: patrols(sim)[0].z };
  let searched = false;
  for (let frame = 0; frame < 26 * 60 && sim.state.police.wanted; frame++) {
    sim.step(1 / 60, NO_INPUT);
    assert.equal(sim.state.police.spotted, false, 'police cannot see through the furnished blocks');
    assert.equal(sim.state.police.lastSeen!.time, 0);
    searched ||= dist(patrols(sim)[0], initialCar) > 12;
    if (frame % 30 === 0) assertPatrolGeometry(sim);
  }
  assert.ok(searched, 'officers should investigate instead of standing idle until the timer expires');
  assert.ok(sim.state.time >= 22, 'three-star heat requires a complete concealed search interval');
  assert.equal(sim.state.police.wanted, 0);
  assert.equal(sim.state.mission.phase, 'deliver', 'escaping must preserve the active delivery');
  assert.equal(sim.state.combat.health, 100);
  assert.equal(sim.state.combat.dead, false);
  assert.match(sim.state.message, /^You lost the patrol/);
});

test('three-star patrols close on a fast driver across the furnished city without jams or collision defects', () => {
  const sim = new Simulation();
  fatalReport(sim, { x: 6, z: 172 });
  const car = sim.state.vehicles.find(vehicle => vehicle.id === 'courier-01')!;
  Object.assign(car, { x: 6, z: 172, yaw: Math.PI, speed: 20, active: true, steer: 0 });
  Object.assign(sim.state.player, { x: car.x, z: car.z, yaw: car.yaw, vehicleId: car.id });
  let maximumSpeed = 0, nearest = Infinity, maximumResponse = 0;
  const stalled = new Map<string, number>();
  for (let frame = 0; frame < 11 * 60; frame++) {
    const before = new Map(patrols(sim).map(unit => [unit.id, { x: unit.x, z: unit.z }]));
    const target = { x: 6, z: -176 };
    const angle = angleDelta(car.yaw, Math.atan2(target.x - car.x, target.z - car.z));
    sim.step(1 / 60, { ...NO_INPUT, forward: car.speed < 28.7 ? 1 : car.speed > 29.4 ? -1 : 0, turn: clamp(-angle * 2, -1, 1) });
    maximumResponse = Math.max(maximumResponse, patrols(sim).length);
    for (const unit of patrols(sim)) {
      maximumSpeed = Math.max(maximumSpeed, unit.speed);
      nearest = Math.min(nearest, dist(unit, car));
      const previous = before.get(unit.id);
      if (!previous) continue;
      const movement = dist(unit, previous);
      assert.ok(movement < 1, `${unit.id} cannot teleport to keep up`);
      const riding = sim.state.officers.find(officer => officer.vehicleId === unit.id)?.state === 'riding';
      const stopped = movement < .001 && car.speed > 6 && dist(unit, car) > 15 && riding;
      stalled.set(unit.id, stopped ? (stalled.get(unit.id) ?? 0) + 1 / 60 : 0);
      assert.ok(stalled.get(unit.id)! < 7, `${unit.id} stays jammed while the suspect escapes`);
    }
    if (frame % 30 === 0) assertPatrolGeometry(sim);
  }
  assert.ok(maximumSpeed > 22, 'vehicle pursuit needs highway speed');
  assert.ok(maximumResponse >= 4 && maximumResponse <= 6, 'backup must join the live pursuit');
  assert.ok(nearest < 30, `a straight sprint should bring pursuit pressure, closest distance was ${nearest.toFixed(1)}m`);
  assert.equal(sim.state.police.wanted, 3);
  assert.equal(sim.state.combat.dead, false);
});
