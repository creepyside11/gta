import * as THREE from 'three';
import type { VehicleModel } from '../game/types';

type RealVehicleModel = 'bmw-m5-f90' | 'mercedes-g63' | 'nissan-gtr-r35';
type ProceduralFallback = 'sport' | 'pickup';

export function isRealVehicleModel(model: VehicleModel): model is RealVehicleModel {
  return model === 'bmw-m5-f90' || model === 'mercedes-g63' || model === 'nissan-gtr-r35';
}

export function realVehicleFallback(model: RealVehicleModel): ProceduralFallback {
  return model === 'mercedes-g63' ? 'pickup' : 'sport';
}

const material = (color: string, roughness = .62, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function cabinGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > 0) {
      positions.setX(i, positions.getX(i) * .82);
      positions.setZ(i, positions.getZ(i) * .7);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addBox(root: THREE.Group, name: string, color: string, x: number, y: number, z: number,
  w: number, h: number, d: number, roughness = .62, metalness = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(color, roughness, metalness));
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addCylinder(root: THREE.Group, name: string, color: string, x: number, y: number, z: number,
  radius: number, depth: number, roughness = .55) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), material(color, roughness));
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(radius, depth, radius);
  mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addCabin(root: THREE.Group, color: string, x: number, y: number, z: number, w: number, h: number, d: number) {
  const mesh = new THREE.Mesh(cabinGeometry(), material(color, .22));
  mesh.name = 'real-cabin';
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function prepareFallbackWheels(fallbackRoot: THREE.Group, model: RealVehicleModel) {
  // Keep the already-wired wheel pivots so the existing renderer continues to
  // animate wheel spin and steering. Hide only the old procedural body panels.
  for (const child of fallbackRoot.children) if (child instanceof THREE.Mesh) child.visible = false;

  const groups = fallbackRoot.children.filter((child): child is THREE.Group => child instanceof THREE.Group);
  const config = model === 'mercedes-g63'
    ? { track: .90, front: 1.48, rear: -1.48, y: .42, scale: .76 }
    : { track: .84, front: 1.50, rear: -1.50, y: .37, scale: .84 };
  for (const group of groups) {
    const side = Math.sign(group.position.x) || 1;
    const front = group.position.z > 0;
    group.position.set(side * config.track, config.y, front ? config.front : config.rear);
    group.scale.setScalar(config.scale);
  }
}

function buildBmw(root: THREE.Group) {
  const paint = '#4b6f95', black = '#171d21', glass = '#31505d', chrome = '#bac4c6';
  addBox(root, 'm5-underbody', black, 0, .37, 0, 1.82, .22, 4.72);
  addBox(root, 'm5-body', paint, 0, .71, 0, 1.90, .52, 4.82, .38, .18);
  const hood = addBox(root, 'm5-hood', paint, 0, 1.02, 1.62, 1.84, .16, 1.53, .36, .18);
  hood.rotation.x = .035;
  addBox(root, 'm5-trunk', paint, 0, 1.04, -1.94, 1.78, .18, .91, .36, .18);
  addCabin(root, glass, 0, 1.43, -.20, 1.72, .82, 2.48);
  addBox(root, 'm5-roof', paint, 0, 1.89, -.29, 1.50, .11, 1.43, .36, .18);
  for (const side of [-1, 1]) {
    addBox(root, `m5-mirror-${side}`, paint, side * .97, 1.45, .63, .20, .18, .28, .4, .15);
    addBox(root, `m5-side-glass-${side}`, glass, side * .875, 1.50, -.23, .035, .48, 1.53, .2);
    addBox(root, `m5-head-${side}`, '#effcff', side * .62, 1.08, 2.425, .50, .13, .04, .15);
    addBox(root, `m5-tail-${side}`, '#d44f4b', side * .63, 1.05, -2.425, .54, .14, .04, .25);
    addBox(root, `m5-exhaust-${side}`, black, side * .69, .50, -2.42, .30, .09, .08, .35);
  }
  addBox(root, 'm5-grille-left', black, -.22, .89, 2.445, .32, .29, .045, .28);
  addBox(root, 'm5-grille-right', black, .22, .89, 2.445, .32, .29, .045, .28);
  for (const x of [-.31, -.22, -.13, .13, .22, .31]) addBox(root, `m5-grille-bar-${x}`, chrome, x, .89, 2.472, .018, .23, .02, .24, .5);
  addBox(root, 'm5-lower-intake', black, 0, .53, 2.44, 1.50, .17, .08, .3);
  addBox(root, 'm5-rear-diffuser', black, 0, .48, -2.42, 1.66, .13, .09, .32);
}

function buildG63(root: THREE.Group) {
  const paint = '#22282d', black = '#151a1e', glass = '#2c4550', chrome = '#b7c0c2';
  addBox(root, 'g63-underbody', black, 0, .44, 0, 1.84, .28, 4.57);
  addBox(root, 'g63-body', paint, 0, .83, 0, 1.98, .76, 4.72, .48, .15);
  addBox(root, 'g63-cabin', paint, 0, 1.62, -.28, 1.82, 1.14, 2.86, .48, .15);
  addBox(root, 'g63-roof', paint, 0, 2.23, -.27, 1.88, .12, 2.96, .48, .15);
  addBox(root, 'g63-hood', paint, 0, 1.23, 1.70, 1.84, .20, 1.20, .48, .15);
  addBox(root, 'g63-front-glass', glass, 0, 1.71, 1.17, 1.62, .68, .04, .18);
  addBox(root, 'g63-rear-glass', glass, 0, 1.70, -1.74, 1.58, .70, .04, .18);
  for (const side of [-1, 1]) {
    addBox(root, `g63-side-glass-${side}`, glass, side * .91, 1.75, -.28, .035, .72, 2.14, .18);
    addBox(root, `g63-mirror-${side}`, paint, side * 1.04, 1.66, .82, .22, .20, .30, .48, .15);
    addCylinder(root, `g63-head-${side}`, '#effcff', side * .65, 1.10, 2.405, .19, .04, .15);
    addBox(root, `g63-tail-${side}`, '#c63f42', side * .72, 1.22, -2.375, .25, .43, .04, .24);
    addBox(root, `g63-side-step-${side}`, '#313a3d', side * 1.015, .76, 0, .09, .13, 3.90, .45);
  }
  addBox(root, 'g63-grille', black, 0, 1.05, 2.41, 1.14, .50, .055, .27);
  for (const x of [-.45, -.22, 0, .22, .45]) addBox(root, `g63-grille-bar-${x}`, chrome, x, 1.05, 2.44, .035, .42, .025, .22, .55);
  addBox(root, 'g63-front-bumper', black, 0, .55, 2.39, 1.86, .17, .10, .35);
  addBox(root, 'g63-rear-bumper', black, 0, .55, -2.37, 1.86, .17, .10, .35);
  addCylinder(root, 'g63-spare-wheel', '#20282c', 0, 1.16, -2.50, .43, .20, .78);
  addCylinder(root, 'g63-spare-cover', paint, 0, 1.16, -2.62, .31, .03, .45);
}

function buildGtr(root: THREE.Group) {
  const paint = '#b84c45', black = '#14191d', glass = '#29424e';
  addBox(root, 'gtr-underbody', black, 0, .34, 0, 1.82, .20, 4.50);
  addBox(root, 'gtr-body', paint, 0, .63, 0, 1.90, .43, 4.62, .38, .2);
  const hood = addBox(root, 'gtr-hood', paint, 0, .90, 1.50, 1.82, .14, 1.58, .36, .2);
  hood.rotation.x = .045;
  addBox(root, 'gtr-rear-deck', paint, 0, .94, -1.82, 1.78, .16, 1.02, .36, .2);
  addCabin(root, glass, 0, 1.28, -.12, 1.69, .69, 2.32);
  addBox(root, 'gtr-roof', paint, 0, 1.67, -.25, 1.36, .09, 1.28, .36, .2);
  for (const side of [-1, 1]) {
    addBox(root, `gtr-side-glass-${side}`, glass, side * .84, 1.32, -.13, .035, .42, 1.50, .18);
    addBox(root, `gtr-mirror-${side}`, paint, side * .98, 1.28, .55, .17, .13, .25, .38, .2);
    addBox(root, `gtr-head-${side}`, '#effcff', side * .67, .94, 2.33, .36, .13, .04, .14);
    for (const xOffset of [-.14, .14]) addCylinder(root, `gtr-tail-${side}-${xOffset}`, '#d3242d', side * .63 + xOffset, .91, -2.325, .115, .035, .2);
    addBox(root, `gtr-exhaust-${side}`, black, side * .56, .48, -2.31, .34, .10, .08, .3);
  }
  addBox(root, 'gtr-front-intake', black, 0, .61, 2.33, 1.16, .27, .06, .26);
  addBox(root, 'gtr-front-lip', black, 0, .43, 2.30, 1.72, .12, .10, .3);
  addBox(root, 'gtr-rear-diffuser', black, 0, .42, -2.30, 1.74, .13, .11, .3);
  addBox(root, 'gtr-wing', black, 0, 1.40, -1.98, 1.58, .08, .33, .34);
  for (const side of [-1, 1]) addBox(root, `gtr-wing-stand-${side}`, black, side * .54, 1.22, -1.94, .07, .34, .08, .34);
}

/**
 * Replaces only the old fallback body while preserving its wheel pivots. The
 * selected models are authored locally from primitives, so Android remains
 * fully offline and no third-party model download is required at runtime.
 */
export function attachRealVehicleAsset(root: THREE.Group, fallbackRoot: THREE.Group, model: RealVehicleModel): void {
  prepareFallbackWheels(fallbackRoot, model);
  if (model === 'bmw-m5-f90') buildBmw(root);
  else if (model === 'mercedes-g63') buildG63(root);
  else buildGtr(root);
}
