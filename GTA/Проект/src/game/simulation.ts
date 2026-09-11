import { planTrafficBypass, trafficPoseClear, type TrafficPose } from './traffic';
import { contactNormal, driveEfficiency, resolveVehicleImpact } from './damage';
import { angleDelta, boxIntersects, circleIntersectsBox, clamp, dist } from './collision';
import { createPedestrians, createVehicles, MISSION_CAR_ID, routeToTarget, steerToward } from './ai';
import type { GameState, InputFrame, Pedestrian, Point, PoliceOfficer, SimulationApi, Vehicle, World } from './types';
import { createWorld } from './world';
import { VEHICLE_SPECS } from './vehicles';
import { canPoliceShoot, createCombatState, firePoliceShot, updateCombat } from './combat';
import { policeCanSee, policeEscapeDuration, policeLaneRoute, policeLimit, policeObjective, policeOfficerPath, policeSighting } from './policePursuit';

const FOOT_RADIUS = 0.48;
const FIXED_STEP = 1 / 90;
const SPAWN = { x: 13, z: 36 };
const TAU = Math.PI * 2;
const WATER_MARGIN = 150;

/** Deterministic ground-plane dynamics for vertically extruded 3D colliders. */
export class Simulation implements SimulationApi {
  world: World = createWorld();
  state: GameState = {
    time: 0, player: { ...SPAWN, yaw: Math.PI, vehicleId: null, moving: false, swimming: false },
    vehicles: createVehicles(this.world), pedestrians: createPedestrians(this.world),
    mission: { phase: 'available', elapsed: 0, best: null, deliveryHold: 0 },
    police: { wanted: 0, escape: 0, caught: 0, cooldown: 0, lastSeen: null, spotted: false, reinforcementTimer: 7 },
    combat: createCombatState(), officers: [],
    message: 'A delivery is waiting at the amber beacon. Walk over and press E.', messageUntil: 8, collisions: 0,
  };
  private collisionCooldown = 0;
  private policeRouteTimer = 0;
  private pedestrianHitCooldown = 0;
  private lastInteract = false;
  private lastRestart = false;
  private deathHandled = false;
  private nextPoliceId = 2;
  private officerRoutes = new Map<string, { points: Point[]; waypoint: number; remaining: number }>();
  private policeDriving = new Map<string, { reverse: number; side: number; avoidance: Point | null; avoidTime: number }>();
  private policeVehicleMovingUntil = 0;
  private trafficDriving = new Map<string, { wait: number; retry: number; path: TrafficPose[]; index: number; reverseNeeded: boolean }>();

  getControlled(): Point & { yaw: number } { return this.controlledCar() ?? this.state.player; }

  private controlledCar(): Vehicle | undefined {
    return this.state.vehicles.find(v => v.id === this.state.player.vehicleId);
  }

  private message(text: string, seconds = 4): void {
    this.state.message = text;
    this.state.messageUntil = this.state.time + seconds;
  }

  step(dt: number, input: InputFrame): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!this.state.combat.dead && input.restart && !this.lastRestart) this.restartMission();
    if (input.interact && !this.lastInteract) this.interact();
    this.lastRestart = input.restart;
    this.lastInteract = input.interact;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-7) {
      const tick = Math.min(FIXED_STEP, remaining);
      this.tick(tick, input);
      remaining -= tick;
    }
  }

  private tick(dt: number, input: InputFrame): void {
    const s = this.state;
    s.time += dt;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    this.pedestrianHitCooldown = Math.max(0, this.pedestrianHitCooldown - dt);
    s.police.cooldown = Math.max(0, s.police.cooldown - dt);
    this.updateImpactMotion(dt);
    const car = this.controlledCar();
    if (!s.combat.dead) {
      if (car) this.updateDriving(car, dt, input); else this.updateWalking(dt, input);
    } else {
      s.player.moving = false;
      if (car) car.speed = 0;
    }
    updateCombat(this.world, s, dt, input, (level, reason) => this.raiseWanted(reason, level));
    this.updatePedestrians(dt);
    this.updateTraffic(dt);
    this.updatePolice(dt);
    if (s.combat.dead) this.updateDeath(dt); else this.updateMission(dt);
  }

  private isWaterPoint(x: number, z: number): boolean {
    const islandEdge = this.world.size / 2 - .62;
    return Math.abs(x) > islandEdge || Math.abs(z) > islandEdge;
  }

  private footBlocked(x: number, z: number, ignoreVehicle?: string, radius = FOOT_RADIUS, ignoreOfficer?: string, allowWater = false): boolean {
    const islandEdge = this.world.size / 2 - .62;
    if (allowWater) {
      const waterLimit = this.world.size / 2 + WATER_MARGIN;
      if (Math.abs(x) + radius > waterLimit || Math.abs(z) + radius > waterLimit) return true;
      if (this.isWaterPoint(x, z)) return false;
    } else if (Math.abs(x) + radius > islandEdge || Math.abs(z) + radius > islandEdge) return true;
    for (const solid of this.world.buildings) if (circleIntersectsBox(x, z, radius, solid)) return true;
    for (const solid of this.world.obstacles) if (circleIntersectsBox(x, z, radius, solid)) return true;
    if (this.state.vehicles.some(v => v.active && v.id !== ignoreVehicle && circleIntersectsBox(x, z, radius, v))) return true;
    return this.state.officers.some(officer => officer.id !== ignoreOfficer && officer.state !== 'riding' && officer.state !== 'dead' && dist({ x, z }, officer) < radius + 0.38);
  }

  private vehicleBlock(car: Vehicle, x: number, z: number, yaw: number, includePlayer = true): string | null {
    const test = { x, z, yaw, width: car.width, depth: car.depth };
    const extentX = Math.abs(Math.cos(yaw)) * car.width / 2 + Math.abs(Math.sin(yaw)) * car.depth / 2;
    const extentZ = Math.abs(Math.sin(yaw)) * car.width / 2 + Math.abs(Math.cos(yaw)) * car.depth / 2;
    if (Math.abs(x) + extentX > this.world.size / 2 - 1 || Math.abs(z) + extentZ > this.world.size / 2 - 1) return 'boundary';
    for (const solid of this.world.buildings) if (boxIntersects(test, solid, 0.035)) return solid.id;
    for (const solid of this.world.obstacles) if (boxIntersects(test, solid, 0.035)) return solid.id;
    for (const other of this.state.vehicles) {
      if (other.active && other.id !== car.id && boxIntersects(test, other, 0.035)) return other.id;
    }
    for (const officer of this.state.officers) {
      if (officer.state !== 'riding' && officer.state !== 'dead' && circleIntersectsBox(officer.x, officer.z, 0.48, test)) return officer.id;
    }
    if (includePlayer && !this.state.player.vehicleId && circleIntersectsBox(this.state.player.x, this.state.player.z, FOOT_RADIUS + 0.15, test)) return 'player';
    return null;
  }

  private updateWalking(dt: number, input: InputFrame): void {
    const p = this.state.player;
    const wasSwimming = p.swimming;
    p.swimming = this.isWaterPoint(p.x, p.z);
    const strafe = Number.isFinite(input.turn) ? clamp(input.turn, -1, 1) : 0;
    const forward = Number.isFinite(input.forward) ? clamp(input.forward, -1, 1) : 0;
    const viewYaw = input.viewYaw;
    const sin = viewYaw !== undefined && Number.isFinite(viewYaw) ? Math.sin(viewYaw) : 0;
    const cos = viewYaw !== undefined && Number.isFinite(viewYaw) ? Math.cos(viewYaw) : -1;
    const dx = forward * sin - strafe * cos;
    const dz = forward * cos + strafe * sin;
    const length = Math.hypot(dx, dz);
    p.moving = length > 0;
    if (!length) return;
    const swimmingNext = p.swimming || this.isWaterPoint(p.x + dx * .3, p.z + dz * .3);
    const speed = swimmingNext ? (input.sprint ? 3.8 : 2.9) : input.sprint ? 8 : 5.2;
    const moveX = dx / length * speed * dt;
    const moveZ = dz / length * speed * dt;
    p.yaw += angleDelta(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * (swimmingNext ? 8 : 16));
    if (!this.footBlocked(p.x + moveX, p.z, undefined, FOOT_RADIUS, undefined, true)) p.x += moveX;
    if (!this.footBlocked(p.x, p.z + moveZ, undefined, FOOT_RADIUS, undefined, true)) p.z += moveZ;
    p.swimming = this.isWaterPoint(p.x, p.z);
    if (!wasSwimming && p.swimming) this.message('Swimming · use movement controls to head back to shore.', 3);
  }

  private applyCollision(car: Vehicle, blocked: string, x: number, z: number, yaw: number): void {
    const other = this.state.vehicles.find(v => v.id === blocked);
    const solid = this.world.buildings.find(v => v.id === blocked) ?? this.world.obstacles.find(v => v.id === blocked);
    let normal;
    if (other || solid) normal = contactNormal({ ...car, x, z, yaw }, (other ?? solid)!);
    else if (blocked === 'boundary') {
      const ex = Math.abs(Math.cos(yaw)) * car.width / 2 + Math.abs(Math.sin(yaw)) * car.depth / 2;
      const ez = Math.abs(Math.sin(yaw)) * car.width / 2 + Math.abs(Math.cos(yaw)) * car.depth / 2;
      normal = Math.abs(x) + ex > Math.abs(z) + ez ? { x: Math.sign(x), z: 0 } : { x: 0, z: Math.sign(z) };
    } else { car.speed = 0; return; }
    const energy = resolveVehicleImpact(car, other ?? null, normal, this.state.time);
    const playerInvolved = car.id === this.state.player.vehicleId || other?.id === this.state.player.vehicleId;
    if (playerInvolved && energy > 1800 && this.collisionCooldown <= 0) {
      this.state.collisions++; this.collisionCooldown = .2;
      if (other && (energy > 25000 || other.kind === 'police')) this.raiseWanted('Vehicle collision reported. Lose the patrol to clear your heat.');
      if (car.id === this.state.player.vehicleId && driveEfficiency(car) === 0) this.message('Engine disabled. Exit the car or restart the delivery.', 4);
    }
  }

  private updateImpactMotion(dt: number): void {
    for (const car of this.state.vehicles) {
      const d = car.damage;
      if (!d || !car.active) continue;
      if (Math.hypot(d.driftX, d.driftZ) > .01) {
        const x = car.x + d.driftX * dt, z = car.z + d.driftZ * dt;
        const blocked = this.vehicleBlock(car, x, z, car.yaw, false);
        if (blocked) { this.applyCollision(car, blocked, x, z, car.yaw); d.driftX *= .5; d.driftZ *= .5; }
        else { car.x = x; car.z = z; }
      }
      d.driftX *= Math.exp(-3 * dt); d.driftZ *= Math.exp(-3 * dt);
      if (driveEfficiency(car) === 0) car.speed *= Math.exp(-2 * dt);
    }
  }

  private updateDriving(car: Vehicle, dt: number, input: InputFrame): void {
    const throttle = Number.isFinite(input.forward) ? clamp(input.forward, -1, 1) : 0;
    const efficiency = driveEfficiency(car);
    car.throttle = throttle; car.braking = input.brake || (throttle * car.speed < -.4);
    const turn = Number.isFinite(input.turn) ? clamp(input.turn, -1, 1) : 0;
    if (input.brake) {
      car.speed = Math.sign(car.speed) * Math.max(0, Math.abs(car.speed) - 20 * dt);
    } else if (throttle) {
      const braking = Math.sign(throttle) !== Math.sign(car.speed) && Math.abs(car.speed) > 0.4;
      car.speed += throttle * (braking ? 17 : throttle > 0 ? 10.2 * efficiency : 6.4 * efficiency) * dt;
    }
    car.speed *= Math.exp(-(throttle && !input.brake ? 0.11 : 0.56) * dt);
    if (Math.abs(car.speed) < 0.018) car.speed = 0;
    car.speed = clamp(car.speed, -10, 29);
    const bias = ((car.damage?.left ?? 0) - (car.damage?.right ?? 0)) * .12;
    car.steer += (-turn * 0.58 + bias - car.steer) * Math.min(1, 7 * dt);
    const speedTurn = car.speed / (1 + Math.abs(car.speed) * 0.07);
    let yaw = car.yaw + Math.tan(car.steer) * speedTurn / 3.05 * dt;
    let x = car.x + Math.sin(yaw) * car.speed * dt;
    let z = car.z + Math.cos(yaw) * car.speed * dt;
    let blocked = this.vehicleBlock(car, x, z, yaw, false);
    if (blocked) {
      const straightX = car.x + Math.sin(car.yaw) * car.speed * dt;
      const straightZ = car.z + Math.cos(car.yaw) * car.speed * dt;
      if (!this.vehicleBlock(car, straightX, straightZ, car.yaw, false)) {
        x = straightX; z = straightZ; yaw = car.yaw; blocked = null;
      }
    }
    if (blocked) this.applyCollision(car, blocked, x, z, yaw);
    else { car.x = x; car.z = z; car.yaw = yaw % TAU; }
    const p = this.state.player;
    p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.moving = Math.abs(car.speed) > 0.1; p.swimming = false;
    if (Math.abs(car.speed) > 3 && this.pedestrianHitCooldown <= 0) {
      for (const pedestrian of this.state.pedestrians) {
        if (pedestrian.state === 'dead' || !circleIntersectsBox(pedestrian.x, pedestrian.z, .36, car)) continue;
        pedestrian.health = 0; pedestrian.state = 'dead'; pedestrian.deadAt = this.state.time;
        this.pedestrianHitCooldown = .4;
        this.raiseWanted('Pedestrian struck. Patrols are responding.', 3);
        break;
      }
    }
  }

  private updateTraffic(dt: number): void {
    const traffic = this.state.vehicles.filter(v => v.kind === 'traffic' && v.active);
    for (const car of traffic) {
      const route = car.route;
      if (!route.length) continue;
      let target = route[car.waypoint];
      while (dist(car, target) < 5) target = route[car.waypoint = (car.waypoint + 1) % route.length];
      const desired = Math.atan2(target.x - car.x, target.z - car.z);
      const memory = this.trafficDriving.get(car.id) ?? { wait: 0, retry: 0, path: [], index: 0, reverseNeeded: false };
      this.trafficDriving.set(car.id, memory);
      memory.retry = Math.max(0, memory.retry - dt);
      let maximum = 9.5;
      if (memory.path.length) {
        const pose = memory.path[Math.min(memory.index, memory.path.length - 1)];
        if (dist(car, pose) < 2.4 && memory.index < memory.path.length - 1) memory.index++;
        const waypoint = memory.path[Math.min(memory.index, memory.path.length - 1)];
        steerToward(car, waypoint, dt, 7.5);
        if (memory.index >= memory.path.length - 1 && dist(car, waypoint) < 3) memory.path = [];
      } else {
        car.speed += clamp(maximum - car.speed, -9 * dt, 4.5 * dt);
        car.yaw += clamp(angleDelta(car.yaw, desired), -1.6 * dt, 1.6 * dt);
        car.steer = clamp(-angleDelta(car.yaw, desired), -.55, .55);
      }
      const x = car.x + Math.sin(car.yaw) * car.speed * dt;
      const z = car.z + Math.cos(car.yaw) * car.speed * dt;
      const blocked = this.vehicleBlock(car, x, z, car.yaw, false);
      if (!blocked && trafficPoseClear(this.world, this.state, car, { x, z, yaw: car.yaw })) {
        car.x = x; car.z = z; car.blocked = Math.max(0, car.blocked - dt * 2); memory.wait = 0;
      } else {
        car.speed = Math.max(0, car.speed - 13 * dt); car.blocked += dt; memory.wait += dt;
        if (memory.wait > .8 && memory.retry <= 0 && !memory.path.length) {
          const plan = planTrafficBypass(this.world, this.state, car);
          if (plan.length) { memory.path = plan; memory.index = 0; memory.retry = 2; }
          else memory.retry = .8;
        }
      }
    }
  }

  private updatePedestrians(dt: number): void {
    for (const p of this.state.pedestrians) {
      if (p.state === 'dead') continue;
      p.phase += dt * p.speed * 2;
      if (p.state === 'waiting') { p.timer -= dt; if (p.timer <= 0) p.state = 'walking'; continue; }
      if (p.state === 'fleeing') { p.timer -= dt; if (p.timer <= 0) p.state = 'walking'; }
      const target = p.route[p.waypoint];
      const dx = target.x - p.x, dz = target.z - p.z, len = Math.hypot(dx, dz);
      if (len < .45) { p.waypoint = (p.waypoint + 1) % p.route.length; continue; }
      const speed = p.state === 'fleeing' ? p.speed * 1.7 : p.speed;
      const x = p.x + dx / len * speed * dt; const z = p.z + dz / len * speed * dt;
      const blockedByPedestrian = this.state.pedestrians.some(other => other !== p && other.state !== 'dead' && (other.x - x) ** 2 + (other.z - z) ** 2 < 0.5776);
      if (!blockedByPedestrian && !this.footBlocked(x, z, undefined, 0.36)) {
        p.x = x; p.z = z; p.yaw += angleDelta(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
      } else this.redirectPedestrian(p);
    }
  }

  private redirectPedestrian(p: Pedestrian): void {
    p.route = [...p.route].reverse();
    p.waypoint = (p.route.length - p.waypoint) % p.route.length;
    p.state = 'waiting'; p.timer = 0.45 + (Number(p.id.slice(4)) % 7) * 0.17;
  }

  private raiseWanted(reason: string, level: 1 | 3 = 1): void {
    if (this.state.combat.dead || level < 3 && this.state.police.cooldown > 0) return;
    const previous = this.state.police.wanted;
    this.state.police.wanted = Math.max(previous, level);
    this.state.police.escape = 0;
    this.state.police.lastSeen = policeSighting(this.state);
    if (level === 3) this.state.police.cooldown = 0;
    if (previous >= level) return;
    this.message(reason, 5);
    this.policeRouteTimer = 0;
    this.state.police.reinforcementTimer = 5;
    this.dispatchPolice(Math.min(3, policeLimit(this.state.police.wanted)), false);
  }

  private dispatchPolice(count: number, reinforcement: boolean): void {
    const target = this.state.police.lastSeen;
    if (!target) return;
    const roadEnd = this.world.size / 2 - this.world.roadWidth - 2;
    const roadSpacing = this.world.roads[1] - this.world.roads[0];
    const centralResponse = Math.max(Math.abs(target.x), Math.abs(target.z)) < roadSpacing * 1.75;
    const outerStations = [-roadEnd, ...this.world.roads.slice(0, -1).flatMap((road, index) => {
      const span = this.world.roads[index + 1] - road;
      return [road + span * 0.25, road + span * 0.75];
    }), roadEnd];
    const stations = centralResponse ? [-122, -95, -45, 35, 100, 122] : outerStations;
    const roads = centralResponse ? this.world.roads.filter(road => Math.abs(road) <= roadSpacing) : this.world.roads;
    const patrols = this.state.vehicles.filter(car => car.kind === 'police');
    const empty = (car: Vehicle) => this.state.officers.some(officer => officer.vehicleId === car.id && officer.state === 'dead');
    const active = patrols.filter(car => car.active && !empty(car)).length;
    const available = patrols.filter(car => !car.active && !empty(car));
    while (active + available.length < count) {
      const template = patrols[0];
      if (!template) break;
      let id = `police-${this.nextPoliceId++}`;
      while (this.state.vehicles.some(car => car.id === id)) id = `police-${this.nextPoliceId++}`;
      const replacement: Vehicle = { ...template, id, speed: 0, steer: 0, route: [], waypoint: 0, blocked: 0, active: false };
      this.state.vehicles.push(replacement);
      available.push(replacement);
    }
    for (const police of available.slice(0, Math.max(0, count - active))) {
      const candidates = roads.flatMap(road => stations.flatMap(t => [{ x: road, z: t }, { x: t, z: road }]));
      const occupied = this.state.vehicles.filter(car => car.kind === 'police' && car.active && !empty(car));
      const score = (point: Point): number => Math.abs(dist(point, target) - (reinforcement ? 100 : 58)) +
        occupied.reduce((sum, other) => sum + Math.max(0, 65 - dist(point, other)) * 2.5, 0);
      candidates.sort((a, b) => score(a) - score(b));
      const heading = (point: Point): number => {
        const route = routeToTarget(point, target, this.world);
        const first = route.find(next => dist(point, next) > 4) ?? target;
        return Math.atan2(first.x - point.x, first.z - point.z);
      };
      // Regional districts need nearby patrol stations. Keep central authored response unchanged,
      // but allow a visible satellite-city responder to enter at a believable city-block distance.
      const visibleSpawnDistance = centralResponse ? 125 : reinforcement ? 92 : 72;
      const spot = candidates.find(point => dist(point, target) > (reinforcement ? 72 : 40) &&
        (dist(point, this.getControlled()) >= visibleSpawnDistance || !policeCanSee(this.world, this.state, point, police.id, Infinity)) &&
        occupied.every(other => dist(point, other) > 18) && !this.vehicleBlock(police, point.x, point.z, heading(point)));
      if (spot) {
        police.x = spot.x; police.z = spot.z; police.yaw = heading(spot); police.speed = 0;
        police.active = true; police.route = []; police.waypoint = 0; police.blocked = 0;
        this.policeDriving.delete(police.id);
      }
    }
  }

  private updateDeath(dt: number): void {
    const s = this.state;
    if (!this.deathHandled) {
      this.deathHandled = true;
      if (s.mission.phase === 'collect' || s.mission.phase === 'deliver') s.mission.phase = 'failed';
      s.combat.reload = null;
      s.player.moving = false;
      const car = this.controlledCar();
      if (car) car.speed = 0;
      this.message('You were taken down. Returning to Portside Dispatch…', 4);
    }
    s.combat.respawnIn = Math.max(0, s.combat.respawnIn - dt);
    if (s.combat.respawnIn > 0) return;
    this.restartMission();
    s.combat = createCombatState();
    this.deathHandled = false;
    this.message('Back on your feet. Your parked vehicles are still in the city.', 4);
  }

  private ensureOfficer(car: Vehicle): PoliceOfficer {
    let officer = this.state.officers.find(unit => unit.vehicleId === car.id);
    if (!officer) {
      officer = { id: `officer-${car.id}`, vehicleId: car.id, x: car.x, z: car.z, yaw: car.yaw,
        health: 100, state: 'riding', fireCooldown: 1.2, phase: 0, deadAt: null };
      this.state.officers.push(officer);
    }
    return officer;
  }

  private officerDoors(car: Vehicle): Point[] {
    const sideDistance = car.width / 2 + 0.9;
    return [1, -1].flatMap(side => [0.5, -1, 1.5].map(offset => ({
      x: car.x + Math.cos(car.yaw) * side * sideDistance + Math.sin(car.yaw) * offset,
      z: car.z - Math.sin(car.yaw) * side * sideDistance + Math.cos(car.yaw) * offset,
    })));
  }

  private officerBlocked(officer: PoliceOfficer, point: Point): boolean {
    if (this.footBlocked(point.x, point.z, undefined, 0.38, officer.id)) return true;
    if (!this.state.player.vehicleId && !this.state.combat.dead && dist(point, this.state.player) < 0.9) return true;
    if (this.state.pedestrians.some(person => person.state !== 'dead' && dist(point, person) < 0.74)) return true;
    return this.state.officers.some(other => other !== officer && other.state !== 'riding' && other.state !== 'dead' && dist(point, other) < 0.78);
  }

  private dismountOfficer(car: Vehicle, officer: PoliceOfficer): void {
    const exit = this.officerDoors(car).find(point => !this.officerBlocked(officer, point));
    if (!exit) return;
    officer.x = exit.x; officer.z = exit.z; officer.yaw = car.yaw;
    officer.state = 'engaging'; officer.fireCooldown = 1.2 + Number(car.id.slice('police-'.length)) % 2 * 0.2;
    car.speed = 0; car.route = []; car.waypoint = 0;
    this.officerRoutes.delete(officer.id);
  }

  private brakePolice(car: Vehicle, dt: number): void {
    car.speed = Math.sign(car.speed) * Math.max(0, Math.abs(car.speed) - 18 * dt);
    const x = car.x + Math.sin(car.yaw) * car.speed * dt;
    const z = car.z + Math.cos(car.yaw) * car.speed * dt;
    if (this.vehicleBlock(car, x, z, car.yaw) || this.policePedestrianHazard(car, x, z, car.yaw)) car.speed = 0;
    else { car.x = x; car.z = z; }
  }

  private policePedestrianHazard(car: Vehicle, x: number, z: number, yaw: number): boolean {
    return this.state.pedestrians.some(person => person.state !== 'dead' &&
      circleIntersectsBox(person.x, person.z, .55, { x, z, yaw, width: car.width, depth: car.depth + .8 }));
  }

  private moveOfficer(officer: PoliceOfficer, target: Point, dt: number): void {
    const distance = dist(officer, target);
    if (distance < 0.15) return;
    const direction = Math.atan2(target.x - officer.x, target.z - officer.z);
    const side = Number(officer.id.slice(-1)) % 2 ? -1 : 1;
    const stride = Math.min(distance, dt * 4.4);
    for (const offset of [0, side * Math.PI / 4, -side * Math.PI / 4, side * Math.PI / 2, -side * Math.PI / 2]) {
      const yaw = direction + offset;
      const next = { x: officer.x + Math.sin(yaw) * stride, z: officer.z + Math.cos(yaw) * stride };
      if (this.officerBlocked(officer, next)) continue;
      officer.x = next.x; officer.z = next.z;
      officer.yaw += angleDelta(officer.yaw, yaw) * Math.min(1, dt * 12);
      officer.phase += stride * 2.8;
      break;
    }
  }

  private updateOfficer(officer: PoliceOfficer, car: Vehicle, target: Point, dt: number, returning: boolean, visible = true): void {
    if (officer.state === 'dead') { car.speed = 0; return; }
    if (officer.state === 'riding') { officer.x = car.x; officer.z = car.z; officer.yaw = car.yaw; return; }
    car.speed = 0;
    officer.fireCooldown = Math.max(0, officer.fireCooldown - dt);
    if (returning) {
      const newlyReturning = officer.state !== 'returning';
      officer.state = 'returning';
      if (newlyReturning) this.officerRoutes.delete(officer.id);
      const doors = this.officerDoors(car).sort((a, b) => dist(officer, a) - dist(officer, b));
      const door = doors.find(point => !this.officerBlocked(officer, point)) ?? doors[0];
      if (dist(officer, door) < 0.6) {
        officer.state = 'riding'; officer.x = car.x; officer.z = car.z; officer.yaw = car.yaw;
        car.route = []; car.waypoint = 0; this.policeRouteTimer = 0;
        this.officerRoutes.delete(officer.id);
      } else {
        let route = this.officerRoutes.get(officer.id);
        if (!route || route.remaining <= 0) {
          route = { points: policeOfficerPath(this.world, this.state, officer, door), waypoint: 0, remaining: 3 };
          this.officerRoutes.set(officer.id, route);
        }
        route.remaining -= dt;
        while (route.waypoint < route.points.length - 1 && dist(officer, route.points[route.waypoint]) < .55) route.waypoint++;
        const goal = route.points[route.waypoint];
        if (goal) this.moveOfficer(officer, goal, dt);
      }
      return;
    }
    officer.state = 'engaging';
    const canShoot = visible && canPoliceShoot(this.world, this.state, officer);
    const distance = dist(officer, target);
    if (distance > 12 || !canShoot) {
      let goal = target;
      if (!canShoot) {
        let route = this.officerRoutes.get(officer.id);
        if (!route || route.remaining <= 0) {
          route = { points: [...routeToTarget(officer, target, this.world), { x: target.x, z: target.z }], waypoint: 0, remaining: 1.5 };
          this.officerRoutes.set(officer.id, route);
        }
        route.remaining -= dt;
        while (route.waypoint < route.points.length - 1 && dist(officer, route.points[route.waypoint]) < 1) route.waypoint++;
        goal = route.points[route.waypoint];
      } else this.officerRoutes.delete(officer.id);
      this.moveOfficer(officer, goal, dt);
    }
    officer.yaw += angleDelta(officer.yaw, Math.atan2(target.x - officer.x, target.z - officer.z)) * Math.min(1, dt * 10);
    if (canShoot && distance < 48 && officer.fireCooldown <= 0 && !this.state.combat.dead) {
      firePoliceShot(this.world, this.state, officer);
      officer.fireCooldown = 0.85 + Number(car.id.slice('police-'.length)) % 2 * 0.18;
    }
  }

  private lineClear(from: Point, to: Point): boolean {
    const length = dist(from, to);
    const n = Math.ceil(length / 1.8);
    for (let i = 1; i < n; i++) {
      const x = from.x + (to.x - from.x) * i / n; const z = from.z + (to.z - from.z) * i / n;
      if ([...this.world.buildings, ...this.world.obstacles].some(s => circleIntersectsBox(x, z, 1.25, s))) return false;
    }
    return true;
  }

  private pursuitRoute(car: Vehicle, target: Point): Point[] {
    const route = routeToTarget(car, target, this.world);
    if (this.state.police.wanted < 3 || route.length < 2) return route;
    const entry = route[0];
    const lane = this.world.roadWidth / 2;
    const alreadyOnVerticalRoad = this.world.roads.includes(entry.x) && Math.abs(entry.z - car.z) < 0.01 &&
      Math.abs(Math.cos(car.yaw)) > 0.7 && Math.abs(entry.x - car.x) + car.width / 2 < lane;
    const alreadyOnHorizontalRoad = this.world.roads.includes(entry.z) && Math.abs(entry.x - car.x) < 0.01 &&
      Math.abs(Math.sin(car.yaw)) > 0.7 && Math.abs(entry.z - car.z) + car.width / 2 < lane;
    return alreadyOnVerticalRoad || alreadyOnHorizontalRoad ? route.slice(1) : route;
  }

  private drivePolice(car: Vehicle, dt: number, maximum: number): void {
    if (!car.route.length) { this.brakePolice(car, dt); return; }
    let memory = this.policeDriving.get(car.id);
    if (!memory) {
      memory = { reverse: 0, side: Number(car.id.slice(7)) % 2 ? -1 : 1, avoidance: null, avoidTime: 0 };
      this.policeDriving.set(car.id, memory);
    }
    memory.avoidTime = Math.max(0, memory.avoidTime - dt);
    if (memory.avoidance && (memory.avoidTime <= 0 || dist(car, memory.avoidance) < 2.5)) memory.avoidance = null;
    if (memory.reverse > 0) {
      memory.reverse -= dt; car.speed = Math.max(-4, car.speed - 8 * dt);
      const x = car.x + Math.sin(car.yaw) * car.speed * dt, z = car.z + Math.cos(car.yaw) * car.speed * dt;
      if (!this.vehicleBlock(car, x, z, car.yaw, false)) { car.x = x; car.z = z; }
      if (memory.reverse <= 0) { car.blocked = 0; car.speed = 0; memory.side *= -1; this.policeRouteTimer = 0; }
      return;
    }
    let target = car.route[car.waypoint];
    while (car.waypoint < car.route.length - 1 && dist(car, target) < 5) target = car.route[++car.waypoint];
    if (car.waypoint === car.route.length - 1 && dist(car, target) < 2.8) { this.brakePolice(car, dt); return; }
    let desiredSpeed = maximum;
    const distance = dist(car, target);
    const next = car.route[car.waypoint + 1];
    if (next) {
      const incoming = Math.atan2(target.x - car.x, target.z - car.z);
      const outgoing = Math.atan2(next.x - target.x, next.z - target.z);
      if (Math.abs(angleDelta(incoming, outgoing)) > .45) desiredSpeed = Math.min(desiredSpeed, Math.sqrt(4.5 ** 2 + 21 * Math.max(0, distance - 6)));
    } else desiredSpeed = Math.min(desiredSpeed, Math.sqrt(5 ** 2 + 20 * Math.max(0, distance - 4)));

    const forward = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    const right = { x: forward.z, z: -forward.x };
    const lookAhead = 10 + Math.max(0, car.speed) * .9;
    let obstacle: Vehicle | undefined;
    let gap = Infinity;
    for (const other of this.state.vehicles) {
      if (!other.active || other === car) continue;
      const dx = other.x - car.x, dz = other.z - car.z;
      const along = dx * forward.x + dz * forward.z;
      const across = Math.abs(dx * right.x + dz * right.z);
      const otherSide = Math.abs(Math.sin(other.yaw - car.yaw)) * other.depth / 2 + Math.abs(Math.cos(other.yaw - car.yaw)) * other.width / 2;
      if (along > 0 && along < lookAhead && across < car.width / 2 + otherSide + .65 && along < gap) { obstacle = other; gap = along; }
    }
    if (obstacle && !memory.avoidance) {
      const relativeSpeed = Math.max(0, obstacle.speed * Math.cos(obstacle.yaw - car.yaw));
      desiredSpeed = Math.min(desiredSpeed, Math.max(0, relativeSpeed + (gap - car.depth / 2 - obstacle.depth / 2 - 3) * 1.4));
      if (obstacle.id !== this.state.player.vehicleId && gap < 22 && (relativeSpeed < maximum - 3 || car.blocked > .15)) {
        for (const side of [memory.side, -memory.side]) {
          const shift = (car.width + obstacle.width) / 2 + 2;
          const bypass = { x: obstacle.x + forward.x * 9 + right.x * side * shift, z: obstacle.z + forward.z * 9 + right.z * side * shift };
          const middle = { x: car.x + forward.x * Math.max(4, gap * .4) + right.x * side * shift, z: car.z + forward.z * Math.max(4, gap * .4) + right.z * side * shift };
          if (this.vehicleBlock(car, middle.x, middle.z, car.yaw) || this.vehicleBlock(car, bypass.x, bypass.z, car.yaw)) continue;
          const inRoad = this.world.roads.some(road => Math.abs(bypass.x - road) < this.world.roadWidth / 2 - car.width || Math.abs(bypass.z - road) < this.world.roadWidth / 2 - car.width);
          if (!inRoad || !this.lineClear(car, middle) || !this.lineClear(middle, bypass)) continue;
          memory.avoidance = bypass; memory.avoidTime = 2.8; memory.side = side;
          desiredSpeed = Math.min(maximum, 12); break;
        }
      }
    }
    if (memory.avoidance) { target = memory.avoidance; desiredSpeed = Math.min(maximum, 14); }
    const angle = angleDelta(car.yaw, Math.atan2(target.x - car.x, target.z - car.z));
    if (Math.abs(angle) > .55) desiredSpeed = Math.min(desiredSpeed, Math.abs(angle) > 1.2 ? 3.5 : 6.5);
    car.speed += clamp(desiredSpeed * driveEfficiency(car) - car.speed, -15 * dt, 8.5 * dt);
    const yaw = car.yaw + clamp(angle, -(0.65 + Math.abs(car.speed) * .12) * dt, (0.65 + Math.abs(car.speed) * .12) * dt);
    const x = car.x + Math.sin(yaw) * car.speed * dt, z = car.z + Math.cos(yaw) * car.speed * dt;
    const danger = this.policePedestrianHazard(car, x, z, yaw);
    const blocked = danger ? 'pedestrian' : this.vehicleBlock(car, x, z, yaw);
    if (!blocked) {
      car.x = x; car.z = z; car.yaw = yaw; car.steer = clamp(-angle, -.55, .55);
      car.blocked = Math.abs(car.speed) > .5 ? Math.max(0, car.blocked - dt * 2) : car.blocked + dt;
    } else {
      const sx = car.x + Math.sin(car.yaw) * car.speed * dt, sz = car.z + Math.cos(car.yaw) * car.speed * dt;
      if (!danger && !this.vehicleBlock(car, sx, sz, car.yaw)) { car.x = sx; car.z = sz; }
      else this.applyCollision(car, blocked!, x, z, yaw);
      car.blocked += dt;
    }
    if (car.blocked > 1.1 && blocked !== 'player' && blocked !== 'pedestrian') {
      memory.reverse = .85 + Number(car.id.slice(7)) % 3 * .2;
      memory.avoidance = null; car.speed = 0;
    }
  }

  private updatePolice(dt: number): void {
    const s = this.state;
    const actualTarget = this.getControlled();
    if (s.combat.dead) {
      for (const car of s.vehicles) if (car.kind === 'police') car.speed = 0;
      s.police.spotted = false;
      return;
    }
    s.officers = s.officers.filter(officer => {
      const age = s.time - (officer.deadAt ?? s.time);
      const car = s.vehicles.find(vehicle => vehicle.id === officer.vehicleId);
      if (officer.state !== 'dead' || age < 8 || dist(officer, actualTarget) < 45 || car && dist(car, actualTarget) < 45) return true;
      if (car) {
        car.active = false; car.speed = 0; car.route = []; car.waypoint = 0;
        if (car.id !== 'police-0' && car.id !== 'police-1') s.vehicles = s.vehicles.filter(vehicle => vehicle !== car);
      }
      this.officerRoutes.delete(officer.id);
      this.policeDriving.delete(officer.vehicleId);
      return false;
    });
    if (dist(actualTarget, this.world.restricted) < this.world.restricted.radius && s.police.cooldown <= 0) this.raiseWanted('Restricted depot! Patrols are closing in.');
    const activeCars = () => s.vehicles.filter(car => car.kind === 'police' && car.active && car.id !== s.player.vehicleId);
    const sightings = new Map<string, boolean>();
    let nearestVisible = Infinity;
    s.police.spotted = false;
    for (const car of activeCars()) {
      const officer = s.police.wanted >= 3 ? this.ensureOfficer(car) : s.officers.find(unit => unit.vehicleId === car.id);
      if (officer?.state === 'dead') continue;
      const riding = !officer || officer.state === 'riding';
      const observer = riding ? car : officer;
      const visible = !!s.police.wanted && policeCanSee(this.world, s, observer, riding ? car.id : undefined);
      sightings.set(car.id, visible);
      if (visible) { s.police.spotted = true; nearestVisible = Math.min(nearestVisible, dist(observer, actualTarget)); }
    }
    if (s.police.spotted) {
      s.police.lastSeen = policeSighting(s);
      if (s.police.lastSeen.inVehicle && s.police.lastSeen.speed > 3) this.policeVehicleMovingUntil = s.time + .9;
    }
    if (s.police.wanted) {
      s.police.reinforcementTimer -= dt;
      if (s.police.reinforcementTimer <= 0) {
        const alive = activeCars().filter(car => !s.officers.some(officer => officer.vehicleId === car.id && officer.state === 'dead')).length;
        this.dispatchPolice(Math.min(policeLimit(s.police.wanted), alive + 1), true);
        s.police.reinforcementTimer = s.police.wanted >= 3 ? 4.5 : 8;
      }
    }
    const sight = s.police.lastSeen;
    const policeCars = activeCars().sort((a, b) => sight ? dist(a, sight) - dist(b, sight) : a.id.localeCompare(b.id));
    const chasingVehicle = !!sight?.inVehicle && (sight.speed > 3 || s.time < this.policeVehicleMovingUntil);
    this.policeRouteTimer -= dt;
    let rank = 0;
    for (const police of policeCars) {
      const officer = s.police.wanted >= 3 ? this.ensureOfficer(police) : s.officers.find(unit => unit.vehicleId === police.id);
      if (officer?.state === 'dead') { police.speed = 0; continue; }
      const unitRank = rank++;
      const target = sight ? policeObjective(this.world, sight, unitRank, s.police.spotted, s.time) : police;
      const canSee = sightings.get(police.id) ?? false;
      if (officer && ['engaging', 'returning'].includes(officer.state)) {
        const farOnFoot = !!sight && !canSee && dist(officer, sight) > 48;
        this.updateOfficer(officer, police, sight && s.police.spotted ? sight : target, dt, s.police.wanted < 3 || chasingVehicle || farOnFoot, canSee);
        if (officer.state !== 'riding') continue;
      }
      if (s.police.wanted && sight) {
        const distance = dist(police, sight);
        const searchingOnFoot = !s.police.spotted && !sight.inVehicle && distance < 14;
        if (officer && s.police.wanted >= 3 && !chasingVehicle && (canSee && distance < 22 || searchingOnFoot)) {
          this.brakePolice(police, dt);
          if (Math.abs(police.speed) < .25) {
            this.dismountOfficer(police, officer);
            if (officer.state === 'engaging') this.updateOfficer(officer, police, target, dt, false, canSee);
          }
        } else {
          if (this.policeRouteTimer <= 0 || !police.route.length) {
            const direct = unitRank < 2 && distance < 38 && canSee && this.lineClear(police, target);
            police.route = direct ? [{ x: target.x, z: target.z }] : policeLaneRoute(police, this.pursuitRoute(police, target));
            if (!police.route.length && dist(police, target) > 3 && this.lineClear(police, target)) police.route = [{ ...target }];
            police.waypoint = 0;
          }
          const maximum = s.police.wanted >= 3 ? chasingVehicle ? 27 - unitRank % 3 * 1.5 : 19 : sight.inVehicle ? 23 : 14;
          this.drivePolice(police, dt, s.police.spotted ? maximum : Math.min(maximum, 17));
        }
      } else {
        if (!police.route.length || police.waypoint >= police.route.length - 1 && dist(police, police.route[police.waypoint]) < 4) {
          const road = this.world.roads[(Number(police.id.slice(7)) + Math.floor(s.time / 20)) % this.world.roads.length];
          const extent = this.world.size / 2 - this.world.roadWidth * 1.5;
          police.route = policeLaneRoute(police, routeToTarget(police, { x: road, z: s.time % 40 < 20 ? -extent : extent }, this.world));
          police.waypoint = 0;
        }
        this.drivePolice(police, dt, 8);
      }
      if (officer?.state === 'riding') { officer.x = police.x; officer.z = police.z; officer.yaw = police.yaw; }
    }
    if (this.policeRouteTimer <= 0) this.policeRouteTimer = .6;
    if (!s.police.wanted) return;
    const controlledSpeed = Math.abs(this.controlledCar()?.speed ?? 0);
    if (s.police.wanted >= 3) s.police.caught = 0;
    else if (nearestVisible < (s.player.vehicleId ? 5.4 : 4) && controlledSpeed < 4) s.police.caught += dt;
    else s.police.caught = Math.max(0, s.police.caught - dt * 1.5);
    if (s.police.caught >= 3) {
      s.police.wanted = 0; s.police.caught = 0; s.police.escape = 0; s.police.cooldown = 8; s.police.spotted = false;
      if (this.controlledCar()) this.controlledCar()!.speed = 0;
      if (s.mission.phase === 'collect' || s.mission.phase === 'deliver') {
        s.mission.phase = 'failed';
        this.message('Stopped by the patrol. Press T to retry the delivery.', 7);
      } else this.message('Stopped by the patrol. Heat cleared. You can keep exploring.', 7);
    } else {
      s.police.escape = s.police.spotted ? 0 : s.police.escape + dt;
      if (s.police.escape >= policeEscapeDuration(s.police.wanted)) {
        s.police.wanted = 0; s.police.escape = 0; s.police.caught = 0; s.police.cooldown = 5; s.police.spotted = false;
        for (const officer of s.officers) if (officer.state === 'engaging') {
          officer.state = 'returning'; this.officerRoutes.delete(officer.id);
        }
        this.message('You lost the patrol. Heat cleared.', 4);
      }
    }
  }

  private updateMission(dt: number): void {
    const m = this.state.mission;
    if (m.phase === 'collect' || m.phase === 'deliver') m.elapsed += dt;
    if (m.phase !== 'deliver') return;
    const car = this.controlledCar();
    if (car?.id === MISSION_CAR_ID && dist(car, this.world.destination) < 7 && Math.abs(car.speed) < 1.15 && !this.state.police.wanted) {
      m.deliveryHold += dt;
      if (m.deliveryHold >= 1.25) {
        m.phase = 'success';
        m.best = m.best === null ? m.elapsed : Math.min(m.best, m.elapsed);
        this.message('Delivery complete. Portside thanks you! Press T to replay.', 8);
      }
    } else m.deliveryHold = 0;
  }

  private nearbyVehicle(): Vehicle | undefined {
    const p = this.state.player;
    const entryDistance = (v: Vehicle) => {
      const offset = VEHICLE_SPECS[v.model].entryOffsetZ;
      const cabDistance = dist(p, { x: v.x + Math.sin(v.yaw) * offset, z: v.z + Math.cos(v.yaw) * offset });
      return Math.min(dist(p, v), cabDistance);
    };
    return this.state.vehicles.filter(v => v.active && v.kind !== 'police' && Math.abs(v.speed) < 1.5 && entryDistance(v) < 4.5)
      .sort((a, b) => entryDistance(a) - entryDistance(b))[0];
  }

  interact(): void {
    const s = this.state;
    if (s.combat.dead) return;
    const car = this.controlledCar();
    if (car) {
      if (Math.abs(car.speed) > 1.5) { this.message('Slow down before getting out.', 2); return; }
      const sides = [1, -1];
      const candidates: Point[] = [];
      const entryOffsetZ = VEHICLE_SPECS[car.model].entryOffsetZ;
      for (const side of sides) for (const longitudinal of [entryOffsetZ, 0, -car.depth / 2 - 1]) {
        candidates.push({ x: car.x + Math.cos(car.yaw) * side * (car.width / 2 + .8) + Math.sin(car.yaw) * longitudinal,
          z: car.z - Math.sin(car.yaw) * side * (car.width / 2 + .8) + Math.cos(car.yaw) * longitudinal });
      }
      const exit = candidates.find(point => !this.footBlocked(point.x, point.z, car.id));
      if (!exit) { this.message('No safe place to get out here.', 2); return; }
      s.player.vehicleId = null; s.player.x = exit.x; s.player.z = exit.z; s.player.yaw = car.yaw; s.player.moving = false;
      this.message('On foot. Press E near a stopped car to enter.', 3);
      return;
    }
    if (s.mission.phase === 'available' && dist(s.player, this.world.pickup) < 5) {
      s.mission.phase = 'collect'; this.message('Courier accepted. Get in the marked car.', 5); return;
    }
    const nearby = this.nearbyVehicle();
    if (nearby) {
      s.player.vehicleId = nearby.id; s.player.x = nearby.x; s.player.z = nearby.z; s.player.yaw = nearby.yaw; s.player.moving = false;
      if (nearby.id === MISSION_CAR_ID && s.mission.phase === 'collect') s.mission.phase = 'deliver';
      this.message(nearby.id === MISSION_CAR_ID ? 'Courier car secured. Follow the route to the drop-off.' : 'Vehicle borrowed. Drive carefully.', 4);
    }
  }

  restartMission(): void {
    const best = this.state.mission.best;
    const current = this.controlledCar();
    if (current) current.speed = 0;
    this.state.player = { ...SPAWN, yaw: Math.PI, vehicleId: null, moving: false, swimming: false };
    this.state.mission = { phase: 'available', elapsed: 0, best, deliveryHold: 0 };
    this.state.police = { wanted: 0, escape: 0, caught: 0, cooldown: 0, lastSeen: null, spotted: false, reinforcementTimer: 7 };
    this.state.combat = createCombatState();
    this.state.officers = [];
    this.officerRoutes.clear();
    this.policeDriving.clear();
    this.policeVehicleMovingUntil = 0;
    this.trafficDriving.clear();
    for (const car of this.state.vehicles) {
      if (car.kind === 'police') { car.active = false; car.speed = 0; car.route = []; car.waypoint = 0; continue; }
      if (car.damage) car.damage = undefined;
      car.throttle = 0; car.braking = false;
    }
    this.message('Mission reset. Return to the amber beacon when ready.', 4);
  }

  getHint(): string {
    const s = this.state;
    if (s.combat.dead) return `Downed · respawn in ${Math.max(0, s.combat.respawnIn).toFixed(1)}s`;
    const car = this.controlledCar();
    if (car) {
      const damage = car.damage;
      if (damage && damage.integrity < .18) return damage.engine < .08 ? 'Engine disabled · E to exit · T to reset mission' : 'Critical vehicle damage · drive carefully';
      return s.mission.phase === 'deliver' && car.id === MISSION_CAR_ID ? 'Deliver the car to the yellow marker · E to exit' : 'Driving · E to exit · C camera';
    }
    if (s.mission.phase === 'available' && dist(s.player, this.world.pickup) < 6) return 'Press E to accept the courier job';
    if (s.mission.phase === 'collect') return 'Find the marked courier car and press E';
    return 'On foot · E enter vehicle · 1/2/3 weapons · RMB aim · LMB attack';
  }
}