import * as THREE from 'three';
import type { Vehicle } from '../game/types';
import type { CarNode } from './VehicleModels';

type Panel = { mesh: THREE.Mesh; original: Float32Array; toBody: THREE.Matrix4; fromBody: THREE.Matrix4 };
type DamageVisual = { revision: number; panels: Panel[]; smoke: THREE.Group; geometry: THREE.SphereGeometry; material: THREE.MeshBasicMaterial };
const visuals = new WeakMap<CarNode, DamageVisual>();

/** Each damaged car gets private panel geometry; pristine cars keep shared cached meshes. */
export function updateVehicleDamage(node: CarNode, car: Vehicle, time: number) {
  let visual = visuals.get(node);
  if (!car.damage && !visual) return;
  if (!visual) {
    const panels: Panel[] = [];
    for (const child of node.root.children) {
      if (!(child instanceof THREE.Mesh)) continue; // Wheels remain rigid and keep their spin pivots.
      child.updateMatrix();
      const geometry = child.geometry.clone(); child.geometry = geometry;
      panels.push({ mesh: child, original: new Float32Array(geometry.getAttribute('position').array),
        toBody: child.matrix.clone(), fromBody: child.matrix.clone().invert() });
    }
    const smoke = new THREE.Group();
    const geometry = new THREE.SphereGeometry(1, 6, 4);
    const material = new THREE.MeshBasicMaterial({ color: '#737570', transparent: true, opacity: .22, depthWrite: false });
    for (let i = 0; i < 7; i++) smoke.add(new THREE.Mesh(geometry, material));
    node.root.add(smoke);
    visual = { revision: -1, panels, smoke, geometry, material }; visuals.set(node, visual);
  }
  const damage = car.damage;
  const revision = damage?.revision ?? -2;
  if (visual.revision !== revision) {
    const point = new THREE.Vector3();
    for (const panel of visual.panels) {
      const attribute = panel.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < attribute.count; i++) {
        point.fromArray(panel.original, i * 3).applyMatrix4(panel.toBody);
        if (damage) {
          // Localized crush zones, applied from pristine positions so deformation never accumulates per frame.
          const front = Math.max(0, point.z / (car.depth * .5) - .15) * damage.front;
          const rear = Math.max(0, -point.z / (car.depth * .5) - .15) * damage.rear;
          const right = Math.max(0, point.x / (car.width * .5) - .2) * damage.right;
          const left = Math.max(0, -point.x / (car.width * .5) - .2) * damage.left;
          point.z += (rear - front) * car.depth * .23;
          point.x += (left - right) * car.width * .22;
          const crease = (front + rear + left + right) * Math.sin(point.x * 8 + point.z * 6) * .11;
          point.y += crease - (front + rear) * .12;
        }
        point.applyMatrix4(panel.fromBody);
        attribute.setXYZ(i, point.x, point.y, point.z);
      }
      attribute.needsUpdate = true; panel.mesh.geometry.computeVertexNormals(); panel.mesh.geometry.computeBoundingSphere();
    }
    visual.revision = revision;
  }
  const heat = damage ? Math.max(0, .6 - damage.engine) / .6 : 0;
  visual.smoke.visible = heat > 0;
  if (heat) {
    visual.material.opacity = .1 + heat * .2;
    visual.smoke.children.forEach((cloud, i) => {
      const phase = (time * .45 + i / 7) % 1;
      cloud.position.set(Math.sin(i * 3 + time) * phase * .4, 1.2 + phase * 2, car.depth * .3 - phase * .35);
      cloud.scale.setScalar(.12 + phase * .6 * heat);
    });
  }
}
export function disposeVehicleDamage(node: CarNode) {
  const visual = visuals.get(node);
  if (!visual) return;
  for (const panel of visual.panels) panel.mesh.geometry.dispose();
  node.root.remove(visual.smoke); visual.geometry.dispose(); visual.material.dispose(); visuals.delete(node);
}
