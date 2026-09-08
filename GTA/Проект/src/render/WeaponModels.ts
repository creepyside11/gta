import * as THREE from 'three';
import type { WeaponId } from '../game/types';
import type { VehiclePart } from './VehicleModels';

export interface WeaponNode {
  root: THREE.Group;
  muzzle: THREE.Vector3;
  flash: THREE.Mesh | null;
  magazine: THREE.Mesh | null;
  magazineY: number;
}

/** Grip at the origin, barrel/blade along +Z. All parts reuse the renderer's caches. */
export function createWeaponModel(weapon: WeaponId, part: VehiclePart): WeaponNode {
  const root = new THREE.Group();
  root.name = `weapon-${weapon}`;
  const box = (color: string, x: number, y: number, z: number, w: number, h: number, d: number) =>
    part(root, 'box', color, x, y, z, w, h, d);
  const tube = (color: string, y: number, z: number, radius: number, length: number) => {
    const mesh = part(root, 'cylinder', color, 0, y, z, radius, length, radius);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  const metal = '#354850', dark = '#25343b', steel = '#c7d4d1';
  let magazine: THREE.Mesh | null = null;
  const muzzle = new THREE.Vector3();

  if (weapon === 'knife') {
    box('#77564a', 0, 0, -.07, .095, .085, .19);
    for (const z of [-.12, -.07, -.02]) box(dark, 0, 0, z, .101, .09, .018);
    box(steel, 0, 0, .044, .17, .05, .035);
    box(steel, 0, 0, .2, .071, .035, .28);
    box('#8fa6a8', .026, .002, .2, .018, .04, .26);
    const tip = part(root, 'cone', steel, 0, 0, .385, .04, .105, .018);
    tip.rotation.x = Math.PI / 2;
    muzzle.set(0, 0, .44);
    return { root, muzzle, flash: null, magazine: null, magazineY: 0 };
  }

  if (weapon === 'pistol') {
    const grip = box(dark, 0, -.035, -.01, .095, .205, .135);
    grip.rotation.x = -.14;
    box('#6a8081', 0, .122, .1, .129, .118, .36);
    box(metal, 0, .057, .066, .112, .052, .3);
    tube(dark, .123, .292, .039, .058);
    box(dark, 0, .196, .227, .026, .029, .045);
    box(dark, 0, .194, -.045, .068, .029, .025);
    box(steel, .066, .116, .13, .011, .044, .087);
    box(metal, 0, -.015, .104, .066, .031, .099);
    magazine = box(metal, 0, -.139, -.001, .102, .032, .14);
    muzzle.set(0, .123, .355);
  } else {
    box('#688278', 0, .106, .1, .16, .193, .39);
    box(metal, 0, .212, .22, .11, .042, .64);
    box('#758c78', 0, .103, .427, .148, .137, .29);
    for (const z of [.33, .4, .47, .54]) box(dark, 0, .183, z, .151, .026, .033);
    tube(metal, .125, .698, .037, .295);
    tube(dark, .125, .854, .047, .053);
    box('#708177', 0, .087, -.246, .131, .176, .288);
    box(dark, 0, .084, -.399, .143, .195, .036);
    const grip = box(dark, 0, -.059, -.025, .09, .221, .115);
    grip.rotation.x = -.19;
    magazine = box(metal, 0, -.143, .169, .128, .273, .147);
    magazine.rotation.x = -.15;
    box(dark, 0, .266, .535, .052, .09, .038);
    box(dark, 0, .263, -.023, .069, .084, .04);
    box(steel, .087, .1, .117, .023, .038, .062);
    muzzle.set(0, .125, .942);
  }
  const flash = part(root, 'sphere', '#ffdc6b', muzzle.x, muzzle.y, muzzle.z, .075, .075, .16, 0, false);
  flash.name = 'muzzle-flash';
  flash.visible = false;
  return { root, muzzle, flash, magazine, magazineY: magazine.position.y };
}
