import * as THREE from 'three';
import type { Vehicle, VehicleModel } from '../game/types';
import { VEHICLE_SPECS } from '../game/vehicles';

export type RealVehicleModel = 'bmw-m5-f90' | 'mercedes-g63' | 'nissan-gtr-r35';
type Shape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'cabin';
type VehiclePart = (
  parent: THREE.Object3D, shape: Shape, color: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw?: number, shadow?: boolean,
) => THREE.Mesh;

export function isRealVehicleModel(model: VehicleModel): model is RealVehicleModel {
  return model === 'bmw-m5-f90' || model === 'mercedes-g63' || model === 'nissan-gtr-r35';
}

/**
 * Lightweight, self-authored low-poly interpretations of the selected real cars.
 * Keeping them procedural means the web build and Android APK are fully offline,
 * do not depend on third-party download URLs, and retain the game's deformation system.
 */
export function createRealVehicleModel(v: Vehicle, part: VehiclePart) {
  const root = new THREE.Group();
  root.name = `${v.model}-${v.id}`;
  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  const spec = VEHICLE_SPECS[v.model];
  const wheelRadius = spec.wheelRadius;
  const paint = v.color;
  const black = '#171d21';
  const trim = '#29343a';
  const glass = '#31505d';
  const chrome = '#bac4c6';
  const light = '#eaf5ef';
  const tail = '#d44f4b';

  const box = (color: string, x: number, y: number, z: number, w: number, h: number, d: number, shadow = true) =>
    part(root, 'box', color, x, y, z, w, h, d, 0, shadow);

  const addWheels = (frontZ: number, rearZ: number, track: number, width: number) => {
    for (const [z, front] of [[frontZ, true], [rearZ, false]] as const) {
      for (const side of [-1, 1]) {
        const steering = new THREE.Group();
        steering.name = `${front ? 'steer' : 'rear'}-${side < 0 ? 'left' : 'right'}`;
        steering.position.set(side * track, wheelRadius + .01, z);
        const wheel = new THREE.Group();
        wheel.name = `wheel-${front ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}`;
        const tire = part(wheel, 'cylinder', '#20292d', 0, 0, 0, wheelRadius, width, wheelRadius);
        tire.rotation.z = Math.PI / 2;
        const hub = part(wheel, 'cylinder', chrome, side * (width / 2 + .012), 0, 0,
          wheelRadius * .55, .025, wheelRadius * .55, 0, false);
        hub.rotation.z = Math.PI / 2;
        const spoke = part(wheel, 'box', '#718185', side * (width / 2 + .03), 0, 0,
          .025, wheelRadius * .86, .07, 0, false);
        spoke.rotation.x = Math.PI / 4;
        steering.add(wheel);
        root.add(steering);
        wheels.push(wheel);
        if (front) frontWheels.push(steering);
      }
    }
  };

  if (v.model === 'bmw-m5-f90') {
    // Wide, long sports-sedan stance with the F90's slim lamps and twin kidney grille.
    box(black, 0, .38, 0, 1.82, .22, 4.72);
    box(paint, 0, .72, 0, 1.9, .52, 4.82);
    const hood = box(paint, 0, 1.02, 1.62, 1.84, .16, 1.53);
    hood.rotation.x = .035;
    box(paint, 0, 1.04, -1.94, 1.78, .18, .91);
    part(root, 'cabin', glass, 0, 1.43, -.2, 1.72, .82, 2.48);
    box(paint, 0, 1.9, -.29, 1.5, .11, 1.43);
    for (const side of [-1, 1]) {
      box(paint, side * .97, 1.45, .63, .2, .18, .28);
      box(glass, side * .875, 1.5, -.23, .035, .48, 1.53, false);
      box(light, side * .62, 1.08, 2.425, .5, .13, .04, false);
      box(tail, side * .63, 1.05, -2.425, .54, .14, .04, false);
      box(black, side * .69, .5, -2.42, .3, .09, .08);
    }
    // Separate grille halves and lower intake make the front recognizable without logos.
    box(black, -.22, .89, 2.445, .32, .29, .045, false);
    box(black, .22, .89, 2.445, .32, .29, .045, false);
    for (const x of [-.31, -.22, -.13, .13, .22, .31]) box(chrome, x, .89, 2.472, .018, .23, .02, false);
    box(black, 0, .53, 2.44, 1.5, .17, .08);
    box(black, 0, .48, -2.42, 1.66, .13, .09);
    addWheels(1.55, -1.55, .84, .25);
  } else if (v.model === 'mercedes-g63') {
    // Upright G-Class silhouette: flat sides, tall glasshouse and rear spare wheel.
    box(black, 0, .44, 0, 1.84, .28, 4.57);
    box(paint, 0, .83, 0, 1.98, .76, 4.72);
    box(paint, 0, 1.62, -.28, 1.82, 1.14, 2.86);
    box(paint, 0, 2.23, -.27, 1.88, .12, 2.96);
    box(paint, 0, 1.23, 1.7, 1.84, .2, 1.2);
    box(glass, 0, 1.71, 1.17, 1.62, .68, .04, false);
    box(glass, 0, 1.7, -1.74, 1.58, .7, .04, false);
    for (const side of [-1, 1]) {
      box(glass, side * .91, 1.75, -.28, .035, .72, 2.14, false);
      box(paint, side * 1.04, 1.66, .82, .22, .2, .3);
      const head = part(root, 'cylinder', light, side * .65, 1.1, 2.405, .19, .04, .19, 0, false);
      head.rotation.x = Math.PI / 2;
      box(tail, side * .72, 1.22, -2.375, .25, .43, .04, false);
      box(trim, side * 1.015, .76, 0, .09, .13, 3.9);
    }
    box(black, 0, 1.05, 2.41, 1.14, .5, .055, false);
    for (const x of [-.45, -.22, 0, .22, .45]) box(chrome, x, 1.05, 2.44, .035, .42, .025, false);
    box(black, 0, .55, 2.39, 1.86, .17, .1);
    box(black, 0, .55, -2.37, 1.86, .17, .1);
    const spare = part(root, 'cylinder', '#20292d', 0, 1.16, -2.5, .43, .2, .43);
    spare.rotation.x = Math.PI / 2;
    const spareCover = part(root, 'cylinder', paint, 0, 1.16, -2.62, .31, .03, .31, 0, false);
    spareCover.rotation.x = Math.PI / 2;
    addWheels(1.48, -1.48, .9, .3);
  } else {
    // R35: low roof, broad shoulders, central front intake, four round rear lamps and wing.
    box(black, 0, .34, 0, 1.82, .2, 4.5);
    box(paint, 0, .63, 0, 1.9, .43, 4.62);
    const hood = box(paint, 0, .9, 1.5, 1.82, .14, 1.58);
    hood.rotation.x = .045;
    box(paint, 0, .94, -1.82, 1.78, .16, 1.02);
    part(root, 'cabin', glass, 0, 1.28, -.12, 1.69, .69, 2.32);
    box(paint, 0, 1.67, -.25, 1.36, .09, 1.28);
    for (const side of [-1, 1]) {
      box(glass, side * .84, 1.32, -.13, .035, .42, 1.5, false);
      box(paint, side * .98, 1.28, .55, .17, .13, .25);
      box(light, side * .67, .94, 2.33, .36, .13, .04, false);
      for (const xOffset of [-.14, .14]) {
        const lamp = part(root, 'cylinder', tail, side * .63 + xOffset, .91, -2.325, .115, .035, .115, 0, false);
        lamp.rotation.x = Math.PI / 2;
      }
      box(black, side * .56, .48, -2.31, .34, .1, .08);
    }
    box(black, 0, .61, 2.33, 1.16, .27, .06, false);
    box(black, 0, .43, 2.3, 1.72, .12, .1);
    box(black, 0, .42, -2.3, 1.74, .13, .11);
    box(black, 0, 1.4, -1.98, 1.58, .08, .33);
    for (const side of [-1, 1]) box(black, side * .54, 1.22, -1.94, .07, .34, .08);
    addWheels(1.48, -1.48, .84, .27);
  }

  return { root, wheels, frontWheels, wheelRadius };
}
