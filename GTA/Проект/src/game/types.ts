export interface Point { x: number; z: number }
export interface Point3 extends Point { y: number }
export interface AimRay { origin: Point3; direction: Point3 }
export type WeaponId = 'knife' | 'pistol' | 'rifle';
export type FirearmId = Exclude<WeaponId, 'knife'>;
export interface Ammo { magazine: number; reserve: number }
export interface Shot {
  id: number; owner: 'player' | 'police'; weapon: WeaponId;
  from: Point3; to: Point3; time: number; hit: boolean;
}
export interface CombatState {
  weapon: WeaponId; ammo: Record<FirearmId, Ammo>;
  reload: { weapon: FirearmId; remaining: number; duration: number } | null;
  cooldown: number; triggerHeld: boolean; aiming: boolean; aimYaw: number;
  health: number; dead: boolean; respawnIn: number;
  lastAttackAt: number; lastDamageAt: number; hitUntil: number; killUntil: number;
  shots: Shot[]; nextShotId: number;
}
export interface PoliceOfficer extends Point {
  id: string; vehicleId: string; yaw: number; health: number;
  state: 'riding' | 'engaging' | 'returning' | 'dead';
  fireCooldown: number; phase: number; deadAt: number | null;
}
export type EnvironmentAssetId =
  | 'house-a' | 'house-b' | 'house-h' | 'house-i'
  | 'tree-oak' | 'tree-palm' | 'tree-pine' | 'rock-large';
export interface Solid extends Point {
  id: string; width: number; depth: number; height: number; yaw: number;
  kind: 'building' | 'tree' | 'barrier' | 'planter' | 'bench' | 'bin';
  color: string;
  /** Optional CC0 GLB visual. The collider remains this Solid footprint. */
  assetModel?: EnvironmentAssetId;
}
export type BuildingArchitecture = 'apartment' | 'warehouse' | 'office' | 'townhouse' | 'supermarket' | 'civic';
export interface Building extends Solid {
  kind: 'building'; style: number; label?: string;
  /** Absent on the original downtown blocks, which retain their apartment models. */
  architecture?: BuildingArchitecture;
}
export type DistrictKind = 'downtown' | 'beach' | 'industrial' | 'residential' | 'airport';
export interface WorldDistrict extends Point {
  id: string; name: string; width: number; depth: number; kind: DistrictKind;
}
export interface World {
  size: number; roads: number[]; roadWidth: number;
  buildings: Building[]; obstacles: Solid[]; districts: WorldDistrict[];
  pickup: Point; destination: Point; restricted: Point & { radius: number };
}
export type VehicleModel = 'sedan' | 'truck' | 'pickup' | 'hatchback' | 'sport' | 'bmw-m5-f90' | 'mercedes-g63' | 'nissan-gtr-r35';
export interface VehicleDamage {
  integrity: number; front: number; rear: number; left: number; right: number; engine: number;
  driftX: number; driftZ: number; revision: number; lastImpact: number; impactEnergy: number;
}
export interface Vehicle extends Point {
  damage?: VehicleDamage;
  throttle?: number; braking?: boolean;

  id: string; yaw: number; speed: number; steer: number;
  model: VehicleModel;
  kind: 'parked' | 'traffic' | 'police' | 'mission';
  color: string; width: number; depth: number;
  route: Point[]; waypoint: number; blocked: number; active: boolean;
}
export interface Pedestrian extends Point {
  id: string; yaw: number; color: string; speed: number;
  route: Point[]; waypoint: number; phase: number;
  state: 'walking' | 'waiting' | 'fleeing' | 'dead'; timer: number;
  health: number; deadAt: number | null;
}
export interface Player extends Point { yaw: number; vehicleId: string | null; moving: boolean; swimming?: boolean }
export type MissionPhase = 'available' | 'collect' | 'deliver' | 'success' | 'failed';
export interface Mission { phase: MissionPhase; elapsed: number; best: number | null; deliveryHold: number }
export interface PoliceSighting extends Point { yaw: number; speed: number; inVehicle: boolean; time: number }
export interface PoliceState {
  wanted: number; escape: number; caught: number; cooldown: number;
  lastSeen: PoliceSighting | null; spotted: boolean; reinforcementTimer: number;
}
export interface GameState {
  time: number; player: Player; vehicles: Vehicle[]; pedestrians: Pedestrian[];
  mission: Mission; police: PoliceState;
  combat: CombatState; officers: PoliceOfficer[];
  message: string; messageUntil: number; collisions: number;
}
export interface InputFrame {
  forward: number; turn: number; brake: boolean; sprint: boolean;
  interact: boolean; restart: boolean;
  /** Camera's ground-plane forward angle (+Z at zero), used only while on foot. */
  viewYaw?: number;
  fire?: boolean; reload?: boolean; weapon?: WeaponId; aiming?: boolean; aimRay?: AimRay;
}
export const NO_INPUT: InputFrame = { forward: 0, turn: 0, brake: false, sprint: false, interact: false, restart: false };
export interface SimulationApi {
  world: World; state: GameState;
  step(dt: number, input: InputFrame): void;
  interact(): void;
  restartMission(): void;
  getControlled(): Point & { yaw: number };
  getHint(): string;
}