import { angleDelta, dist } from './collision';
import type { Box } from './collision';
import type { CombatState, GameState, InputFrame, Pedestrian, Point, Point3, PoliceOfficer, WeaponId, World } from './types';

interface WeaponSpec {
  label: string; capacity: number; reserve: number; damage: number;
  range: number; interval: number; reloadSeconds: number; automatic: boolean;
}

/** Gameplay values shared by simulation and the ammo HUD. */
export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  knife: { label: 'Knife', capacity: 0, reserve: 0, damage: 100, range: 2.25, interval: .55, reloadSeconds: 0, automatic: false },
  pistol: { label: 'Pistol', capacity: 12, reserve: 72, damage: 40, range: 70, interval: .25, reloadSeconds: 1.35, automatic: false },
  rifle: { label: 'Assault rifle', capacity: 30, reserve: 180, damage: 25, range: 100, interval: .1, reloadSeconds: 2.1, automatic: true },
};

export function createCombatState(): CombatState {
  return {
    weapon: 'knife', ammo: {
      pistol: { magazine: WEAPON_SPECS.pistol.capacity, reserve: WEAPON_SPECS.pistol.reserve },
      rifle: { magazine: WEAPON_SPECS.rifle.capacity, reserve: WEAPON_SPECS.rifle.reserve },
    },
    reload: null, cooldown: 0, triggerHeld: false, aiming: false, aimYaw: Math.PI,
    health: 100, dead: false, respawnIn: 0,
    lastAttackAt: -10, lastDamageAt: -10, hitUntil: -10, killUntil: -10,
    shots: [], nextShotId: 1,
  };
}

type Victim = Pedestrian | PoliceOfficer;
interface TraceOptions { ignoreOfficerId?: string; ignoreVehicleId?: string; includePlayer?: boolean; sceneryOnly?: boolean }
export interface BulletHit { point: Point3; distance: number; id: string | null; kind: 'scenery' | 'pedestrian' | 'officer' | 'player' | 'miss' }
const VEHICLE_HEIGHT = { sedan: 1.95, truck: 3.55, pickup: 2.15, hatchback: 1.9, sport: 1.65 };

function normalized(vector: Point3): Point3 | null {
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) return null;
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-7 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : null;
}

/** Distance to an extruded oriented footprint, including a muzzle already in cover. */
function rayBox(origin: Point3, direction: Point3, box: Box, height: number, limit: number): number | null {
  const reach = (box.width + box.depth) / 2;
  const endX = origin.x + direction.x * limit, endZ = origin.z + direction.z * limit;
  if (Math.min(origin.x, endX) > box.x + reach || Math.max(origin.x, endX) < box.x - reach ||
      Math.min(origin.z, endZ) > box.z + reach || Math.max(origin.z, endZ) < box.z - reach) return null;
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const dx = origin.x - box.x, dz = origin.z - box.z;
  const position = [dx * c - dz * s, origin.y, dx * s + dz * c];
  const velocity = [direction.x * c - direction.z * s, direction.y, direction.x * s + direction.z * c];
  const lower = [-box.width / 2, .05, -box.depth / 2];
  const upper = [box.width / 2, height, box.depth / 2];
  let near = 0, far = limit;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(velocity[axis]) < 1e-9) {
      if (position[axis] < lower[axis] || position[axis] > upper[axis]) return null;
    } else {
      const a = (lower[axis] - position[axis]) / velocity[axis];
      const b = (upper[axis] - position[axis]) / velocity[axis];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near <= far ? near : null;
}

/** Hitscan uses the actual scenery heights; only the nearest obstruction can be hit. */
export function traceBullet(world: World, state: GameState, origin: Point3, vector: Point3, range: number, options: TraceOptions = {}): BulletHit {
  const direction = normalized(vector);
  const maximum = Number.isFinite(range) ? Math.max(0, range) : 0;
  const result: BulletHit = { point: { ...origin }, distance: maximum, id: null, kind: 'miss' };
  if (!direction || ![origin.x, origin.y, origin.z].every(Number.isFinite)) return result;
  const consider = (box: Box & { id: string }, height: number, kind: BulletHit['kind']) => {
    const distance = rayBox(origin, direction, box, height, result.distance);
    if (distance !== null && (distance < result.distance || result.kind === 'miss')) {
      result.distance = distance; result.id = box.id; result.kind = kind;
    }
  };
  // Scenery wins exact ties with actors at its surface.
  for (const solid of world.buildings) consider(solid, solid.height, 'scenery');
  for (const solid of world.obstacles) consider(solid, solid.height, 'scenery');
  for (const car of state.vehicles) if (car.active && car.id !== options.ignoreVehicleId) consider(car, VEHICLE_HEIGHT[car.model], 'scenery');
  if (direction.y < -1e-8) {
    const ground = (.08 - origin.y) / direction.y;
    if (ground >= 0 && ground < result.distance) { result.distance = ground; result.id = 'ground'; result.kind = 'scenery'; }
  }
  if (!options.sceneryOnly) {
    // The procedural heads/caps reach 2.35m including their ground offset.
    for (const person of state.pedestrians) if (person.health > 0 && person.state !== 'dead') consider({ ...person, width: .88, depth: .88 }, 2.4, 'pedestrian');
    for (const officer of state.officers) if (officer.id !== options.ignoreOfficerId && officer.health > 0 && officer.state !== 'dead' && officer.state !== 'riding') consider({ ...officer, width: .9, depth: .9 }, 2.4, 'officer');
    if (options.includePlayer && !state.combat.dead) consider({ ...state.player, id: 'player', width: .9, depth: .9 }, state.player.vehicleId ? 2.05 : 2.4, 'player');
  }
  result.point = {
    x: origin.x + direction.x * result.distance,
    y: origin.y + direction.y * result.distance,
    z: origin.z + direction.z * result.distance,
  };
  return result;
}

export function clearShot(world: World, state: GameState, from: Point3, to: Point3, ignoreVehicleId?: string): boolean {
  const vector = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const range = Math.hypot(vector.x, vector.y, vector.z);
  if (range < 1e-6) return true;
  const hit = traceBullet(world, state, from, vector, range, { sceneryOnly: true, ignoreVehicleId });
  return hit.kind === 'miss' || hit.distance >= range - .05;
}

function damageVictim(state: GameState, victim: Victim, damage: number, onCrime: (level: 1 | 3, reason: string) => void): void {
  if (victim.health <= 0 || victim.state === 'dead') return;
  victim.health = Math.max(0, victim.health - damage);
  state.combat.hitUntil = state.time + .16;
  if (victim.health === 0) {
    victim.state = 'dead'; victim.deadAt = state.time;
    state.combat.killUntil = state.time + .32;
    onCrime(3, 'Fatal attack reported. Three-star response dispatched.');
  } else if ('route' in victim) {
    victim.state = 'fleeing'; victim.timer = 3;
  }
}

function addShot(state: GameState, owner: 'player' | 'police', weapon: WeaponId, from: Point3, to: Point3, hit: boolean): void {
  const combat = state.combat;
  combat.shots.push({ id: combat.nextShotId++, owner, weapon, from, to, time: state.time, hit });
  if (combat.shots.length > 48) combat.shots.splice(0, combat.shots.length - 48);
}

function muzzleAt(person: Point, yaw: number, weapon: WeaponId): Point3 {
  const forward = weapon === 'rifle' ? .95 : .65;
  return { x: person.x + Math.sin(yaw) * forward - Math.cos(yaw) * .36,
    y: 1.72, z: person.z + Math.cos(yaw) * forward + Math.sin(yaw) * .36 };
}

function attack(world: World, state: GameState, input: InputFrame, onCrime: (level: 1 | 3, reason: string) => void): void {
  const combat = state.combat;
  const spec = WEAPON_SPECS[combat.weapon];
  const player = state.player;
  const yaw = combat.aimYaw;
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  combat.lastAttackAt = state.time;
  combat.cooldown = spec.interval;
  if (combat.weapon === 'knife') {
    const from = { x: player.x, y: 1.25, z: player.z };
    const candidates: Victim[] = [...state.pedestrians, ...state.officers.filter(o => o.state !== 'riding')];
    const victim = candidates.filter(person => person.health > 0 && person.state !== 'dead' && dist(player, person) <= spec.range &&
      Math.abs(angleDelta(yaw, Math.atan2(person.x - player.x, person.z - player.z))) < .85 &&
      clearShot(world, state, from, { x: person.x, y: 1.25, z: person.z }))
      .sort((a, b) => dist(player, a) - dist(player, b))[0];
    if (victim) damageVictim(state, victim, spec.damage, onCrime);
    addShot(state, 'player', 'knife', from, victim ? { x: victim.x, y: 1.25, z: victim.z } : { x: player.x + forward.x * spec.range, y: 1.25, z: player.z + forward.z * spec.range }, !!victim);
    return;
  }

  combat.ammo[combat.weapon].magazine--;
  onCrime(1, 'Gunfire reported. Patrols are responding.');
  const chest: Point3 = { x: player.x, y: 1.72, z: player.z };
  const muzzle = muzzleAt(player, yaw, combat.weapon);
  // If the barrel crosses a wall, the shot stops at that wall instead of spawning behind it.
  const clearance = traceBullet(world, state, chest, { x: muzzle.x - chest.x, y: 0, z: muzzle.z - chest.z }, Math.hypot(muzzle.x - chest.x, muzzle.z - chest.z), { sceneryOnly: true });
  if (clearance.kind !== 'miss') {
    addShot(state, 'player', combat.weapon, chest, clearance.point, false);
    return;
  }
  let direction: Point3 = { ...forward, y: 0 };
  const ray = input.aimRay;
  if (ray && [ray.origin.x, ray.origin.y, ray.origin.z].every(Number.isFinite) && dist(ray.origin, player) < 60) {
    const cameraDirection = normalized(ray.direction);
    if (cameraDirection) {
      const aim = traceBullet(world, state, ray.origin, cameraDirection, spec.range + 60);
      const vector = { x: aim.point.x - muzzle.x, y: aim.point.y - muzzle.y, z: aim.point.z - muzzle.z };
      // Camera cover closer than the avatar cannot reverse a shot through their body.
      if (vector.x * forward.x + vector.z * forward.z > .1) direction = normalized(vector) ?? direction;
    }
  }
  const hit = traceBullet(world, state, muzzle, direction, spec.range);
  const victim = hit.kind === 'pedestrian' ? state.pedestrians.find(p => p.id === hit.id)
    : hit.kind === 'officer' ? state.officers.find(o => o.id === hit.id) : undefined;
  if (victim) damageVictim(state, victim, spec.damage, onCrime);
  addShot(state, 'player', combat.weapon, muzzle, hit.point, !!victim);
}

/** Called at the same fixed step as locomotion; semi-auto presses cannot double-fire. */
export function updateCombat(world: World, state: GameState, dt: number, input: InputFrame, onCrime: (level: 1 | 3, reason: string) => void): void {
  const combat = state.combat;
  combat.shots = combat.shots.filter(shot => state.time - shot.time < .18);
  combat.cooldown = Math.max(0, combat.cooldown - dt);
  const fire = !!input.fire;
  const pressed = fire && !combat.triggerHeld;
  combat.triggerHeld = fire;
  if (combat.dead) { combat.reload = null; combat.aiming = false; return; }
  if (input.weapon && Object.hasOwn(WEAPON_SPECS, input.weapon) && input.weapon !== combat.weapon) {
    combat.weapon = input.weapon;
    combat.reload = null;
  }
  combat.aimYaw = Number.isFinite(input.viewYaw) ? input.viewYaw! : playerYaw(state);
  combat.aiming = !!input.aiming && !state.player.vehicleId;
  if (state.player.vehicleId) { combat.reload = null; return; }
  if (combat.reload) {
    combat.reload.remaining = Math.max(0, combat.reload.remaining - dt);
    if (combat.reload.remaining <= 1e-7) {
      const weapon = combat.reload.weapon, ammo = combat.ammo[weapon];
      const transfer = Math.min(WEAPON_SPECS[weapon].capacity - ammo.magazine, ammo.reserve);
      ammo.magazine += transfer; ammo.reserve -= transfer; combat.reload = null;
    }
  }
  if (input.reload && combat.weapon !== 'knife' && !combat.reload) {
    const ammo = combat.ammo[combat.weapon], spec = WEAPON_SPECS[combat.weapon];
    if (ammo.magazine < spec.capacity && ammo.reserve > 0) {
      combat.reload = { weapon: combat.weapon, remaining: spec.reloadSeconds, duration: spec.reloadSeconds };
    }
  }
  const spec = WEAPON_SPECS[combat.weapon];
  if (!fire || !spec.automatic && !pressed || combat.cooldown > 1e-7 || combat.reload) return;
  if (combat.weapon !== 'knife' && combat.ammo[combat.weapon].magazine <= 0) {
    if (pressed) {
      state.message = combat.ammo[combat.weapon].reserve > 0 ? 'Magazine empty. Press R to reload.' : 'Out of ammunition. Switch weapons with 1 / 2 / 3.';
      state.messageUntil = state.time + 2;
    }
    return;
  }
  attack(world, state, input, onCrime);
}

function playerYaw(state: GameState): number { return Number.isFinite(state.player.yaw) ? state.player.yaw : Math.PI; }

export function damagePlayer(state: GameState, damage: number): void {
  if (state.combat.dead || !Number.isFinite(damage) || damage <= 0) return;
  const combat = state.combat;
  combat.health = Math.max(0, combat.health - damage);
  combat.lastDamageAt = state.time;
  if (combat.health === 0) {
    combat.dead = true; combat.respawnIn = 4; combat.reload = null;
    state.player.moving = false;
    const car = state.vehicles.find(v => v.id === state.player.vehicleId);
    if (car) car.speed = 0;
  }
}

/** Use the barrel path for engagement decisions as well as the final bullet. */
export function canPoliceShoot(world: World, state: GameState, officer: PoliceOfficer): boolean {
  if (officer.health <= 0 || officer.state === 'dead' || officer.state === 'riding' || state.combat.dead) return false;
  const player = state.player;
  const muzzle = muzzleAt(officer, Math.atan2(player.x - officer.x, player.z - officer.z), 'pistol');
  const ignoreVehicle = player.vehicleId ?? undefined;
  return clearShot(world, state, { x: officer.x, y: 1.72, z: officer.z }, muzzle, ignoreVehicle) &&
    clearShot(world, state, muzzle, { x: player.x, y: player.vehicleId ? 1.5 : 1.25, z: player.z }, ignoreVehicle);
}

/** Officers shoot through the same cover as the player, including other vehicles. */
export function firePoliceShot(world: World, state: GameState, officer: PoliceOfficer): void {
  if (officer.health <= 0 || officer.state === 'dead' || officer.state === 'riding' || state.combat.dead) return;
  const player = state.player;
  const chest = { x: officer.x, y: 1.72, z: officer.z };
  const from = muzzleAt(officer, Math.atan2(player.x - officer.x, player.z - officer.z), 'pistol');
  const clearance = traceBullet(world, state, chest, { x: from.x - chest.x, y: 0, z: from.z - chest.z }, Math.hypot(from.x - chest.x, from.z - chest.z), {
    sceneryOnly: true, ignoreVehicleId: player.vehicleId ?? undefined,
  });
  if (clearance.kind !== 'miss') { addShot(state, 'police', 'pistol', chest, clearance.point, false); return; }
  const target = { x: player.x, y: player.vehicleId ? 1.5 : 1.25, z: player.z };
  const hit = traceBullet(world, state, from, { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z }, 55, {
    ignoreOfficerId: officer.id, ignoreVehicleId: player.vehicleId ?? undefined, includePlayer: true,
  });
  if (hit.kind === 'player') damagePlayer(state, 8);
  addShot(state, 'police', 'pistol', from, hit.point, hit.kind === 'player');
}
