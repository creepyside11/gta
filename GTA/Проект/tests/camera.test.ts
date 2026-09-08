import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { Building } from '../src/game/types.ts';
import { CameraRig } from '../src/render/CameraRig.ts';

function setup(buildings: Building[] = []) {
  const camera = new THREE.PerspectiveCamera(55, 1, .18, 740);
  const rig = new CameraRig(camera, buildings);
  rig.update({ x: 0, z: 0 }, false, 0, 0);
  return { camera, rig };
}

function assertMovementMatchesView(camera: THREE.Camera, rig: CameraRig) {
  const view = camera.getWorldDirection(new THREE.Vector3());
  const groundDirection = new THREE.Vector2(view.x, view.z).normalize();
  assert.ok(groundDirection.distanceTo(new THREE.Vector2(Math.sin(rig.getMovementYaw()), Math.cos(rig.getMovementYaw()))) < 1e-10);
}

const wall: Building = {
  id: 'wall', kind: 'building', x: 0, z: 6, width: 40, depth: 2,
  height: 30, yaw: 0, color: '#ffffff', style: 0,
};

test('mouse right turns toward screen right and mouse down looks down', () => {
  const { camera, rig } = setup();
  const initial = camera.getWorldDirection(new THREE.Vector3());
  const screenRight = new THREE.Vector3().crossVectors(initial, camera.up).normalize();
  rig.look(180, 100);
  rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
  const turned = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(turned.dot(screenRight) > .2);
  assert.ok(turned.y < initial.y);
  assertMovementMatchesView(camera, rig);
});

test('many full mouse orbits keep finite wrapped yaw and match the rendered direction', () => {
  const { camera, rig } = setup();
  for (let i = 0; i < 500; i++) {
    rig.look(173, i % 2 ? -20 : 20);
    rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
    assert.ok(Math.abs(rig.getMovementYaw()) <= Math.PI);
    assertMovementMatchesView(camera, rig);
  }
  const yaw = rig.getMovementYaw();
  rig.look(Number.NaN, Number.POSITIVE_INFINITY);
  assert.equal(rig.getMovementYaw(), yaw);
});

test('vertical mouse limits avoid inversion and keep both camera modes above the road', () => {
  const { camera, rig } = setup();
  for (const deltaY of [-1e6, 1e6]) {
    rig.look(0, deltaY);
    for (const driving of [false, true]) {
      for (let mode = 0; mode < 2; mode++) {
        rig.cycleCamera();
        rig.update({ x: 0, z: 0 }, driving, 30, 1);
        const view = camera.getWorldDirection(new THREE.Vector3());
        assert.ok(camera.position.y >= .4 - 1e-10);
        assert.ok(Math.hypot(view.x, view.z) > .3, 'the view cannot flip over its vertical pole');
        assert.ok(deltaY < 0 ? view.y > 0 && view.y < .2 : view.y < -.9);
        assertMovementMatchesView(camera, rig);
      }
    }
  }
});

test('vehicle turns, entry, exit and C camera mode preserve the mouse-selected view', () => {
  const { camera, rig } = setup();
  rig.look(290, -60);
  rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
  const orientation = camera.quaternion.clone();
  const target = { x: 0, z: 0, yaw: Math.PI };
  for (let i = 0; i < 120; i++) {
    target.x += .2;
    target.z -= .1;
    target.yaw += .1;
    if (i === 50 || i === 100) rig.cycleCamera();
    rig.update(target, i >= 20 && i < 90, 20, 1 / 60);
    assert.ok(camera.quaternion.angleTo(orientation) < 1e-7);
    assertMovementMatchesView(camera, rig);
  }
});

test('a wall shortens the boom without changing direction and recovery eases outward', () => {
  const { camera, rig } = setup([wall]);
  const focus = new THREE.Vector3(0, 1.6, 0);
  const obstructedDistance = camera.position.distanceTo(focus);
  assert.ok(obstructedDistance > 4 && obstructedDistance < 6);
  assert.ok(Math.abs(camera.position.x) < 1e-10);
  assert.ok(camera.position.z < 4.82);
  assertMovementMatchesView(camera, rig);

  rig.look(Math.PI / .0025, 0);
  rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
  const recoveringDistance = camera.position.distanceTo(focus);
  assert.ok(recoveringDistance > obstructedDistance && recoveringDistance < 23);
  assertMovementMatchesView(camera, rig);
  for (let i = 0; i < 120; i++) rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
  assert.ok(camera.position.distanceTo(focus) > 22.9);

  rig.look(-Math.PI / .0025, 0);
  rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
  assert.ok(camera.position.z < 4.82, 'the camera must retract in the same frame');
  assert.ok(Math.abs(camera.position.distanceTo(focus) - obstructedDistance) < 1e-8);
  assertMovementMatchesView(camera, rig);
});

test('orbiting a building corner never cuts the camera segment through the building', () => {
  const building = { ...wall, x: 5, z: 6, width: 4, depth: 4 };
  const { camera, rig } = setup([building]);
  const box = new THREE.Box3(new THREE.Vector3(3, -.5, 4), new THREE.Vector3(7, 31.2, 8));
  const focus = new THREE.Vector3(0, 1.6, 0);
  for (let i = 0; i < 360; i++) {
    rig.look(-Math.PI / 180 / .0025, 0);
    rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
    const ray = new THREE.Ray(focus, camera.position.clone().sub(focus).normalize());
    const hit = ray.intersectBox(box, new THREE.Vector3());
    assert.ok(!hit || hit.distanceTo(focus) > camera.position.distanceTo(focus));
    assertMovementMatchesView(camera, rig);
  }
});

test('firearm equip and RMB prepare a shoulder view whose center ray follows the mouse immediately', () => {
  const { camera, rig } = setup();
  rig.setCombat(true);
  rig.update({ x: 0, z: 0 }, false, 0, 0);
  assert.ok(camera.position.x > .6 && camera.position.x < .8, 'the avatar appears left of the crosshair');
  assert.ok(camera.position.z > 4 && camera.position.z < 5);
  assert.ok(Math.abs(rig.getPitch()) < .03, 'first equip starts at chest level');
  rig.look(80, -35);
  rig.update({ x: 0, z: 0 }, false, 0, 0);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const center = camera.position.clone().addScaledVector(direction, 50).project(camera);
  assert.ok(Math.hypot(center.x, center.y) < 1e-8, 'shots use the exact screen center despite the shoulder offset');
  const pitch = rig.getPitch(), yaw = rig.getMovementYaw();
  const hipDistance = camera.position.distanceTo(new THREE.Vector3(0, 1.6, 0));
  rig.setCombat(true, true);
  rig.update({ x: 0, z: 0 }, false, 0, 0);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(0, 1.6, 0)) < hipDistance);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction) < 1e-8);
  assertMovementMatchesView(camera, rig);
  rig.setCombat(false);
  rig.update({ x: 0, z: 0 }, true, 0, 1 / 60);
  assert.equal(rig.getPitch(), .42, 'driving and knife view retain their earlier pitch');
  assert.equal(rig.getMovementYaw(), yaw);
  rig.setCombat(true);
  assert.equal(rig.getPitch(), pitch, 'returning to a firearm restores its chosen pitch');
});

test('the shoulder offset retracts at walls while preserving crosshair and movement direction', () => {
  const building = { ...wall, z: 3 };
  const { camera, rig } = setup([building]);
  const box = new THREE.Box3(new THREE.Vector3(-20, -.5, 2), new THREE.Vector3(20, 31.2, 4));
  const focus = new THREE.Vector3(0, 1.6, 0);
  rig.setCombat(true);
  for (let i = 0; i < 180; i++) {
    rig.look(12, 0);
    rig.setCombat(true, i > 90);
    rig.update({ x: 0, z: 0 }, false, 0, 1 / 60);
    const ray = new THREE.Ray(focus, camera.position.clone().sub(focus).normalize());
    const hit = ray.intersectBox(box, new THREE.Vector3());
    assert.ok(!hit || hit.distanceTo(focus) > camera.position.distanceTo(focus));
    assertMovementMatchesView(camera, rig);
  }
});
