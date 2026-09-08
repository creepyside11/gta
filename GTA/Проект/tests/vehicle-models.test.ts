import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import * as THREE from 'three';
import { createVehicles } from '../src/game/ai.ts';
import type { VehicleModel } from '../src/game/types.ts';
import { createCabinGeometry, createVehicleModel, type Shape, type VehiclePart } from '../src/render/VehicleModels.ts';

// Exercise the real model builders with the renderer's unit primitive convention,
// without constructing a WebGL context or substituting simplified vehicle boxes.
const geometries: Record<Shape, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
  sphere: new THREE.SphereGeometry(1, 9, 6),
  cone: new THREE.ConeGeometry(1, 1, 5),
  cabin: createCabinGeometry(),
};
const material = new THREE.MeshBasicMaterial();
const part: VehiclePart = (parent, shape, _color, x, y, z, sx, sy, sz, yaw = 0) => {
  const mesh = new THREE.Mesh(geometries[shape], material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = yaw;
  parent.add(mesh);
  return mesh;
};

after(() => {
  Object.values(geometries).forEach(geometry => geometry.dispose());
  material.dispose();
});

function modelScene(model: VehicleModel) {
  const vehicle = createVehicles().find(v => v.model === model)!;
  assert.ok(vehicle, `${model} is used by the live fleet`);
  return { vehicle, node: createVehicleModel(vehicle, part) };
}

for (const model of ['truck', 'pickup', 'hatchback', 'sport'] as const) {
  test(`${model} mesh stays within its collider while the wheels roll and steer`, () => {
    const { vehicle, node } = modelScene(model);
    // Driving clamps the steering to ±.58; the renderer displays 36% of it.
    for (const steer of [-.58 * .36, 0, .58 * .36]) {
      node.frontWheels.forEach(wheel => { wheel.rotation.y = steer; });
      for (const roll of [0, Math.PI / 8, Math.PI / 3, Math.PI / 2]) {
        node.wheels.forEach(wheel => { wheel.rotation.x = roll; });
        const bounds = new THREE.Box3().setFromObject(node.root, true);
        const halfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
        const halfDepth = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
        assert.ok(halfWidth <= vehicle.width / 2 + 1e-6, `${model}: visible half-width ${halfWidth} exceeds collider ${vehicle.width / 2}`);
        assert.ok(halfDepth <= vehicle.depth / 2 + 1e-6, `${model}: visible half-depth ${halfDepth} exceeds collider ${vehicle.depth / 2}`);
        assert.ok(bounds.min.y >= -1e-6, `${model} penetrates the road plane`);
      }
    }
  });
}

test('the truck exposes six independent rolling wheels and only the front axle steers', () => {
  const { node } = modelScene('truck');
  assert.equal(new Set(node.wheels).size, 6);
  assert.equal(new Set(node.frontWheels).size, 2);
  const joints = node.wheels.map(wheel => wheel.parent!);
  assert.equal(new Set(joints).size, 6, 'each wheel must have its own steering pivot');
  assert.ok(joints.every(joint => joint.parent === node.root));
  const axles = [...new Set(joints.map(joint => joint.position.z))].sort((a, b) => a - b);
  assert.equal(axles.length, 3);
  for (const z of axles) {
    const axle = joints.filter(joint => joint.position.z === z);
    assert.equal(axle.length, 2);
    assert.ok(axle[0].position.x * axle[1].position.x < 0, 'each axle needs wheels on both sides');
  }
  assert.ok(node.frontWheels.every(joint => joints.includes(joint) && joint.position.z === axles[2]));
  for (const wheel of node.wheels) {
    const tire = wheel.children[0] as THREE.Mesh;
    tire.updateMatrix();
    const bounds = new THREE.Box3().setFromBufferAttribute(tire.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(tire.matrix);
    assert.ok(Math.abs(bounds.max.y - node.wheelRadius) < 1e-6);
    assert.ok(Math.abs(bounds.max.z - node.wheelRadius) < 1e-6);
    assert.ok(bounds.max.x < node.wheelRadius / 2, 'the rolling axis must run across the vehicle');
  }
});

test('the shared cabin is tapered with outward faces and finite unit normals', () => {
  const geometry = geometries.cabin;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const upper: THREE.Vector3[] = [], lower: THREE.Vector3[] = [];
  for (let i = 0; i < positions.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(positions, i);
    (vertex.y > 0 ? upper : lower).push(vertex);
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
    assert.ok([normal.x, normal.y, normal.z].every(Number.isFinite));
    assert.ok(Math.abs(normal.length() - 1) < 1e-6);
  }
  for (const axis of ['x', 'z'] as const) {
    assert.ok(Math.max(...upper.map(v => Math.abs(v[axis]))) < Math.max(...lower.map(v => Math.abs(v[axis]))));
  }
  const indices = geometry.getIndex()!;
  for (let i = 0; i < indices.count; i += 3) {
    const triangle = new THREE.Triangle(...[0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + offset))) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
    assert.ok(triangle.getArea() > 0);
    assert.ok(triangle.getNormal(new THREE.Vector3()).dot(triangle.getMidpoint(new THREE.Vector3())) > 0, 'cabin faces must point outwards');
  }
});

test('the pickup has an open recessed bed and the new body silhouettes differ in height', () => {
  const pickup = modelScene('pickup').node;
  pickup.root.updateMatrixWorld(true);
  const topAt = (x: number, z: number) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(pickup.root, true)[0];
    assert.ok(hit, 'the bed must have a visible solid floor');
    return hit.point.y;
  };
  assert.ok(topAt(0, -1.5) < topAt(1.02, -1.5) - .35, 'the bed center must sit below its side rails');
  const height = (model: VehicleModel) => new THREE.Box3().setFromObject(modelScene(model).node.root, true).max.y;
  assert.ok(height('truck') > height('pickup') + 1, 'the cargo box must read as a tall truck');
  assert.ok(height('hatchback') > height('sport') + .3, 'the compact and coupe need distinct rooflines');
});
