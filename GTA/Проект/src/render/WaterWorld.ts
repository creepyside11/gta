import * as THREE from 'three';
import type { World } from '../game/types';

type Craft = { root: THREE.Group; phase: number; speed: number; rx: number; rz: number; wake: THREE.Mesh };

export class WaterWorld {
  private readonly water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly craft: Craft[] = [];

  constructor(scene: THREE.Scene, world: World, mobile: boolean) {
    const size = Math.max(1100, world.size + 720);
    const geometry = new THREE.PlaneGeometry(size, size, mobile ? 30 : 56, mobile ? 30 : 56);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        deepColor: { value: new THREE.Color('#287c8d') },
        shallowColor: { value: new THREE.Color('#62c4c3') },
        skyColor: { value: new THREE.Color('#c8eff1') },
      },
      vertexShader: 'uniform float time; varying float vWave; varying vec3 vWorld; void main(){ vec3 p=position; float w=sin(p.x*.036+time*1.15)*.13+cos(p.y*.031-time*.82)*.09+sin((p.x+p.y)*.018+time*.56)*.06; p.z+=w; vWave=w; vec4 world=modelMatrix*vec4(p,1.0); vWorld=world.xyz; gl_Position=projectionMatrix*viewMatrix*world; }',
      fragmentShader: 'uniform float time; uniform vec3 deepColor; uniform vec3 shallowColor; uniform vec3 skyColor; varying float vWave; varying vec3 vWorld; void main(){ float bands=.5+.5*sin(vWorld.x*.075+vWorld.z*.052+time*1.7); float foam=smoothstep(.72,1.0,bands)*.18; vec3 base=mix(deepColor,shallowColor,clamp(.48+vWave*1.8,0.0,1.0)); float glint=pow(max(0.0,sin(vWorld.x*.024-time)*cos(vWorld.z*.021+time*.7)),10.0)*.42; vec3 color=mix(base,skyColor,glint+foam); gl_FragColor=vec4(color,.97); }',
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.water = new THREE.Mesh(geometry, material);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -.82;
    this.water.receiveShadow = true;
    scene.add(this.water);

    const edge = world.size / 2;
    const craftCount = mobile ? 7 : 11;
    for (let i = 0; i < craftCount; i++) {
      const yacht = i % 3 === 0;
      const root = yacht ? this.makeYacht(i) : this.makeBoat(i);
      const wake = this.makeWake(yacht);
      root.add(wake);
      scene.add(root);
      this.craft.push({ root, wake, phase: i / craftCount * Math.PI * 2, speed: .055 + (i % 4) * .009, rx: edge + 38 + i % 3 * 17, rz: edge + 45 + (i * 2) % 4 * 14 });
    }
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
    this.water.material.uniforms.time.value = time;
    for (let i = 0; i < this.craft.length; i++) {
      const craft = this.craft[i];
      const angle = craft.phase + time * craft.speed;
      const x = Math.cos(angle) * craft.rx;
      const z = Math.sin(angle) * craft.rz;
      const dx = -Math.sin(angle) * craft.rx;
      const dz = Math.cos(angle) * craft.rz;
      craft.root.position.set(x, -.5 + Math.sin(time * 1.6 + i) * .055, z);
      craft.root.rotation.y = Math.atan2(dx, dz);
      craft.root.rotation.z = Math.sin(time * 1.25 + i * .7) * .018;
      craft.root.rotation.x = Math.sin(time * 1.05 + i) * .012;
      (craft.wake.material as THREE.MeshBasicMaterial).opacity = (.2 + (i % 3) * .035) * (.88 + Math.sin(time * 2 + i) * .12);
    }
  }
}
