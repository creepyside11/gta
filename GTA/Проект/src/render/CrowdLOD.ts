import * as THREE from 'three';
import type { Pedestrian, Point } from '../game/types';

export function usesDetailedPerson(person: Point, observer: Point): boolean {
  return (person.x - observer.x) ** 2 + (person.z - observer.z) ** 2 <= 70 ** 2;
}
/** Distant models are the same simulated people, never a separate decorative crowd. */
export class CrowdLOD {
  readonly root = new THREE.Group();
  readonly parts: THREE.InstancedMesh[];
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  private base = new THREE.Object3D();
  private local = new THREE.Object3D();
  private body = new THREE.Matrix4();
  private matrix = new THREE.Matrix4();
  private color = new THREE.Color();
  constructor(capacity: number) {
    this.parts = Array.from({ length: 6 }, () => {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.count = 0;
      this.root.add(mesh); return mesh;
    });
  }
  update(people: Pedestrian[], observer: Point, time: number) {
    let index = 0;
    for (const p of people) {
      if (usesDetailedPerson(p, observer)) continue;
      const dead = p.state === 'dead';
      const fall = dead ? THREE.MathUtils.smoothstep(time - (p.deadAt ?? time), 0, .28) : 0;
      const stride = p.state === 'waiting' || dead ? 0 : Math.sin(p.phase) * (p.state === 'fleeing' ? .86 : .58);
      this.base.position.set(p.x, .11 + .29 * fall, p.z);
      this.base.rotation.set(0, p.yaw, 0); this.base.updateMatrix();
      this.body.makeRotationX(Math.PI / 2 * fall);
      this.base.matrix.multiply(this.body);
      const pose = (part: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, angle: number, color: string) => {
        this.local.position.set(x, y, z); this.local.rotation.set(angle, 0, 0); this.local.scale.set(sx, sy, sz); this.local.updateMatrix();
        this.matrix.multiplyMatrices(this.base.matrix, this.local.matrix);
        this.parts[part].setMatrixAt(index, this.matrix); this.parts[part].setColorAt(index, this.color.set(color));
      };
      pose(0, 0, 1.25, 0, .61, .72, .37, 0, p.color);
      pose(1, 0, 1.97, 0, .43, .51, .4, 0, '#d9af86');
      pose(2, -.4, 1.22, Math.sin(stride) * .2, .19, .67, .23, -stride * .85, p.color);
      pose(3, .4, 1.22, -Math.sin(stride) * .2, .19, .67, .23, stride * .85, p.color);
      pose(4, -.165, .49, -Math.sin(stride) * .38, .24, .85, .3, stride, '#4c6267');
      pose(5, .165, .49, Math.sin(stride) * .38, .24, .85, .3, -stride, '#4c6267');
      index++;
    }
    for (const mesh of this.parts) { mesh.count = index; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }
  dispose() { this.root.removeFromParent(); this.parts.forEach(p => p.dispose()); this.geometry.dispose(); this.material.dispose(); }
}
