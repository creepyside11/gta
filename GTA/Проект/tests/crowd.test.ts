import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPedestrians } from '../src/game/ai';
import { CrowdLOD, usesDetailedPerson } from '../src/render/CrowdLOD';

test('all 72 citizens have unique persistent identities and real routes', () => {
  const people = createPedestrians();
  assert.equal(people.length, 72); assert.equal(new Set(people.map(p => p.id)).size, 72);
  assert.deepEqual(people, createPedestrians());
  for (const p of people) { assert.equal(p.health, 100); assert.ok(p.route.length >= 4); }
});

test('every citizen has exactly one representation at all approach distances, including 18m', () => {
  const people = createPedestrians().slice(0, 1), p = people[0]; p.x = 0; p.z = 0;
  const crowd = new CrowdLOD(1), matrix = new THREE.Matrix4();
  for (const distance of [300, 150, 70.01, 70, 69.99, 18.01, 18, 17.99, 0]) {
    const observer = { x: distance, z: 0 }; crowd.update(people, observer, 0);
    assert.equal(crowd.parts[0].count + Number(usesDetailedPerson(p, observer)), 1);
    if (crowd.parts[0].count) { crowd.parts[0].getMatrixAt(0, matrix); assert.equal(matrix.elements[12], p.x); assert.equal(matrix.elements[14], p.z); }
  }
  p.state = 'dead'; p.deadAt = 0; crowd.update(people, { x: 200, z: 0 }, 60);
  assert.equal(crowd.parts[0].count, 1, 'a persistent simulated corpse does not vanish on a timer');
  crowd.dispose();
});
