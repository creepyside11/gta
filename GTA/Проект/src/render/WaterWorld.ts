import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import type { World } from '../game/types';

type Craft = { root: THREE.Group; phase: number; speed: number; rx: number; rz: number; wake: THREE.Mesh };

/** Ocean, beaches and offshore life. Uses Three.js Water with an offline procedural normal map. */
export class WaterWorld {
  private readonly water: Water;
  private readonly craft: Craft[] = [];
  private readonly foam: THREE.Mesh[] = [];
  private readonly shore = new THREE.Group();

  constructor(scene: THREE.Scene, world: World, mobile: boolean) {
    const size = Math.max(1700, world.size + 900);
    const normalMap = this.makeNormalMap(mobile ? 96 : 160);
    this.water = new Water(new THREE.PlaneGeometry(size, size), {
      textureWidth: mobile ? 256 : 512,
      textureHeight: mobile ? 256 : 512,
      waterNormals: normalMap,
      sunDirection: new THREE.Vector3(-.45, .92, .38).normalize(),
      sunColor: 0xffefd2,
      waterColor: 0x116f83,
      distortionScale: mobile ? 1.65 : 2.35,
      fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -.72;
    this.water.receiveShadow = true;
    this.water.name = 'ocean-water';
    scene.add(this.water);

    this.buildShore(scene, world);

    const edge = world.size / 2;
    const craftCount = mobile ? 6 : 10;
    for (let i = 0; i < craftCount; i++) {
      const yacht = i % 3 === 0;
      const root = yacht ? this.makeYacht(i) : this.makeBoat(i);
      const wake = this.makeWake(yacht);
      root.add(wake);
      scene.add(root);
      this.craft.push({ root, wake, phase: i / craftCount * Math.PI * 2, speed: .055 + (i % 4) * .009, rx: edge + 42 + i % 3 * 18, rz: edge + 50 + (i * 2) % 4 * 15 });
    }
  }

  private makeNormalMap(size: number) {
    const data = new Uint8Array(size * size * 4);
    const sample = (x: number, y: number) =>
      Math.sin(x * .31 + y * .09) * .55 + Math.sin(x * .11 - y * .27) * .3 + Math.cos((x + y) * .17) * .2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const l = sample((x - 1 + size) % size, y), r = sample((x + 1) % size, y);
      const d = sample(x, (y - 1 + size) % size), u = sample(x, (y + 1) % size);
      const n = new THREE.Vector3((l - r) * .8, (d - u) * .8, 1).normalize();
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((n.x * .5 + .5) * 255);
      data[offset + 1] = Math.round((n.y * .5 + .5) * 255);
      data[offset + 2] = Math.round((n.z * .5 + .5) * 255);
      data[offset + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private buildShore(scene: THREE.Scene, world: World) {
    const edge = world.size / 2;
    this.shore.name = 'beaches-and-shore';
    scene.add(this.shore);
    const sand = new THREE.MeshStandardMaterial({ color: '#e6cb91', roughness: .98, metalness: 0 });
    const wet = new THREE.MeshStandardMaterial({ color: '#c6ad78', roughness: .92, metalness: 0 });
    const dune = new THREE.MeshStandardMaterial({ color: '#dcc184', roughness: 1, metalness: 0 });
    const strip = (x: number, z: number, width: number, depth: number, material: THREE.Material, y = .075) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, .14, depth), material);
      mesh.position.set(x, y, z); mesh.receiveShadow = true; this.shore.add(mesh); return mesh;
    };

    // Vice Beach gets a broad continuous beach between the last avenue and the ocean.
    strip(edge - 29, 0, 58, 370, sand);
    strip(edge - 4.5, 0, 9, 370, wet, .065);
    // Other coasts get narrower public beaches so the square landmass no longer ends in bare concrete.
    strip(-edge + 9, 0, 18, world.size - 34, dune);
    strip(0, -edge + 9, world.size - 34, 18, sand);
    strip(0, edge - 9, world.size - 34, 18, sand);

    const foamMaterial = new THREE.MeshBasicMaterial({ color: '#e9fbf7', transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide });
    const foamStrip = (x: number, z: number, width: number, depth: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), foamMaterial.clone());
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, -.64, z); this.shore.add(mesh); this.foam.push(mesh);
    };
    foamStrip(edge + 1.4, 0, 8, 370);
    foamStrip(-edge - .8, 0, 5, world.size - 32);
    foamStrip(0, -edge - .8, world.size - 32, 5);
    foamStrip(0, edge + .8, world.size - 32, 5);
  }

  private mat(color: string, roughness = .72, metalness = .02) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  private mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private makeBoat(seed: number) {
    const root = new THREE.Group();
    const colors = ['#f2efe5', '#e77e68', '#6ba5b5', '#ddb85f'];
    const paint = this.mat(colors[seed % colors.length], .5);
    const dark = this.mat('#294852', .42, .08);
    const hull = this.mesh(root, new THREE.BoxGeometry(2.5, .55, 6.1), paint, 0, .05, 0);
    hull.scale.x = .86;
    const bow = this.mesh(root, new THREE.ConeGeometry(1.2, 2.1, 4), paint, 0, .08, 3.45);
    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;
    this.mesh(root, new THREE.BoxGeometry(1.65, .48, 2.05), dark, 0, .62, -.35);
    const glass = this.mesh(root, new THREE.BoxGeometry(1.45, .34, .08), new THREE.MeshStandardMaterial({ color: '#9ed6de', roughness: .18, metalness: .08, transparent: true, opacity: .82 }), 0, .93, .72, false);
    glass.rotation.x = -.32;
    this.mesh(root, new THREE.BoxGeometry(1.85, .1, 2.55), this.mat('#f3e9d5', .82), 0, .42, -.22);
    this.mesh(root, new THREE.CylinderGeometry(.15, .18, .55, 8), dark, 0, .38, -3.03);
    root.scale.setScalar(.82 + seed % 2 * .08);
    return root;
  }

  private makeYacht(seed: number) {
    const root = new THREE.Group();
    const paint = this.mat(seed % 2 ? '#f5f0df' : '#e8ece8', .48);
    const stripe = this.mat(seed % 2 ? '#3f7f92' : '#6b829a', .42, .05);
    this.mesh(root, new THREE.BoxGeometry(3.2, .72, 9.5), paint, 0, .02, 0);
    const bow = this.mesh(root, new THREE.ConeGeometry(1.55, 3.2, 4), paint, 0, .06, 5.25);
    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;
    this.mesh(root, new THREE.BoxGeometry(3.26, .18, 6.5), stripe, 0, .06, -.7);
    this.mesh(root, new THREE.BoxGeometry(2.25, .72, 3.4), this.mat('#f4ead8', .78), 0, .8, -1.25);
    this.mesh(root, new THREE.BoxGeometry(2.05, .42, .1), new THREE.MeshStandardMaterial({ color: '#78aab8', roughness: .2, transparent: true, opacity: .86 }), 0, 1.08, .5, false);
    const mast = this.mesh(root, new THREE.CylinderGeometry(.08, .1, 7.2, 8), this.mat('#d8d0bc', .58), 0, 4.5, .25);
    mast.castShadow = true;
    const sailGeometry = new THREE.BufferGeometry();
    sailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,5.6,0, 2.65,.35,0], 3));
    sailGeometry.computeVertexNormals();
    const sail = this.mesh(root, sailGeometry, new THREE.MeshStandardMaterial({ color: '#fff8e8', roughness: .9, side: THREE.DoubleSide }), .12, 1.45, .25);
    sail.rotation.y = .08;
    this.mesh(root, new THREE.BoxGeometry(2.5, .12, 4.2), this.mat('#d7c19b', .88), 0, .5, -1.1);
    root.scale.setScalar(.88 + seed % 2 * .06);
    return root;
  }

  private makeWake(yacht: boolean) {
    const material = new THREE.MeshBasicMaterial({ color: '#d8f4ef', transparent: true, opacity: yacht ? .24 : .31, depthWrite: false, side: THREE.DoubleSide });
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(yacht ? 3.2 : 2.2, yacht ? 10 : 7), material);
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(0, -.29, yacht ? -7.2 : -5.1);
    return wake;
  }

  update(time: number) {
    const uniforms = (this.water.material as THREE.ShaderMaterial).uniforms;
    uniforms.time.value = time * .48;
    this.foam.forEach((mesh, index) => {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = .23 + Math.sin(time * 1.35 + index * 1.8) * .08;
    });
    for (let i = 0; i < this.craft.length; i++) {
      const craft = this.craft[i];
      const angle = craft.phase + time * craft.speed;
      const x = Math.cos(angle) * craft.rx;
      const z = Math.sin(angle) * craft.rz;
      const dx = -Math.sin(angle) * craft.rx;
      const dz = Math.cos(angle) * craft.rz;
      craft.root.position.set(x, -.43 + Math.sin(time * 1.6 + i) * .055, z);
      craft.root.rotation.y = Math.atan2(dx, dz);
      craft.root.rotation.z = Math.sin(time * 1.25 + i * .7) * .018;
      craft.root.rotation.x = Math.sin(time * 1.05 + i) * .012;
      (craft.wake.material as THREE.MeshBasicMaterial).opacity = (.2 + (i % 3) * .035) * (.88 + Math.sin(time * 2 + i) * .12);
    }
  }
}
