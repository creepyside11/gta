import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import * as THREE from 'three';
import type { Building, BuildingArchitecture } from '../src/game/types.ts';
import { createWorld } from '../src/game/world.ts';
import { buildSpecialBuilding, type BuildingBatch, type BuildingSign } from '../src/render/BuildingModels.ts';
import { createCabinGeometry, type Shape } from '../src/render/VehicleModels.ts';

const geometries: Record<Shape | 'sign', THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
  sphere: new THREE.SphereGeometry(1, 9, 6),
  cone: new THREE.ConeGeometry(1, 1, 5),
  cabin: createCabinGeometry(),
  sign: new THREE.PlaneGeometry(1, 1),
};
Object.values(geometries).forEach(geometry => geometry.computeBoundingBox());
after(() => Object.values(geometries).forEach(geometry => geometry.dispose()));

function verifyBuilding(b: Building) {
  let primitives = 0;
  const total = new THREE.Box3();
  const measure = (shape: Shape | 'sign', x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, tiltZ = 0, tiltX = 0) => {
    assert.ok([x, y, z, sx, sy, sz, yaw, tiltZ, tiltX].every(Number.isFinite));
    assert.ok(sx > 0 && sy > 0 && sz > 0, `${b.id}: ${shape} must have positive dimensions`);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ)), new THREE.Vector3(sx, sy, sz));
    const bounds = geometries[shape].boundingBox!.clone().applyMatrix4(matrix);
    const detail = `${b.id} (${b.architecture}, ${b.width} x ${b.depth} x ${b.height}), primitive ${primitives} (${shape}): ${JSON.stringify(bounds)}`;
    assert.ok(bounds.min.x >= b.x - b.width / 2 - 1e-5 && bounds.max.x <= b.x + b.width / 2 + 1e-5, `width exceeds solid footprint: ${detail}`);
    assert.ok(bounds.min.z >= b.z - b.depth / 2 - 1e-5 && bounds.max.z <= b.z + b.depth / 2 + 1e-5, `depth exceeds solid footprint: ${detail}`);
    assert.ok(bounds.min.y >= -1e-5 && bounds.max.y <= b.height + 1e-5, `geometry exceeds ground/roof collision bounds: ${detail}`);
    total.union(bounds);
    primitives++;
  };
  const batch: BuildingBatch = (shape, _color, x, y, z, sx, sy, sz, yaw, _shadow, tiltZ, tiltX) => measure(shape, x, y, z, sx, sy, sz, yaw, tiltZ, tiltX);
  const sign: BuildingSign = (text, width, height, _bg, _fg, x, y, z, yaw) => {
    assert.ok(text.length > 0);
    measure('sign', x, y, z, width, height, 1, yaw);
  };
  assert.equal(buildSpecialBuilding(b, batch, sign), true);
  assert.ok(primitives > 20, 'special buildings include complete architecture and facade detail');
  assert.ok(total.max.y >= b.height - .5, 'the visual roof matches the authoritative height');
}

const world = createWorld();
for (const architecture of ['warehouse', 'office', 'townhouse', 'supermarket', 'civic'] as BuildingArchitecture[]) {
  test(`${architecture} meshes and signs fit the solid bounds of every live building`, () => {
    const buildings = world.buildings.filter(building => building.architecture === architecture);
    assert.ok(buildings.length > 0, `${architecture} must actually appear in the city`);
    buildings.forEach(verifyBuilding);
  });
}

test('legacy and apartment buildings preserve the existing renderer without emitting duplicate meshes', () => {
  const apartment = world.buildings.find(building => building.architecture === 'apartment')!;
  assert.ok(apartment);
  const unexpected = () => assert.fail('the existing apartment builder must retain full ownership');
  assert.equal(buildSpecialBuilding(apartment, unexpected, unexpected), false);
  assert.equal(buildSpecialBuilding({ ...apartment, architecture: undefined }, unexpected, unexpected), false);
});
