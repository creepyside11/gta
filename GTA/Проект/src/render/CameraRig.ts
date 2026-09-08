import * as THREE from 'three';
import type { Building, Point } from '../game/types';

const SENSITIVITY = .0025;
const MIN_PITCH = -.12;
const MAX_PITCH = 1.25;
const GROUND_CLEARANCE = .4;

/** Mouse owns the view direction; following and collision only move its origin. */
export class CameraRig {
  private yaw = Math.PI;
  private pitch = .42;
  private streetPitch = .42;
  private firearmPitch: number | null = null;
  private combat = false;
  private aiming = false;
  private wide = false;
  private initialized = false;
  private boomLength = 0;
  private readonly focus = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly buildings: readonly Building[]) {}

  look(deltaX: number, deltaY: number) {
    if (Number.isFinite(deltaX)) {
      // Simulation yaw zero faces +Z; decreasing yaw turns toward screen right.
      const next = this.yaw - deltaX * SENSITIVITY;
      this.yaw = Math.atan2(Math.sin(next), Math.cos(next));
    }
    if (Number.isFinite(deltaY)) this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * SENSITIVITY, this.combat ? -.9 : MIN_PITCH, MAX_PITCH);
  }

  getMovementYaw() { return this.yaw; }

  getPitch() { return this.pitch; }

  setCombat(active: boolean, aiming = false) {
    if (active !== this.combat) {
      if (active) {
        this.streetPitch = this.pitch;
        this.pitch = this.firearmPitch ?? .02;
      } else {
        this.firearmPitch = this.pitch;
        this.pitch = this.streetPitch;
      }
      this.combat = active;
    }
    this.aiming = active && aiming;
  }

  cycleCamera() {
    if (this.combat) return this.aiming ? 'Aiming camera' : 'Shoulder camera';
    this.wide = !this.wide;
    return this.wide ? 'Scenic camera' : 'Street camera';
  }

  update(target: Point, driving: boolean, speed: number, dt: number) {
    // Aim-ray preparation may update the view at dt=0 before a simulation step.
    const follow = 1 - Math.exp(-Math.max(dt, 0) * (this.combat ? 14 : 7));
    this.anchor.set(target.x, driving ? 1.65 : 1.6, target.z);
    if (!this.initialized) this.focus.copy(this.anchor);
    this.focus.lerp(this.anchor, follow);
    // The smoothed follow pivot must not lag through the corner of a building.
    const focusFraction = this.cameraFraction(this.anchor, this.focus, .25);
    if (focusFraction < 1) this.focus.lerpVectors(this.anchor, this.focus, Math.max(0, focusFraction - .015));

    let distance = this.combat ? this.aiming ? 3 : 4.5 : this.wide ? 46 : driving ? 25 + Math.abs(speed) * .09 : 23;
    const shoulder = this.combat ? this.aiming ? .48 : .7 : 0;
    this.offset.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch) * distance - Math.cos(this.yaw) * shoulder,
      Math.sin(this.pitch) * distance,
      -Math.cos(this.yaw) * Math.cos(this.pitch) * distance + Math.sin(this.yaw) * shoulder,
    );
    distance = this.offset.length();
    this.offset.normalize();
    // Looking slightly upward is allowed without pushing the camera under the road.
    if (this.offset.y < 0) distance = Math.min(distance, (this.focus.y - GROUND_CLEARANCE) / -this.offset.y);
    this.desired.copy(this.focus).addScaledVector(this.offset, distance);
    const fraction = this.cameraFraction(this.focus, this.desired);
    const safeDistance = fraction < 1 ? Math.max(0, distance * fraction - .08) : distance;
    // Retract immediately at walls; ease outward after the obstruction clears.
    // Smoothing a position or selecting another angle would change W's direction.
    if (!this.initialized || safeDistance < this.boomLength) this.boomLength = safeDistance;
    else this.boomLength += (safeDistance - this.boomLength) * follow;
    this.camera.position.copy(this.focus).addScaledVector(this.offset, this.boomLength);
    // Explicit orientation also remains defined when a wall leaves a zero-length boom.
    this.camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0, 'YXZ');
    this.initialized = true;
  }

  /** First intersection along a camera segment with the authoritative city. */
  private cameraFraction(start: THREE.Vector3, end: THREE.Vector3, margin = .18) {
    let fraction = 1;
    for (const b of this.buildings) {
      let enter = 0, leave = 1;
      for (const axis of ['x', 'z', 'y'] as const) {
        const min = axis === 'x' ? b.x - b.width / 2 - margin : axis === 'z' ? b.z - b.depth / 2 - margin : -.5;
        const max = axis === 'x' ? b.x + b.width / 2 + margin : axis === 'z' ? b.z + b.depth / 2 + margin : b.height + 1.2;
        const delta = end[axis] - start[axis];
        if (Math.abs(delta) < 1e-7) { if (start[axis] < min || start[axis] > max) { enter = 2; break; } }
        else {
          let a = (min - start[axis]) / delta, c = (max - start[axis]) / delta;
          if (a > c) [a, c] = [c, a];
          enter = Math.max(enter, a); leave = Math.min(leave, c);
        }
      }
      if (enter < leave && leave > 0 && enter < fraction) fraction = Math.max(0, enter);
    }
    return fraction;
  }
}
