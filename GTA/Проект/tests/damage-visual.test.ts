import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicles } from '../src/game/ai';
import { freshDamage } from '../src/game/damage';
import { updateVehicleDamage, disposeVehicleDamage } from '../src/render/VehicleDamageVisual';
import type { CarNode } from '../src/render/VehicleModels';

test('crush geometry is private, stable across frames, and reset restores pristine panel coordinates', () => {
  const shared = new THREE.BoxGeometry(2, 1, 4), material = new THREE.MeshBasicMaterial();
  const root = new THREE.Group(), panel = new THREE.Mesh(shared, material), neighbor = new THREE.Mesh(shared, material);
  root.add(panel);
  const node: CarNode = { root, wheels: [], frontWheels: [], wheelRadius: .46 };
  const car = createVehicles()[0]; car.damage = freshDamage(); car.damage.front = .8; car.damage.revision = 1;
  const before = Array.from(shared.getAttribute('position').array);
  updateVehicleDamage(node, car, 1);
  assert.notEqual(panel.geometry, neighbor.geometry);
  assert.deepEqual(Array.from(neighbor.geometry.getAttribute('position').array), before);
  const dent = Array.from(panel.geometry.getAttribute('position').array);
  assert.notDeepEqual(dent, before);
  updateVehicleDamage(node, car, 2);
  assert.deepEqual(Array.from(panel.geometry.getAttribute('position').array), dent);
  car.damage = undefined; updateVehicleDamage(node, car, 3);
  assert.deepEqual(Array.from(panel.geometry.getAttribute('position').array), before);
  disposeVehicleDamage(node); shared.dispose(); material.dispose();
});
