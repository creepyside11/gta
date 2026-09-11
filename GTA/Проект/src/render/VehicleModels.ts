import * as THREE from 'three';
import type { Vehicle } from '../game/types';
import { VEHICLE_SPECS } from '../game/vehicles';
import { attachRealVehicleAsset, isRealVehicleModel, realVehicleFallback } from './RealVehicleModels';

export type Shape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'cabin';
export type CarNode = {
  root: THREE.Group; wheels: THREE.Group[]; frontWheels: THREE.Group[]; wheelRadius: number;
  leftLight?: THREE.Mesh; rightLight?: THREE.Mesh;
};
export type VehiclePart = (
  parent: THREE.Object3D, shape: Shape, color: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw?: number, shadow?: boolean,
) => THREE.Mesh;

/** One shared, tapered cabin mesh; every model reuses the renderer's geometry/material cache. */
export function createCabinGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > 0) {
      positions.setX(i, positions.getX(i) * .86);
      positions.setZ(i, positions.getZ(i) * .64);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Model space is in metres, facing +Z, and stays inside the simulation footprint. */
export function createVehicleModel(v: Vehicle, part: VehiclePart): CarNode {
  if (isRealVehicleModel(v.model)) {
    const fallback = createVehicleModel({ ...v, model: realVehicleFallback(v.model) }, part);
    const root = new THREE.Group();
    root.name = `${v.model}-${v.id}`;
    root.add(fallback.root);
    attachRealVehicleAsset(root, fallback.root, v.model);
    return { ...fallback, root, wheelRadius: VEHICLE_SPECS[v.model].wheelRadius };
  }

  const root = new THREE.Group();
  root.name = `${v.model}-${v.id}`;
  const wheels: THREE.Group[] = [], frontWheels: THREE.Group[] = [];
  const { wheelRadius } = VEHICLE_SPECS[v.model];
  const paint = v.color, trim = '#293c43', chrome = '#c5cfca', glass = '#416779';
  const box = (color: string, x: number, y: number, z: number, w: number, h: number, d: number, shadow = true) =>
    part(root, 'box', color, x, y, z, w, h, d, 0, shadow);

  const addWheels = (axles: number[], track: number, tireWidth: number) => {
    for (const z of axles) for (const side of [-1, 1]) {
      const steering = new THREE.Group();
      steering.position.set(side * track, wheelRadius + .01, z);
      const wheel = new THREE.Group();
      const tire = part(wheel, 'cylinder', '#25343b', 0, 0, 0, wheelRadius, tireWidth, wheelRadius);
      tire.rotation.z = Math.PI / 2;
      const hub = part(wheel, 'cylinder', chrome, side * (tireWidth / 2 + .008), 0, 0,
        wheelRadius * .52, .02, wheelRadius * .52, 0, false);
      hub.rotation.z = Math.PI / 2;
      part(wheel, 'box', '#62787b', side * (tireWidth / 2 + .022), 0, 0, .02, wheelRadius * .8, .06, 0, false);
      steering.add(wheel); root.add(steering); wheels.push(wheel);
      if (z === axles[axles.length - 1]) frontWheels.push(steering);
    }
  };

  const cabin = (w: number, base: number, h: number, z: number, d: number, roof: string) => {
    part(root, 'cabin', glass, 0, base + h / 2, z, w, h, d);
    const angle = Math.atan2(d * .18, h);
    const glassHeight = Math.hypot(h, d * .18) * .88;
    const windscreen = box('#79a6b1', 0, base + h / 2, z + d * .412, w * .82, glassHeight, .025, false);
    windscreen.rotation.x = -angle;
    const rear = box('#527d8d', 0, base + h / 2, z - d * .412, w * .82, glassHeight, .025, false);
    rear.rotation.x = angle;
    box(roof, 0, base + h + .045, z, w * .89, .12, d * .68);
    // Sloping pillars follow the tapered glass instead of filling the cabin with a solid block.
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const bottom = new THREE.Vector3(side * w / 2, base, z + end * d / 2);
      const top = new THREE.Vector3(side * w * .43, base + h, z + end * d * .32);
      const center = bottom.clone().add(top).multiplyScalar(.5);
      const delta = top.sub(bottom);
      const pillar = box(paint, center.x, center.y, center.z, .065, delta.length(), .065);
      pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    }
  };

  const mirrors = (x: number, y: number, z: number) => {
    for (const side of [-1, 1]) {
      box(trim, side * (x - .1), y, z, .2, .055, .07, false);
      box(paint, side * x, y + .05, z, .16, .18, .23);
      box('#86a6ab', side * x, y + .05, z - .12, .12, .12, .015, false);
    }
  };

  const lights = (x: number, y: number, front: number, back: number, width: number, height: number) => {
    for (const side of [-1, 1]) {
      box('#ffffdc', side * x, y, front, width, height, .045, false);
      box('#d9594f', side * x, y, back, width * .8, height, .045, false);
    }
    box('#ece6d5', 0, y - .15, back - .008, .43, .15, .03, false);
  };

  if (v.model === 'truck') {
    // Short cab, tall freight box, and a tandem rear axle give the truck its own silhouette.
    box(trim, 0, .64, 0, 2.22, .3, 6.95);
    box(paint, 0, 1.13, 2.22, 2.42, .86, 2.35);
    cabin(2.24, 1.54, 1.08, 2.22, 2.14, paint);
    box(paint, 0, 1.73, 3.23, 2.38, .39, .29);
    box('#e3e3ce', 0, 2.15, -1.17, 2.6, 2.65, 4.55);
    box('#f1ecd9', 0, 3.5, -1.17, 2.66, .12, 4.63);
    for (const side of [-1, 1]) {
      box(chrome, side * 1.315, .88, -1.17, .045, .14, 4.57);
      box(paint, side * 1.315, 1.53, -1.17, .045, .37, 4.51, false);
      for (const z of [-3.14, -2.5, -1.86, -1.22, -.58, .06, .7]) {
        box('#c3c9be', side * 1.316, 2.6, z, .025, 1.53, .035, false);
      }
      box(chrome, side * 1.21, 1.17, 1.69, .035, .07, .3, false);
      box(chrome, side * 1.23, .66, 1.68, .2, .15, .78);
      box(trim, side * 1.07, .44, -2.91, .38, .48, .07);
      box('#e9ad54', side * .77, 2.8, 2.47, .16, .12, .23, false);
    }
    // Rear loading doors and locking bars remain readable from the driving camera.
    box('#bbc6c1', 0, 2.13, -3.46, 2.44, 2.47, .06);
    for (const side of [-1, 1]) {
      box('#dce0d2', side * .6, 2.18, -3.505, 1.15, 2.25, .03, false);
      box(chrome, side * .32, 2.12, -3.53, .045, 2.04, .03, false);
      box(trim, side * .32, 1.73, -3.55, .18, .06, .03, false);
    }
    mirrors(1.29, 2.01, 2.93);
    box(chrome, 0, .77, 3.46, 2.5, .23, .15);
    box(trim, 0, 1.21, 3.41, .92, .4, .06, false);
    for (const y of [1.1, 1.22, 1.34]) box(chrome, 0, y, 3.45, .83, .035, .025, false);
    box(trim, 0, .69, -3.47, 2.52, .2, .15);
    lights(.93, 1.18, 3.43, -3.5, .37, .28);
    addWheels([-2.36, -1.02, 2.28], 1.1, .34);
  } else if (v.model === 'pickup') {
    box(trim, 0, .59, 0, 2.02, .26, 5.46);
    box(paint, 0, .99, 0, 2.22, .61, 5.5);
    box(paint, 0, 1.38, 1.93, 2.16, .26, 1.56);
    cabin(1.98, 1.3, .89, .65, 1.96, paint);
    // Recessed bed: separate floor, side walls, wheel housings and a tailgate.
    box('#49595b', 0, 1.31, -1.56, 1.91, .09, 2.18, false);
    for (const side of [-1, 1]) {
      box(paint, side * 1.02, 1.52, -1.53, .2, .51, 2.38);
      box(chrome, side * 1.02, 1.8, -1.53, .22, .06, 2.39, false);
      box('#576768', side * .8, 1.44, -1.75, .31, .24, .91);
      box(chrome, side * 1.125, 1.22, .23, .025, .07, .3, false);
      box(trim, side * 1.135, .79, .65, .06, .12, 1.77);
    }
    for (const x of [-.6, -.3, 0, .3, .6]) box('#6e7a76', x, 1.367, -1.59, .035, .025, 2.07, false);
    box(paint, 0, 1.53, -.37, 2.16, .53, .13);
    box(paint, 0, 1.52, -2.67, 2.19, .52, .17);
    box(chrome, 0, 1.59, -2.767, .4, .07, .025, false);
    box(chrome, 0, .81, 2.77, 2.29, .2, .16);
    box(chrome, 0, .8, -2.79, 2.27, .19, .16);
    box(trim, 0, 1.16, 2.77, .97, .29, .06, false);
    box(chrome, 0, 1.17, 2.808, .88, .035, .025, false);
    mirrors(1.16, 1.56, 1.34);
    lights(.83, 1.2, 2.78, -2.775, .41, .28);
    addWheels([-1.8, 1.75], .98, .31);
  } else if (v.model === 'hatchback') {
    box(trim, 0, .48, 0, 1.8, .22, 3.55);
    box(paint, 0, .86, 0, 1.91, .61, 3.6);
    box(paint, 0, 1.13, 1.22, 1.86, .21, 1.05);
    cabin(1.74, 1.13, .94, -.28, 2.33, '#efe8cf');
    box(paint, 0, 1.3, -1.66, 1.8, .37, .25);
    for (const side of [-1, 1]) {
      box(paint, side * .835, 1.56, -.36, .065, .81, .11);
      box(chrome, side * .963, 1.1, -.06, .025, .055, .22, false);
      box(trim, side * .963, .78, -.08, .025, .1, 2.95, false);
      // Round lamps distinguish this compact from the original rectangular sedan.
      const lamp = part(root, 'cylinder', '#fff6cf', side * .64, 1.04, 1.82, .205, .05, .205, 0, false);
      lamp.rotation.x = Math.PI / 2;
      box('#d96455', side * .77, 1.28, -1.817, .19, .43, .04, false);
    }
    box(trim, 0, .66, 1.83, 1.8, .19, .1);
    box(trim, 0, .65, -1.83, 1.8, .19, .1);
    box(trim, 0, 1, 1.824, .62, .13, .035, false);
    box('#ece6d5', 0, 1.05, -1.823, .42, .15, .025, false);
    mirrors(.96, 1.43, .56);
    addWheels([-1.16, 1.14], .83, .25);
  } else if (v.model === 'sport') {
    box(trim, 0, .4, 0, 2.01, .18, 4.37);
    box(paint, 0, .68, 0, 2.13, .42, 4.45);
    const hood = box(paint, 0, .94, 1.42, 2.07, .19, 1.59);
    hood.rotation.x = .095;
    box(paint, 0, .99, -1.68, 2.07, .24, 1.08);
    cabin(1.83, .98, .65, -.32, 2.17, paint);
    for (const side of [-1, 1]) {
      // Twin cream racing stripes continue across the hood, roof, and rear deck.
      const stripe = box('#eee8d5', side * .28, 1.04, 1.43, .2, .018, 1.58, false);
      stripe.rotation.x = .095;
      box('#eee8d5', side * .28, 1.742, -.32, .2, .016, 1.47, false);
      box('#eee8d5', side * .28, 1.122, -1.69, .2, .016, 1.01, false);
      box(trim, side * 1.064, .77, -.74, .035, .16, .48, false);
      box(chrome, side * 1.071, .93, -.26, .025, .045, .2, false);
      box(trim, side * .69, 1.21, -1.91, .085, .27, .14);
      const exhaust = part(root, 'cylinder', chrome, side * .74, .43, -2.245, .09, .1, .09, 0, false);
      exhaust.rotation.x = Math.PI / 2;
    }
    box(trim, 0, 1.38, -1.92, 2.12, .1, .36);
    box(trim, 0, .45, 2.25, 2.17, .08, .13);
    box(trim, 0, .85, 2.234, .78, .17, .025, false);
    mirrors(1.05, 1.15, .46);
    lights(.75, .87, 2.245, -2.247, .46, .12);
    addWheels([-1.45, 1.46], .915, .29);
  }

  return { root, wheels, frontWheels, wheelRadius };
}
