import assert from 'node:assert/strict';
import test from 'node:test';
import { createCombatState, damagePlayer, firePoliceShot, traceBullet, updateCombat, WEAPON_SPECS } from '../src/game/combat';
import { NO_INPUT, type GameState, type InputFrame, type Pedestrian, type PoliceOfficer, type World } from '../src/game/types';

const pedestrian = (id: string, x: number, z: number): Pedestrian => ({
  id, x, z, yaw: 0, color: '#cccccc', speed: 1.4, route: [{ x, z }], waypoint: 0,
  phase: 0, state: 'walking', timer: 0, health: 100, deadAt: null,
});
const officer = (x = 0, z = 12): PoliceOfficer => ({
  id: 'officer-test', vehicleId: 'police-test', x, z, yaw: Math.PI, health: 100,
  state: 'engaging', fireCooldown: 0, phase: 0, deadAt: null,
});
function scene(people: Pedestrian[] = []) {
  const world: World = { size: 200, roads: [0], roadWidth: 18, buildings: [], obstacles: [], districts: [],
    pickup: { x: 90, z: 90 }, destination: { x: 90, z: -90 }, restricted: { x: -90, z: -90, radius: 5 } };
  const state: GameState = {
    time: 0, player: { x: 0, z: 0, yaw: 0, vehicleId: null, moving: false }, pedestrians: people, vehicles: [],
    mission: { phase: 'available', elapsed: 0, best: null, deliveryHold: 0 },
    police: { wanted: 0, escape: 0, caught: 0, cooldown: 0, lastSeen: null, spotted: false, reinforcementTimer: 7 }, combat: createCombatState(), officers: [],
    message: '', messageUntil: 0, collisions: 0,
  };
  const crimes: number[] = [];
  const step = (seconds: number, input: Partial<InputFrame> = {}) => {
    for (let remaining = seconds; remaining > 1e-7;) {
      const dt = Math.min(1 / 90, remaining);
      state.time += dt;
      updateCombat(world, state, dt, { ...NO_INPUT, viewYaw: 0, ...input }, level => {
        crimes.push(level); state.police.wanted = Math.max(state.police.wanted, level);
      });
      remaining -= dt;
    }
  };
  const tap = (input: Partial<InputFrame> = {}) => { step(1 / 90, { fire: true, ...input }); step(.28); };
  return { world, state, crimes, step, tap };
}

test('knife hits only a nearby living person in front and each death raises three stars once', () => {
  const front = pedestrian('front', 0, 1.8), behind = pedestrian('behind', 0, -1), far = pedestrian('far', 0, 3.2);
  const s = scene([front, behind, far]);
  s.step(.8, { fire: true });
  assert.equal(front.health, 0); assert.equal(front.state, 'dead'); assert.ok(front.deadAt !== null);
  assert.equal(behind.health, 100); assert.equal(far.health, 100);
  assert.deepEqual(s.crimes, [3]); assert.equal(s.state.police.wanted, 3);
  s.step(.1); s.tap();
  assert.deepEqual(s.crimes, [3], 'a corpse is not another kill');
  assert.equal(s.state.combat.ammo.pistol.magazine, 12);
});

test('pistol is semi-automatic, uses exactly one cartridge per press, and stops on an empty magazine', () => {
  const s = scene();
  s.step(2, { weapon: 'pistol', fire: true });
  assert.equal(s.state.combat.ammo.pistol.magazine, 11, 'holding a pistol trigger is one shot');
  s.step(.3);
  for (let press = 0; press < 20; press++) s.tap();
  assert.equal(s.state.combat.ammo.pistol.magazine, 0);
  assert.equal(s.state.combat.ammo.pistol.reserve, 72);
  assert.equal(s.state.combat.nextShotId, 13);
  assert.match(s.state.message, /reload/i);
});

test('rifle fires continuously at its cadence and cannot fire beyond thirty magazine rounds', () => {
  const s = scene();
  s.step(1, { weapon: 'rifle', fire: true });
  assert.equal(s.state.combat.ammo.rifle.magazine, 20);
  s.step(4, { fire: true });
  assert.equal(s.state.combat.ammo.rifle.magazine, 0);
  assert.equal(s.state.combat.nextShotId, 31);
  assert.equal(s.state.combat.ammo.rifle.reserve, 180);
});

test('reload takes time, prevents firing, and transfers only missing cartridges from reserve', () => {
  const s = scene();
  s.tap({ weapon: 'pistol' }); s.tap();
  assert.equal(s.state.combat.ammo.pistol.magazine, 10);
  s.step(.01, { reload: true });
  assert.ok(s.state.combat.reload);
  s.step(1, { fire: true });
  assert.equal(s.state.combat.ammo.pistol.magazine, 10);
  assert.equal(s.state.combat.ammo.pistol.reserve, 72);
  s.step(.5);
  assert.equal(s.state.combat.reload, null);
  assert.deepEqual(s.state.combat.ammo.pistol, { magazine: 12, reserve: 70 });
  s.step(.1, { reload: true });
  assert.equal(s.state.combat.reload, null, 'full magazines do not reload');
});

test('switching weapons cancels a pending reload without creating ammunition, including a partial reserve', () => {
  const s = scene();
  s.state.combat.ammo.pistol = { magazine: 2, reserve: 3 };
  s.step(.1, { weapon: 'pistol', reload: true });
  s.step(2, { weapon: 'rifle' });
  assert.equal(s.state.combat.reload, null);
  assert.deepEqual(s.state.combat.ammo.pistol, { magazine: 2, reserve: 3 });
  s.step(2, { weapon: 'pistol', reload: true });
  assert.deepEqual(s.state.combat.ammo.pistol, { magazine: 5, reserve: 0 });
  s.step(.1, { reload: true });
  assert.equal(s.state.combat.reload, null);
});

test('hitscan damages the nearest person and bullets stop at buildings, rotated cover, and vehicles', () => {
  const close = pedestrian('close', 0, 8), far = pedestrian('far', 0, 16);
  const s = scene([close, far]);
  s.tap({ weapon: 'pistol' });
  assert.equal(close.health, 60); assert.equal(far.health, 100);
  s.world.obstacles.push({ id: 'cover', kind: 'barrier', x: 0, z: 4, width: .5, depth: 5, height: 3, yaw: Math.PI / 4, color: '#cccccc' });
  s.tap(); assert.equal(close.health, 60);
  s.world.obstacles = [];
  s.state.vehicles.push({ id: 'cover-car', kind: 'parked', model: 'truck', x: 0, z: 4, width: 2.8, depth: 3, yaw: 0, color: '#cccccc', speed: 0, steer: 0, route: [], waypoint: 0, blocked: 0, active: true });
  s.tap(); assert.equal(close.health, 60);
  s.state.vehicles[0].active = false;
  s.world.buildings.push({ id: 'wall', kind: 'building', x: 0, z: 4, width: 6, depth: .2, height: 8, yaw: 0, color: '#cccccc', style: 0 });
  s.tap(); assert.equal(close.health, 60);
});

test('a low flowerbed can be shot over but a knife cannot reach through tall cover', () => {
  const victim = pedestrian('target', 0, 8);
  const s = scene([victim]);
  s.world.obstacles.push({ id: 'flowers', kind: 'planter', x: 0, z: 4, width: 3, depth: 1, height: .65, yaw: 0, color: '#cccccc' });
  s.tap({ weapon: 'pistol' });
  assert.equal(victim.health, 60);
  Object.assign(victim, { x: 0, z: 1.8 });
  Object.assign(s.world.obstacles[0], { z: 1, depth: .2, height: 3 });
  s.tap({ weapon: 'knife' });
  assert.equal(victim.health, 60);
});

test('gun kills occur at zero health and immediately select three stars; corpses do not absorb further shots', () => {
  const first = pedestrian('first', 0, 8), second = pedestrian('second', 0, 16);
  const s = scene([first, second]);
  s.tap({ weapon: 'pistol' }); s.tap();
  assert.equal(first.health, 20); assert.equal(s.state.police.wanted, 1);
  s.tap(); assert.equal(first.health, 0); assert.equal(first.state, 'dead');
  assert.equal(s.state.police.wanted, 3); assert.equal(s.crimes.filter(level => level === 3).length, 1);
  s.tap(); assert.equal(second.health, 60);
  assert.equal(s.state.police.wanted, 3, 'lesser crimes never reduce existing heat');
});

test('camera center aiming converges at the visible target and vertical aim can miss above an NPC', () => {
  const victim = pedestrian('target', 0, 20);
  const s = scene([victim]);
  const origin = { x: .7, y: 2.1, z: -4.5 };
  s.tap({ weapon: 'pistol', aimRay: { origin, direction: { x: -.7, y: -1, z: 24.5 } } });
  assert.equal(victim.health, 60);
  s.tap({ aimRay: { origin, direction: { x: 0, y: .7, z: 1 } } });
  assert.equal(victim.health, 60);
});

test('a barrel pushed through a nearby wall cannot fire from its far side', () => {
  const victim = pedestrian('target', 0, 8);
  const s = scene([victim]);
  s.world.buildings.push({ id: 'near-wall', kind: 'building', x: 0, z: .4, width: 5, depth: .1, height: 2, yaw: 0, color: '#cccccc', style: 0 });
  s.tap({ weapon: 'pistol', aimRay: { origin: { x: .7, y: 5, z: -4 }, direction: { x: -.7, y: -3.8, z: 12 } } });
  assert.equal(victim.health, 100);
  assert.equal(s.state.combat.ammo.pistol.magazine, 11);
});

test('living dismounted officers are valid targets while seated and deceased officers are excluded', () => {
  const s = scene(); const cop = officer(0, 8); s.state.officers.push(cop);
  cop.state = 'riding'; s.tap({ weapon: 'pistol' }); assert.equal(cop.health, 100);
  cop.state = 'engaging'; s.tap(); s.tap(); s.tap();
  assert.equal(cop.health, 0); assert.equal(cop.state, 'dead'); assert.ok(cop.deadAt !== null);
  assert.equal(s.state.police.wanted, 3);
});

test('police bullets damage the player only with an unobstructed line and cannot shoot while riding or dead', () => {
  const s = scene(); const cop = officer(); s.state.officers.push(cop);
  firePoliceShot(s.world, s.state, cop);
  assert.equal(s.state.combat.health, 92);
  assert.equal(s.state.combat.shots.at(-1)?.owner, 'police');
  s.world.buildings.push({ id: 'wall', kind: 'building', x: 0, z: 6, width: 5, depth: 1, height: 5, yaw: 0, color: '#cccccc', style: 0 });
  firePoliceShot(s.world, s.state, cop); assert.equal(s.state.combat.health, 92);
  s.world.buildings = [];
  cop.state = 'riding'; firePoliceShot(s.world, s.state, cop);
  cop.state = 'dead'; cop.health = 0; firePoliceShot(s.world, s.state, cop);
  assert.equal(s.state.combat.health, 92);
});

test('death and vehicle occupancy stop attacks and reloading without consuming inventory', () => {
  const s = scene();
  s.state.player.vehicleId = 'some-car';
  s.step(2, { weapon: 'rifle', fire: true, reload: true });
  assert.equal(s.state.combat.ammo.rifle.magazine, 30);
  assert.equal(s.state.combat.reload, null);
  s.state.player.vehicleId = null;
  damagePlayer(s.state, 100);
  assert.equal(s.state.combat.dead, true); assert.equal(s.state.combat.respawnIn, 4);
  s.step(2, { fire: true, reload: true });
  assert.equal(s.state.combat.ammo.rifle.magazine, 30);
  damagePlayer(s.state, 100); assert.equal(s.state.combat.health, 0);
});

test('invalid aiming values cannot poison actor state or consume more than one normal shot', () => {
  const victim = pedestrian('target', 0, 8); const s = scene([victim]);
  s.tap({ weapon: 'pistol', viewYaw: NaN, aimRay: { origin: { x: NaN, y: 2, z: -4 }, direction: { x: 0, y: Infinity, z: 1 } } });
  assert.equal(victim.health, 60);
  assert.ok(Number.isFinite(s.state.combat.aimYaw));
  assert.equal(s.state.combat.ammo.pistol.magazine, WEAPON_SPECS.pistol.capacity - 1);
  const trace = traceBullet(s.world, s.state, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, 30);
  assert.equal(trace.kind, 'miss');
});
