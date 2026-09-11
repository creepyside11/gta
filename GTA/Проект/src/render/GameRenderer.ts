import { CrowdLOD, usesDetailedPerson } from './CrowdLOD';
import { updateVehicleDamage, disposeVehicleDamage } from './VehicleDamageVisual';
import * as THREE from 'three';
import type { AimRay, Building, GameState, InputFrame, Vehicle, WeaponId, World } from '../game/types';
import { createCabinGeometry, createVehicleModel, type CarNode, type Shape } from './VehicleModels';
import { CameraRig } from './CameraRig';
import { createWeaponModel, type WeaponNode } from './WeaponModels';
import { buildSpecialBuilding } from './BuildingModels';
import { WaterWorld } from './WaterWorld';
import { EnvironmentModels } from './EnvironmentModels';

type Batch = { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; shadow: boolean };
type ArmedArms = {
  root: THREE.Group; rightSleeve: THREE.Mesh; rightForearm: THREE.Mesh; leftSleeve: THREE.Mesh; leftForearm: THREE.Mesh;
  rightHand: THREE.Mesh; leftHand: THREE.Mesh; rightGoal: THREE.Vector3; leftGoal: THREE.Vector3;
};
type PersonNode = {
  root: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; body: THREE.Group;
  skin: string; shirt: string; weapons?: Partial<Record<WeaponId, WeaponNode>>; armedArms?: ArmedArms;
};

/** Procedural, batched city art. Simulation owns every position and collider. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, .18, 740);
  private readonly world: World;
  private readonly host: HTMLElement;
  private readonly geometries: Record<Shape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
    sphere: new THREE.SphereGeometry(1, 9, 6),
    cone: new THREE.ConeGeometry(1, 1, 5),
    cabin: createCabinGeometry(),
  };
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly batches = new Map<string, Batch>();
  private readonly textures: THREE.Texture[] = [];
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly people = new Map<string, PersonNode>();
  private readonly officers = new Map<string, PersonNode>();
  private readonly cars = new Map<string, CarNode>();
  private readonly player: PersonNode;
  private readonly marker = new THREE.Group();
  private readonly markerDiamond: THREE.Mesh;
  private readonly markerRing: THREE.Mesh;
  private readonly markerText: THREE.Sprite;
  private readonly restrictedRing: THREE.Mesh;
  private readonly sun = new THREE.DirectionalLight('#ffebcd', 3.15);
  private readonly clouds = new THREE.Group();
  private readonly gulls = new THREE.Group();
  private readonly cameraRig: CameraRig;
  private readonly aimDirection = new THREE.Vector3();
  private readonly limbDirection = new THREE.Vector3();
  private readonly limbUp = new THREE.Vector3(0, 1, 0);
  private readonly rightShoulder = new THREE.Vector3(-.4, 1.54, 0);
  private readonly leftShoulder = new THREE.Vector3(.4, 1.54, 0);
  private readonly rightElbow = new THREE.Vector3(-.46, 1.28, .16);
  private readonly leftElbow = new THREE.Vector3(.24, 1.32, .23);
  private readonly knifeRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  private readonly tracePositions = new Float32Array(64 * 6);
  private readonly traceColors = new Float32Array(64 * 6);
  private readonly traces = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85, depthWrite: false }));
  private readonly impactFlashes: THREE.Mesh[] = [];
  private labelPhase = '';
  private disposed = false;
  private readonly mobile: boolean;
  private readonly dynamicCullDistance: number;
  private readonly crowd: CrowdLOD;
  private readonly waterWorld: WaterWorld;
  private readonly environmentModels: EnvironmentModels;

  constructor(host: HTMLElement, world: World, state: GameState) {
    this.host = host;
    this.world = world;
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    this.mobile = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || coarsePointer;
    this.dynamicCullDistance = this.mobile ? 185 : 280;
    this.camera.far = this.mobile ? 560 : 740;
    this.cameraRig = new CameraRig(this.camera, world.buildings);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.4 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.domElement.setAttribute('aria-label', 'Portside interactive 3D city');
    this.renderer.domElement.tabIndex = -1;
    this.host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#addbdc');
    this.scene.fog = new THREE.Fog('#addbdc', this.mobile ? 108 : 115, this.mobile ? 350 : 340);
    this.scene.add(new THREE.HemisphereLight('#e6f7ff', '#948d77', 2.15));
    this.sun.position.set(-70, 120, 65);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    this.sun.shadow.camera.left = -92;
    this.sun.shadow.camera.right = 92;
    this.sun.shadow.camera.top = 92;
    this.sun.shadow.camera.bottom = -92;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -.00022;
    this.sun.shadow.normalBias = .035;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.buildGround();
    world.buildings.forEach(b => { if (!b.assetModel) this.buildBuilding(b); });
    this.buildProps();
    this.environmentModels = new EnvironmentModels(this.scene, world, this.mobile);
    this.buildHarbor();
    this.waterWorld = new WaterWorld(this.scene, world, this.mobile);
    this.flushBatches();
    this.buildAtmosphere();
    if (this.mobile) this.clouds.visible = false;
    this.crowd = new CrowdLOD(state.pedestrians.length);
    this.scene.add(this.crowd.root);

    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffdb58', transparent: true, opacity: .86, side: THREE.DoubleSide, depthWrite: false });
    this.markerRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 48), ringMaterial);
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerRing.position.y = .14;
    this.marker.add(this.markerRing);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshBasicMaterial({ color: '#fdda61', opacity: .14, transparent: true, depthWrite: false }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = .13;
    this.marker.add(inner);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 7.5, 32, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color('#ffd74d') } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 color; varying vec2 vUv; void main(){float alpha=pow(1.0-vUv.y,2.8)*0.17;gl_FragColor=vec4(color,alpha);}',
    }));
    beam.position.y = 3.8;
    this.marker.add(beam);
    this.markerDiamond = new THREE.Mesh(new THREE.OctahedronGeometry(.57), this.material('#ffcf45', .45, '#e8a82a', .3));
    this.markerDiamond.position.y = 3.2;
    this.marker.add(this.markerDiamond);
    this.markerText = this.makeLabel('COURIER JOB', '#203944', '#ffdc6b', 4.4, .75);
    this.markerText.position.y = 6.2;
    this.marker.add(this.markerText);
    this.scene.add(this.marker);
    this.restrictedRing = new THREE.Mesh(new THREE.RingGeometry(world.restricted.radius - .24, world.restricted.radius, 72), new THREE.MeshBasicMaterial({ color: '#e68776', opacity: .52, transparent: true, depthWrite: false }));
    this.restrictedRing.rotation.x = -Math.PI / 2;
    this.restrictedRing.position.set(world.restricted.x, .13, world.restricted.z);
    this.scene.add(this.restrictedRing);
    this.player = this.makePerson('#f4ebd7', true);
    this.equipPerson(this.player, ['knife', 'pistol', 'rifle']);
    this.scene.add(this.player.root);
    this.traces.geometry.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.traces.geometry.setAttribute('color', new THREE.BufferAttribute(this.traceColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.traces.geometry.setDrawRange(0, 0);
    this.traces.frustumCulled = false;
    this.scene.add(this.traces);
    for (let i = 0; i < 16; i++) {
      const flash = new THREE.Mesh(this.geometries.sphere, this.material('#ffdc6b', .5, '#ffd263', 2));
      flash.visible = false;
      this.impactFlashes.push(flash);
      this.scene.add(flash);
    }
    this.resize();
    this.update(state, 0);
  }

  private material(color: string, roughness = .86, emissive?: string, intensity = 0) {
    const key = `${color}/${roughness}/${emissive ?? ''}/${intensity}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, emissive: emissive || '#000000', emissiveIntensity: intensity });
      this.materials.set(key, material);
    }
    return material;
  }

  private part(parent: THREE.Object3D, shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, shadow = true) {
    const mesh = new THREE.Mesh(this.geometries[shape], this.material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.y = yaw;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private batch(shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, shadow = true, tiltZ = 0, tiltX = 0) {
    const key = `${shape}/${color}/${shadow}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { geometry: this.geometries[shape], material: this.material(color), matrices: [], shadow };
      this.batches.set(key, batch);
    }
    batch.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ)), new THREE.Vector3(sx, sy, sz)));
  }

  private flushBatches() {
    for (const batch of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = batch.shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
    this.batches.clear();
  }

  private buildGround() {
    const w = this.world, half = w.size / 2;
    this.batch('box', '#53b6b8', 0, -1.5, 0, Math.max(1100, w.size + 700), 1, Math.max(1100, w.size + 700), 0, false);
    this.batch('box', '#d5cdb3', 0, -.95, 0, w.size + 2, 1.45, w.size + 2, 0, false);
    this.batch('box', '#aaa994', 0, -.03, 0, w.size, .11, w.size, 0, false);
    for (const road of w.roads) {
      this.batch('box', '#424d53', road, .015, 0, w.roadWidth, .12, w.size, 0, false);
      this.batch('box', '#424d53', 0, .017, road, w.size, .12, w.roadWidth, 0, false);
      for (const sign of [-1, 1]) {
        const boundaries = [-half, ...w.roads, half];
        for (let segment = 0; segment < boundaries.length - 1; segment++) {
          const start = boundaries[segment] + (segment === 0 ? 1 : w.roadWidth / 2);
          const end = boundaries[segment + 1] - (segment === boundaries.length - 2 ? 1 : w.roadWidth / 2);
          const length = end - start, shifted = (start + end) / 2;
          this.batch('box', '#ddd8c5', road + sign * (w.roadWidth / 2 + 2.35), .09, shifted, 4.7, .28, length, 0, false);
          this.batch('box', '#ddd8c5', shifted, .09, road + sign * (w.roadWidth / 2 + 2.35), length, .28, 4.7, 0, false);
          this.batch('box', '#eeebd8', road + sign * (w.roadWidth / 2 + .13), .12, shifted, .24, .3, length, 0, false);
          this.batch('box', '#eeebd8', shifted, .12, road + sign * (w.roadWidth / 2 + .13), length, .3, .24, 0, false);
        }
      }
      for (let along = -half + 3; along < half - 3; along += 8) {
        if (w.roads.some(r => Math.abs(along - r) < 13)) continue;
        this.batch('box', '#e6cc79', road - .16, .086, along, .1, .014, 4.4, 0, false);
        this.batch('box', '#e6cc79', road + .16, .086, along, .1, .014, 4.4, 0, false);
        this.batch('box', '#e6cc79', along, .087, road - .16, 4.4, .014, .1, 0, false);
        this.batch('box', '#e6cc79', along, .087, road + .16, 4.4, .014, .1, 0, false);
        for (const side of [-1, 1]) {
          this.batch('box', '#abb6b5', road + side * 6.6, .083, along, .11, .012, 3.4, 0, false);
          this.batch('box', '#abb6b5', along, .084, road + side * 6.6, 3.4, .012, .11, 0, false);
        }
      }
    }
    for (const x of w.roads) for (const z of w.roads) {
      for (const side of [-1, 1]) {
        for (let s = -7; s <= 7; s += 2) {
          this.batch('box', '#eeeee0', x + s, .094, z + side * 10.6, 1.03, .02, 3.2, 0, false);
          this.batch('box', '#eeeee0', x + side * 10.6, .095, z + s, 3.2, .02, 1.03, 0, false);
        }
        this.batch('box', '#e8e9d9', x + side * 4.2, .097, z + side * 13.2, 7.6, .02, .28, 0, false);
        this.batch('box', '#e8e9d9', x + side * 13.2, .098, z - side * 4.2, .28, .02, 7.6, 0, false);
      }
      // Small traffic signals leave the driving lanes clear.
      for (const sign of [-1, 1]) {
        const px = x + sign * 10.8, pz = z - sign * 10.8;
        this.batch('cylinder', '#56696a', px, 2.45, pz, .13, 4.8, .13);
        this.batch('box', '#34464b', px, 4.4, pz, .48, 1.18, .46);
        this.batch('sphere', sign > 0 ? '#a1d4a7' : '#ee9773', px, 4.62, pz + .25, .12, .12, .04, 0, false);
        this.batch('sphere', '#e5bf78', px, 4.22, pz + .25, .12, .12, .04, 0, false);
      }
    }
    // Hard perimeter rails are intentionally gone: WaterWorld now builds walkable sand,
    // wet shoreline and animated surf around the island.
  }

  private buildBuilding(b: Building) {
    if (buildSpecialBuilding(b, this.batch.bind(this), (text, width, height, bg, fg, x, y, z, yaw = 0) => {
      const sign = this.makeSign(text, width, height, bg, fg);
      sign.position.set(x, y, z); sign.rotation.y = yaw;
      this.scene.add(sign);
    })) return;
    const { x, z, width: w, depth: d, height: h } = b;
    const cap = b.style % 3 === 0 ? '#f8e8cd' : '#ede8d7';
    this.batch('box', b.color, x, h / 2 + .2, z, w, h, d);
    this.batch('box', '#ccc7b5', x, .37, z, w + .3, .55, d + .3);
    this.batch('box', cap, x, h + .25, z, w + .65, .48, d + .65);
    this.batch('box', '#85948b', x, h + .52, z, w - .65, .13, d - .65, 0, false);
    // Roof parapets and rooftop equipment give the skyline visible depth.
    for (const side of [-1, 1]) {
      this.batch('box', cap, x + side * (w / 2 - .23), h + .79, z, .45, .64, d);
      this.batch('box', cap, x, h + .79, z + side * (d / 2 - .23), w, .64, .45);
    }
    this.batch('box', '#b0b7af', x - w * .23, h + 1.05, z - d * .14, 2.5, 1, 2.2);
    this.batch('cylinder', '#6e7e7a', x - w * .23, h + 1.57, z - d * .14, .7, .12, .7);
    if (b.style % 2 === 0) {
      this.batch('box', '#879c9b', x + w * .15, h + .77, z + d * .18, 3.4, .22, 2.2, 0, true, 0, -.13);
      this.batch('box', '#d0d8ce', x + w * .15, h + .78, z + d * .18, .05, .28, 2.22, 0, false, 0, -.13);
    }
    const glass = b.style % 3 === 0 ? '#4d7279' : '#527880';
    const floors = Math.max(1, Math.floor((h - 3.4) / 3.2));
    for (let floor = 0; floor < floors; floor++) {
      const y = 4.9 + floor * 3.05;
      if (y + 1.1 >= h) break;
      for (const side of [-1, 1]) {
        for (let dx = -w / 2 + 2.15; dx < w / 2 - 1.1; dx += 3.6) {
          this.batch('box', '#f1e7cf', x + dx, y, z + side * (d / 2 + .055), 1.8, 2.05, .15, 0, false);
          this.batch('box', glass, x + dx, y + .03, z + side * (d / 2 + .145), 1.51, 1.75, .025, 0, false);
          this.batch('box', '#cfdbc9', x + dx, y + .03, z + side * (d / 2 + .165), .075, 1.75, .03, 0, false);
          this.batch('box', cap, x + dx, y - 1.02, z + side * (d / 2 + .18), 1.98, .13, .36);
          if (b.style % 4 === 2 && floor === 0) {
            this.batch('box', cap, x + dx, y - 1.05, z + side * (d / 2 + .63), 2.3, .2, 1.2);
            this.batch('box', '#5c7874', x + dx, y - .65, z + side * (d / 2 + 1.12), 2.3, .06, .06);
          }
        }
        for (let dz = -d / 2 + 2.15; dz < d / 2 - 1.1; dz += 3.6) {
          this.batch('box', '#f1e7cf', x + side * (w / 2 + .055), y, z + dz, .15, 2.05, 1.8, 0, false);
          this.batch('box', glass, x + side * (w / 2 + .145), y + .03, z + dz, .025, 1.75, 1.51, 0, false);
          this.batch('box', '#cfdbc9', x + side * (w / 2 + .165), y + .03, z + dz, .03, 1.75, .075, 0, false);
          this.batch('box', cap, x + side * (w / 2 + .18), y - 1.02, z + dz, .36, .13, 1.98);
        }
      }
    }
    // Ground-floor storefronts wrap two sides of every building.
    const awning = b.style % 3 === 0 ? '#b9634c' : b.style % 3 === 1 ? '#337e78' : '#d8aa4b';
    for (const side of [-1, 1]) {
      for (let dx = -w / 2 + 2.7; dx < w / 2 - 1.5; dx += 5.2) {
        this.batch('box', '#e7dfc8', x + dx, 1.65, z + side * (d / 2 + .04), 4.25, 2.9, .18);
        this.batch('box', '#355b63', x + dx, 1.55, z + side * (d / 2 + .15), 3.85, 2.5, .05, 0, false);
        this.batch('box', '#b5c9bb', x + dx, 1.55, z + side * (d / 2 + .19), .12, 2.5, .035, 0, false);
        this.batch('box', awning, x + dx, 3.25, z + side * (d / 2 + .7), 4.55, .15, 1.5, 0, true, 0, side * -.15);
        this.batch('box', awning, x + dx, 3.08, z + side * (d / 2 + 1.4), 4.55, .31, .12);
        for (let stripe = -1.7; stripe <= 1.7; stripe += .85) this.batch('box', '#f1e2bd', x + dx + stripe, 3.32, z + side * (d / 2 + .7), .25, .025, 1.45, 0, false, 0, side * -.15);
      }
      for (let dz = -d / 2 + 2.7; dz < d / 2 - 1.5; dz += 5.2) {
        this.batch('box', '#e7dfc8', x + side * (w / 2 + .04), 1.65, z + dz, .18, 2.9, 4.25);
        this.batch('box', '#355b63', x + side * (w / 2 + .15), 1.55, z + dz, .05, 2.5, 3.85, 0, false);
        this.batch('box', awning, x + side * (w / 2 + .7), 3.25, z + dz, 1.5, .15, 4.55, 0, true, side * .15);
        this.batch('box', awning, x + side * (w / 2 + 1.4), 3.08, z + dz, .12, .31, 4.55);
      }
    }
    if (b.label) {
      const label = this.makeSign(b.label.toUpperCase(), Math.min(w - 2, 9.5), 1.14, '#f5e9ce', '#31595b');
      label.position.set(x, 3.83, z + d / 2 + .22);
      this.scene.add(label);
      const sideLabel = this.makeSign(b.label.toUpperCase(), Math.min(d - 2, 9.5), 1.14, '#f5e9ce', '#31595b');
      sideLabel.rotation.y = -Math.PI / 2;
      sideLabel.position.set(x - w / 2 - .22, 3.83, z);
      this.scene.add(sideLabel);
    }
  }

  private buildProps() {
    this.world.obstacles.forEach((o, i) => {
      if (o.assetModel?.startsWith('tree-') || o.assetModel === 'rock-large') return;
      if (o.kind === 'tree') {
        const palm = i % 3 !== 0;
        const radius = Math.max(.13, Math.min(o.width, o.depth) / 2);
        if (palm) {
          const height = Math.max(5.1, o.height);
          this.batch('cylinder', '#a88a61', o.x, height / 2, o.z, radius, height, radius);
          for (let y = .7; y < height - .4; y += .62) this.batch('cylinder', '#bb9c73', o.x, y, o.z, radius * 1.06, .085, radius * 1.06);
          this.batch('sphere', '#628f5f', o.x, height - .05, o.z, .68, .56, .68);
          for (let f = 0; f < 7; f++) {
            const a = f / 7 * Math.PI * 2 + i * 1.1;
            // Two tapered leaf pieces retain a distinctive palm silhouette.
            this.batch('cone', f % 2 ? '#4d926c' : '#6aa16a', o.x + Math.sin(a) * 1.48, height + .1, o.z + Math.cos(a) * 1.48, .62, 3.6, .17, a, true, Math.PI / 2.65, Math.PI / 2);
            this.batch('sphere', '#55956b', o.x + Math.sin(a) * 1.4, height + .28, o.z + Math.cos(a) * 1.4, .58, .12, 1.9, a, true, 0, -.14);
          }
        } else {
          this.batch('cylinder', '#9b805d', o.x, o.height / 2, o.z, radius, o.height, radius);
          this.batch('sphere', '#729660', o.x, o.height - .6, o.z, 2.3, 2.2, 2.3);
          this.batch('sphere', '#88a86e', o.x - .7, o.height + .2, o.z - .3, 1.7, 1.7, 1.6);
        }
      } else if (o.kind === 'planter') {
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
        const plantedPart = (shape: Shape, color: string, dx: number, y: number, dz: number, sx: number, sy: number, sz: number, shadow = true) =>
          this.batch(shape, color, o.x + c * dx + s * dz, y, o.z - s * dx + c * dz, sx, sy, sz, o.yaw, shadow);
        const rim = Math.min(.14, Math.min(o.width, o.depth) * .12);
        const soilW = o.width - rim * 2, soilD = o.depth - rim * 2;
        plantedPart('box', o.color, 0, o.height / 2, 0, o.width, o.height, o.depth);
        plantedPart('box', '#5f7860', 0, o.height + .01, 0, soilW, .03, soilD);
        for (const side of [-1, 1]) {
          plantedPart('box', '#ddd8c5', side * (o.width - rim) / 2, o.height + .035, 0, rim, .1, o.depth);
          plantedPart('box', '#ddd8c5', 0, o.height + .035, side * (o.depth - rim) / 2, soilW, .1, rim);
        }
        // Repeated planting pockets fill both square tubs and long roadside beds.
        // Work in planter space so rotated foliage stays inside the same collider.
        const columns = Math.max(1, Math.ceil(soilW / .95)), rows = Math.max(1, Math.ceil(soilD / .95));
        const cellW = soilW / columns, cellD = soilD / rows;
        const bloom = Math.min(.14, cellW * .2, cellD * .2);
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
          const dx = (column - (columns - 1) / 2) * cellW, dz = (row - (rows - 1) / 2) * cellD;
          const lift = (i + row + column) % 3 * .025;
          plantedPart('sphere', '#86a968', dx, o.height + .13 + lift, dz, cellW * .44, .18, cellD * .44);
          for (let flower = 0; flower < 3; flower++) {
            const angle = flower * Math.PI * 2 / 3 + (row + column) * .55;
            plantedPart('sphere', (i + row + column + flower) % 3 ? '#bd7970' : '#e5bf78',
              dx + Math.cos(angle) * cellW * .22, o.height + .31 + lift + flower * .018,
              dz + Math.sin(angle) * cellD * .22, bloom, .09, bloom, false);
          }
        }
      } else if (o.kind === 'bench') {
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
        this.batch('box', o.color, o.x, .69, o.z, o.width, .16, o.depth, o.yaw);
        this.batch('box', o.color, o.x + c * o.width * .4, o.height - .33, o.z - s * o.width * .4, .12, .63, o.depth, o.yaw);
        for (const offset of [-o.depth * .36, o.depth * .36]) this.batch('box', '#4c625e', o.x + s * offset, .37, o.z + c * offset, o.width * .71, .62, .14, o.yaw);
      } else if (o.kind === 'bin') {
        this.batch('cylinder', o.color, o.x, o.height * .46, o.z, o.width * .46, o.height * .9, o.depth * .46);
        this.batch('cylinder', '#355b54', o.x, o.height - .08, o.z, o.width / 2, .08, o.depth / 2);
      } else if (o.kind === 'barrier') {
        this.batch('box', o.color, o.x, o.height / 2, o.z, o.width, o.height, o.depth, o.yaw);
        const face = o.depth / 2 + .012;
        this.batch('box', '#ede0af', o.x + Math.sin(o.yaw) * face, o.height * .7, o.z + Math.cos(o.yaw) * face, o.width * .7, o.height * .23, .03, o.yaw);
      }
    });
    // Non-solid poles occupy the curb, outside walking and vehicle lanes.
    const lampSpan = Math.floor((this.world.size / 2 - 8) / 32) * 32;
    for (const road of this.world.roads) {
      for (let p = -lampSpan; p <= lampSpan; p += 32) {
        if (this.world.roads.some(r => Math.abs(p - r) < 15)) continue;
        for (const side of [-1, 1]) {
          this.lamp(road + side * 9.7, p, -side * Math.PI / 2);
          this.lamp(p, road + side * 9.7, side > 0 ? Math.PI : 0);
        }
      }
    }
    const promenade = this.world.size / 2 - 4;
    for (let p = -lampSpan; p <= lampSpan; p += 32) for (const side of [-1, 1]) {
      this.lamp(side * promenade, p, -side * Math.PI / 2);
      this.lamp(p, side * promenade, side > 0 ? Math.PI : 0);
    }
    // Clearly marked delivery bay at the port depot.
    const { x, z } = this.world.destination;
    for (const side of [-1, 1]) {
      this.batch('box', '#f1d474', x + side * 3.1, .105, z, .16, .024, 10, 0, false);
      this.batch('box', '#f1d474', x, .105, z + side * 5, 6.35, .024, .16, 0, false);
    }
  }

  private lamp(x: number, z: number, yaw: number) {
    this.batch('cylinder', '#556f70', x, 3.25, z, .1, 6.4, .1);
    this.batch('cylinder', '#657e7a', x, .31, z, .22, .6, .22);
    this.batch('box', '#556f70', x + Math.sin(yaw) * .64, 6.37, z + Math.cos(yaw) * .64, .14, .14, 1.5, yaw);
    this.batch('box', '#566c6a', x + Math.sin(yaw) * 1.3, 6.29, z + Math.cos(yaw) * 1.3, .55, .14, .85, yaw);
    this.batch('box', '#fff1c2', x + Math.sin(yaw) * 1.3, 6.2, z + Math.cos(yaw) * 1.3, .42, .025, .68, yaw, false);
  }

  private buildHarbor() {
    const edge = this.world.size / 2;
    // Water glints are deterministically scattered, all outside the island.
    for (let i = 0; i < 165; i++) {
      const a = i * 2.39996;
      const r = edge + 14 + (i % 11) * 13;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < edge + 3 && Math.abs(z) < edge + 3) continue;
      this.batch('box', i % 3 === 0 ? '#8bcfd0' : '#6abfc0', x, -.96, z, 2 + i % 7, .015, .24, 0, false);
    }
    // Piers follow the waterfront length while retaining the original boat scale.
    const pierCount = Math.max(4, Math.floor((this.world.size - 60) / 48));
    for (let i = 0; i < pierCount; i++) {
      const z = (i - (pierCount - 1) / 2) * 48;
      this.batch('box', '#c2a884', edge + 10, -.12, z, 20, .45, 3.8);
      for (let j = 0; j < 12; j++) this.batch('box', '#9c886e', edge + 1 + j * 1.6, .12, z, .09, .025, 3.8, 0, false);
      this.batch('box', '#f1e9d4', edge + 15, -.14, z + 5.6, 2.8, 1, 7.1, .1);
      this.batch('box', '#45737d', edge + 15, .55, z + 5.4, 2.2, .58, 3.4, .1);
      this.batch('box', '#e1e4d7', edge + 15, .96, z + 5.2, 2.4, .14, 3.8, .1);
      this.batch('cylinder', '#ccc4ab', edge + 15, 3.4, z + 5.6, .055, 7, .055);
    }
    // Distant coast shapes create depth without enclosing the city in a wall.
    for (let i = 0; i < 12; i++) {
      this.batch('sphere', '#80b6ac', -360 + i * 62, -14, -edge - 238 - (i % 3) * 25, 75, 34 + i % 4 * 9, 38, 0, false);
    }
  }

  private buildAtmosphere() {
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) this.part(cloud, 'sphere', '#e5eeea', j * 6 - 9, j % 2 * 1.8, j % 2 * 2, 9, 3.2 + j % 2 * 2, 4.7, 0, false);
      const radius = this.world.size / 2 + 98;
      cloud.position.set(Math.sin(i * 2.8) * radius, 72 + i % 4 * 11, Math.cos(i * 2.8) * radius);
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
    const birdMaterial = new THREE.LineBasicMaterial({ color: '#526d70' });
    for (let i = 0; i < 9; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.7, 0, 0), new THREE.Vector3(0, -.16, 0), new THREE.Vector3(.7, 0, 0)]);
      const bird = new THREE.Line(geometry, birdMaterial);
      bird.position.set(30 + i * 2.8, 34 + i % 3 * 2, -25 + i % 4 * 3);
      this.gulls.add(bird);
    }
    this.scene.add(this.gulls);
  }

  private canvasTexture(text: string, background: string, foreground: string, width = 768, height = 112) {
    const key = `${text}/${background}/${foreground}/${width}/${height}`;
    const cached = this.textureCache.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 13);
    ctx.fill();
    ctx.strokeStyle = foreground;
    ctx.globalAlpha = .2;
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    ctx.globalAlpha = 1;
    ctx.fillStyle = foreground;
    ctx.font = '700 49px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 + 3, width - 44);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.push(texture);
    this.textureCache.set(key, texture);
    return texture;
  }

  private makeLabel(text: string, bg: string, fg: string, width: number, height: number) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.canvasTexture(text, bg, fg), transparent: true, depthWrite: false }));
    sprite.scale.set(width, height, 1);
    return sprite;
  }

  private makeSign(text: string, width: number, height: number, bg: string, fg: string) {
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: this.canvasTexture(text, bg, fg), roughness: .9 }));
  }

  private makeCar(v: Vehicle): CarNode {
    if (v.model !== 'sedan') return createVehicleModel(v, this.part.bind(this));
    const root = new THREE.Group();
    const widthScale = v.width / 2.1, depthScale = v.depth / 4.5;
    root.scale.set(widthScale, 1, depthScale);
    const paint = v.kind === 'police' ? '#eff0db' : v.color;
    this.part(root, 'box', '#283a41', 0, .53, 0, 1.83, .4, 4.03);
    this.part(root, 'box', paint, 0, .88, 0, 2.04, .64, 4.28);
    this.part(root, 'box', paint, 0, 1.16, 1.37, 1.96, .26, 1.32);
    this.part(root, 'box', paint, 0, 1.16, -1.55, 1.93, .25, .96);
    // Dark cabin, angled windshields, and colored roof make direction readable.
    this.part(root, 'box', '#355463', 0, 1.44, -.18, 1.72, .81, 2.25);
    this.part(root, 'box', paint, 0, 1.89, -.27, 1.76, .17, 1.69);
    const frontGlass = this.part(root, 'box', '#6d9ca7', 0, 1.52, 1, 1.67, .68, .08, 0, false);
    frontGlass.rotation.x = -.4;
    const rearGlass = this.part(root, 'box', '#507b89', 0, 1.5, -1.32, 1.63, .62, .08, 0, false);
    rearGlass.rotation.x = .36;
    for (const side of [-1, 1]) {
      this.part(root, 'box', paint, side * .88, 1.49, -.3, .08, .75, .13);
      this.part(root, 'box', paint, side * .91, 1.15, -.19, .1, .08, 2.32);
      this.part(root, 'box', '#d0d8ce', side * 1.028, 1.08, -.64, .035, .06, .28, 0, false);
      this.part(root, 'box', paint, side * 1.11, 1.3, .75, .26, .21, .32);
      this.part(root, 'box', '#ffffd9', side * .66, 1.03, 2.153, .48, .25, .035, 0, false);
      this.part(root, 'box', '#db7162', side * .72, 1.02, -2.153, .39, .25, .035, 0, false);
      if (v.kind === 'police') this.part(root, 'box', '#314751', side * 1.029, .96, -.1, .025, .32, 2.7, 0, false);
    }
    this.part(root, 'box', '#b7c1bd', 0, .66, 2.16, 1.86, .17, .12);
    this.part(root, 'box', '#b7c1bd', 0, .66, -2.16, 1.84, .17, .12);
    this.part(root, 'box', '#354b52', 0, .93, 2.176, .65, .2, .025, 0, false);
    this.part(root, 'box', '#f0e7ce', 0, .88, -2.176, .52, .15, .025, 0, false);
    const wheels: THREE.Group[] = [], frontWheels: THREE.Group[] = [];
    for (const x of [-.99, .99]) for (const z of [-1.43, 1.4]) {
      const steer = new THREE.Group();
      steer.position.set(x, .47, z);
      const wheel = new THREE.Group();
      const tire = this.part(wheel, 'cylinder', '#25343b', 0, 0, 0, .46, .26, .46);
      tire.rotation.z = Math.PI / 2;
      const hub = this.part(wheel, 'cylinder', '#c7cdca', Math.sign(x) * .15, 0, 0, .23, .028, .23, 0, false);
      hub.rotation.z = Math.PI / 2;
      const stripe = this.part(wheel, 'box', '#62787b', Math.sign(x) * .167, 0, 0, .03, .32, .06, 0, false);
      stripe.rotation.x = Math.PI / 4;
      steer.add(wheel);
      root.add(steer);
      wheels.push(wheel);
      if (z > 0) frontWheels.push(steer);
    }
    let leftLight: THREE.Mesh | undefined, rightLight: THREE.Mesh | undefined;
    if (v.kind === 'police') {
      this.part(root, 'box', '#334850', 0, 2.04, -.25, 1.25, .1, .37);
      leftLight = this.part(root, 'box', '#f47d72', -.39, 2.17, -.25, .48, .21, .32, 0, false);
      rightLight = this.part(root, 'box', '#67a9e9', .39, 2.17, -.25, .48, .21, .32, 0, false);
    }
    if (v.kind === 'mission') {
      this.part(root, 'box', '#f0dfb4', 0, 1.16, -1.45, 1.45, .028, .35, 0, false);
      this.part(root, 'box', '#f0dfb4', 0, 1.91, -.26, .35, .028, 1.65, 0, false);
    }
    return { root, wheels, frontWheels, wheelRadius: .46, leftLight, rightLight };
  }

  private makePerson(color: string, isPlayer = false, isOfficer = false): PersonNode {
    const root = new THREE.Group(), body = new THREE.Group();
    const skin = isPlayer ? '#c99773' : ['#bd896c', '#d9af86', '#936b56'][color.length % 3];
    root.add(body);
    this.part(body, 'box', color, 0, 1.25, 0, .61, .72, .37);
    this.part(body, 'sphere', skin, 0, 1.97, 0, .235, .28, .22);
    this.part(body, 'box', isOfficer ? '#2d4054' : isPlayer ? '#374447' : '#594c42', 0, 2.14, -.025, .42, .14, .39);
    this.part(body, 'box', skin, 0, 1.73, 0, .18, .17, .18);
    this.part(body, 'box', skin, 0, 1.97, .211, .14, .13, .08, 0, false);
    if (isPlayer) {
      this.part(body, 'box', '#328e89', 0, 1.29, -.265, .42, .53, .22);
      this.part(body, 'box', '#e2bb6e', 0, 1.27, -.389, .3, .04, .015, 0, false);
      for (const side of [-1, 1]) this.part(body, 'box', '#388781', side * .19, 1.34, .197, .065, .55, .04, 0, false);
    }
    if (isOfficer) {
      this.part(body, 'box', '#2d4054', 0, 2.22, -.015, .51, .15, .48);
      this.part(body, 'box', '#26394c', 0, 2.145, .272, .4, .05, .24);
      this.part(body, 'box', '#dfc77e', 0, 2.225, .239, .075, .085, .035, 0, false);
      this.part(body, 'box', '#dfc77e', -.18, 1.43, .203, .09, .13, .035, 0, false);
      this.part(body, 'box', '#26343c', 0, .94, 0, .64, .1, .4);
    }
    const limbs: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * .4, 1.54, 0);
      this.part(arm, 'box', color, 0, -.2, 0, .19, .43, .23);
      this.part(arm, 'box', skin, 0, -.48, 0, .15, .24, .17);
      body.add(arm);
      limbs.push(arm);
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * .165, .91, 0);
      this.part(leg, 'box', isOfficer ? '#283b50' : isPlayer ? '#354f62' : '#4c6267', 0, -.38, 0, .24, .76, .28);
      this.part(leg, 'box', isPlayer ? '#f6ead6' : '#3e494a', 0, -.77, .07, .28, .17, .43);
      body.add(leg);
      limbs.push(leg);
    }
    // Anatomical right is local -X when a person faces +Z.
    return { root, body, leftArm: limbs[1], rightArm: limbs[0], leftLeg: limbs[3], rightLeg: limbs[2], skin, shirt: color };
  }

  private equipPerson(node: PersonNode, weapons: WeaponId[]) {
    node.weapons = {};
    for (const id of weapons) {
      const weapon = createWeaponModel(id, this.part.bind(this));
      if (weapon.flash) weapon.flash.material = this.material('#ffdc6b', .3, '#ffcf56', 3);
      weapon.root.visible = false;
      node.weapons[id] = weapon;
      node.body.add(weapon.root);
    }
    const root = new THREE.Group();
    root.visible = false;
    const sleeve = () => this.part(root, 'box', node.shirt, 0, 0, 0, .19, 1, .23);
    const forearm = () => this.part(root, 'box', node.skin, 0, 0, 0, .145, 1, .17);
    const hand = () => this.part(root, 'box', node.skin, 0, 0, 0, .14, .15, .15);
    node.armedArms = {
      root, rightSleeve: sleeve(), rightForearm: forearm(), leftSleeve: sleeve(), leftForearm: forearm(),
      rightHand: hand(), leftHand: hand(), rightGoal: new THREE.Vector3(), leftGoal: new THREE.Vector3(),
    };
    node.body.add(root);
  }

  private armSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3) {
    this.limbDirection.copy(end).sub(start);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.scale.y = this.limbDirection.length();
    mesh.quaternion.setFromUnitVectors(this.limbUp, this.limbDirection.normalize());
  }

  private poseWeapon(node: PersonNode, id: WeaponId, attackAge: number, pitch: number, reloadProgress: number | null, flashing: boolean) {
    if (!node.weapons || !node.armedArms) return;
    const weapon = node.weapons[id];
    if (!weapon) return;
    for (const [key, model] of Object.entries(node.weapons)) {
      model.root.visible = key === id;
      if (model.flash) model.flash.visible = key === id && flashing;
      if (model.magazine) model.magazine.position.y = model.magazineY;
    }
    const arms = node.armedArms;
    node.leftArm.visible = node.rightArm.visible = id === 'knife';
    arms.root.visible = id !== 'knife';
    if (id === 'knife') {
      if (attackAge >= 0 && attackAge < .32) {
        const swing = Math.sin(attackAge / .32 * Math.PI);
        node.rightArm.rotation.set(-.3 - swing * 1.65, 0, .15 + swing * .62);
      }
      node.rightArm.updateMatrix();
      weapon.root.position.set(0, -.58, 0).applyMatrix4(node.rightArm.matrix);
      weapon.root.quaternion.copy(node.rightArm.quaternion).multiply(this.knifeRotation);
      weapon.root.scale.setScalar(1);
      return;
    }
    const recoil = attackAge >= 0 && attackAge < .16 ? Math.exp(-attackAge * 34) * .075 : 0;
    weapon.root.scale.setScalar(id === 'rifle' ? .8 : 1);
    weapon.root.position.set(-.36, id === 'rifle' ? 1.51 : 1.487, (id === 'rifle' ? .2 : .3) - recoil);
    weapon.root.rotation.set(THREE.MathUtils.clamp(pitch, -.9, 1.2) - recoil * 1.7, 0, 0);
    if (reloadProgress !== null) {
      weapon.root.position.set(-.14, 1.17, .32);
      weapon.root.rotation.set(.5, .08, -.2);
      if (weapon.magazine) weapon.magazine.position.y -= Math.sin(reloadProgress * Math.PI) * .2;
    }
    weapon.root.updateMatrix();
    arms.rightGoal.copy(weapon.root.position);
    arms.leftGoal.set(id === 'rifle' ? .015 : .05, reloadProgress !== null ? -.18 : -.025, id === 'rifle' ? reloadProgress !== null ? .17 : .4 : -.018).applyMatrix4(weapon.root.matrix);
    this.armSegment(arms.rightSleeve, this.rightShoulder, this.rightElbow);
    this.armSegment(arms.rightForearm, this.rightElbow, arms.rightGoal);
    this.armSegment(arms.leftSleeve, this.leftShoulder, this.leftElbow);
    this.armSegment(arms.leftForearm, this.leftElbow, arms.leftGoal);
    arms.rightHand.position.copy(arms.rightGoal);
    arms.leftHand.position.copy(arms.leftGoal);
    arms.rightHand.quaternion.copy(weapon.root.quaternion);
    arms.leftHand.quaternion.copy(weapon.root.quaternion);
  }

  private animatePerson(node: PersonNode, x: number, z: number, yaw: number, phase: number, moving: boolean, fleeing = false) {
    node.root.visible = true;
    node.root.position.set(x, .11, z);
    node.root.rotation.y = yaw;
    const stride = moving ? Math.sin(phase) * (fleeing ? .86 : .58) : 0;
    node.leftLeg.rotation.set(stride, 0, 0);
    node.rightLeg.rotation.set(-stride, 0, 0);
    node.leftArm.rotation.set(-stride * .85, 0, 0);
    node.rightArm.rotation.set(stride * .85, 0, 0);
    node.body.position.set(0, moving ? Math.abs(Math.sin(phase)) * .055 : Math.sin(phase * .2) * .012, 0);
    node.body.rotation.set(fleeing ? .15 : 0, 0, 0);
  }

  private animateSwimming(node: PersonNode, x: number, z: number, yaw: number, phase: number, moving: boolean) {
    node.root.visible = true;
    node.root.position.set(x, -1.93 + Math.sin(phase * .45) * .045, z);
    node.root.rotation.y = yaw;
    const stroke = moving ? Math.sin(phase) : 0;
    node.body.position.set(0, 0, 0);
    node.body.rotation.set(-.22, 0, 0);
    node.leftArm.visible = node.rightArm.visible = true;
    node.leftArm.rotation.set(stroke * 1.15 - .35, 0, -.22);
    node.rightArm.rotation.set(-stroke * 1.15 - .35, 0, .22);
    node.leftLeg.rotation.set(-stroke * .38, 0, 0);
    node.rightLeg.rotation.set(stroke * .38, 0, 0);
    if (node.armedArms) node.armedArms.root.visible = false;
    if (node.weapons) for (const weapon of Object.values(node.weapons)) weapon.root.visible = false;
  }

  private animateDead(node: PersonNode, x: number, z: number, yaw: number, age: number) {
    const fall = THREE.MathUtils.smoothstep(age, 0, .28);
    node.root.visible = true;
    node.root.position.set(x, .11, z);
    node.root.rotation.y = yaw;
    node.body.position.set(0, .29 * fall, 0);
    node.body.rotation.set(Math.PI / 2 * fall, 0, 0);
    node.leftArm.visible = node.rightArm.visible = true;
    node.leftArm.rotation.set(0, 0, -.28);
    node.rightArm.rotation.set(0, 0, .2);
    node.leftLeg.rotation.set(0, 0, .09);
    node.rightLeg.rotation.set(0, 0, -.05);
    if (node.armedArms) node.armedArms.root.visible = false;
    if (node.weapons) for (const weapon of Object.values(node.weapons)) weapon.root.visible = false;
  }

  private updateShots(state: GameState) {
    let count = 0, impacts = 0;
    for (const flash of this.impactFlashes) flash.visible = false;
    for (const shot of state.combat.shots) {
      const age = state.time - shot.time;
      if (shot.weapon === 'knife' || age < 0 || age > .12 || count >= 64) continue;
      const index = count * 6;
      this.tracePositions.set([shot.from.x, shot.from.y, shot.from.z, shot.to.x, shot.to.y, shot.to.z], index);
      const color = shot.owner === 'police' ? [1, .42, .2] : [1, .86, .46];
      this.traceColors.set([...color, ...color], index);
      count++;
      if (shot.hit && age < .09 && impacts < this.impactFlashes.length) {
        const flash = this.impactFlashes[impacts++];
        flash.visible = true;
        flash.position.set(shot.to.x, shot.to.y, shot.to.z);
        flash.scale.setScalar(.045 + (.09 - age) * .6);
      }
    }
    this.traces.geometry.setDrawRange(0, count * 2);
    this.traces.geometry.getAttribute('position').needsUpdate = true;
    this.traces.geometry.getAttribute('color').needsUpdate = true;
  }

  update(state: GameState, dt: number) {
    if (this.disposed) return;
    this.updateCamera(state, dt);
    const ids = new Set<string>();
    const cullDistanceSq = this.dynamicCullDistance * this.dynamicCullDistance;
    for (const vehicle of state.vehicles) {
      ids.add(vehicle.id);
      const dx = vehicle.x - state.player.x, dz = vehicle.z - state.player.z;
      const important = vehicle.id === state.player.vehicleId || vehicle.kind === 'mission' || (vehicle.kind === 'police' && state.police.wanted > 0);
      const visible = vehicle.active && (important || dx * dx + dz * dz <= cullDistanceSq);
      let node = this.cars.get(vehicle.id);
      if (!visible) { if (node) node.root.visible = false; continue; }
      if (!node) {
        node = this.makeCar(vehicle);
        this.cars.set(vehicle.id, node);
        this.scene.add(node.root);
      }
      node.root.visible = true;
      updateVehicleDamage(node, vehicle, state.time);
      node.root.position.set(vehicle.x, .12, vehicle.z);
      node.root.rotation.y = vehicle.yaw;
      node.wheels.forEach(w => { w.rotation.x += vehicle.speed * dt / node.wheelRadius; });
      node.frontWheels.forEach(w => { w.rotation.y = vehicle.steer * .36; });
      if (node.leftLight && node.rightLight) {
        const flash = Math.floor(state.time * 9) % 2;
        node.leftLight.scale.y = state.police.wanted > 0 && flash ? .33 : .17;
        node.rightLight.scale.y = state.police.wanted > 0 && !flash ? .33 : .17;
        node.leftLight.material = this.material('#f47d72', .6, '#ff4c42', state.police.wanted > 0 && flash ? 3 : .12);
        node.rightLight.material = this.material('#67a9e9', .6, '#438dff', state.police.wanted > 0 && !flash ? 3 : .12);
      }
    }
    for (const [id, node] of this.cars) if (!ids.has(id)) { disposeVehicleDamage(node); this.scene.remove(node.root); this.cars.delete(id); }
    const personIds = new Set<string>();
    this.crowd.update(state.pedestrians, state.player, state.time);
    for (const p of state.pedestrians) {
      personIds.add(p.id);
      let node = this.people.get(p.id);
      if (!usesDetailedPerson(p, state.player)) { if (node) node.root.visible = false; continue; }
      if (!node) { node = this.makePerson(p.color); this.people.set(p.id, node); this.scene.add(node.root); }
      if (p.state === 'dead') this.animateDead(node, p.x, p.z, p.yaw, state.time - (p.deadAt ?? state.time));
      else this.animatePerson(node, p.x, p.z, p.yaw, p.phase, p.state !== 'waiting', p.state === 'fleeing');
    }
    for (const [id, node] of this.people) if (!personIds.has(id)) { this.scene.remove(node.root); this.people.delete(id); }
    const officerIds = new Set<string>();
    for (const officer of state.officers) {
      officerIds.add(officer.id);
      const dx = officer.x - state.player.x, dz = officer.z - state.player.z;
      let node = this.officers.get(officer.id);
      if (dx * dx + dz * dz > cullDistanceSq) { if (node) node.root.visible = false; continue; }
      if (!node) {
        node = this.makePerson('#2f4b63', false, true);
        this.equipPerson(node, ['pistol']);
        this.officers.set(officer.id, node);
        this.scene.add(node.root);
      }
      if (officer.state === 'dead') this.animateDead(node, officer.x, officer.z, officer.yaw, state.time - (officer.deadAt ?? state.time));
      else {
        this.animatePerson(node, officer.x, officer.z, officer.yaw, officer.phase, officer.state === 'returning' || officer.state === 'engaging');
        const flashing = state.combat.shots.some(shot => shot.owner === 'police' && state.time - shot.time < .075 && Math.hypot(shot.from.x - officer.x, shot.from.z - officer.z) < 1.6);
        this.poseWeapon(node, 'pistol', flashing ? .025 : 10, 0, null, flashing);
        node.root.visible = officer.state !== 'riding';
      }
    }
    for (const [id, node] of this.officers) if (!officerIds.has(id)) { this.scene.remove(node.root); this.officers.delete(id); }
    const combat = state.combat;
    const attackAge = state.time - combat.lastAttackAt;
    if (combat.dead) this.animateDead(this.player, state.player.x, state.player.z, state.player.yaw, Math.max(0, 4 - combat.respawnIn));
    else {
      const yaw = !state.player.vehicleId && (combat.weapon !== 'knife' || attackAge < .32) ? combat.aimYaw : state.player.yaw;
      if (state.player.swimming) this.animateSwimming(this.player, state.player.x, state.player.z, yaw, state.time * 7.2, state.player.moving);
      else this.animatePerson(this.player, state.player.x, state.player.z, yaw, state.time * 10.5, state.player.moving);
      const flashing = combat.shots.some(shot => shot.owner === 'player' && shot.weapon === combat.weapon && state.time - shot.time < .075);
      const reloadProgress = combat.reload ? 1 - combat.reload.remaining / combat.reload.duration : null;
      this.poseWeapon(this.player, combat.weapon, attackAge, this.cameraRig.getPitch(), reloadProgress, flashing);
    }
    this.player.root.visible = !state.player.vehicleId;
    this.updateMarker(state);
    this.updateShots(state);
    this.waterWorld.update(state.time);
    if (!this.mobile) {
      this.clouds.rotation.y = state.time * .00035;
      this.gulls.position.set(Math.sin(state.time * .028) * 50, Math.sin(state.time * .2) * 1.5, Math.cos(state.time * .025) * 35);
      this.gulls.rotation.y = state.time * .035;
      this.gulls.children.forEach((bird, i) => { bird.rotation.z = Math.sin(state.time * 2.6 + i) * .12; });
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateMarker(state: GameState) {
    const phase = state.mission.phase;
    const missionCar = state.vehicles.find(v => v.kind === 'mission');
    const target = phase === 'deliver' ? this.world.destination : phase === 'collect' && missionCar ? missionCar : this.world.pickup;
    this.marker.visible = phase !== 'success' && phase !== 'failed';
    this.marker.position.set(target.x, 0, target.z);
    const large = phase === 'deliver' ? 1.4 : 1;
    this.markerRing.scale.setScalar(large * (1 + Math.sin(state.time * 2.6) * .035));
    this.markerDiamond.position.y = 3.3 + Math.sin(state.time * 2.7) * .21;
    this.markerDiamond.rotation.y = state.time * .65;
    this.markerDiamond.rotation.z = Math.sin(state.time * 1.4) * .07;
    if (phase !== this.labelPhase) {
      this.labelPhase = phase;
      const label = phase === 'deliver' ? 'DELIVERY POINT' : phase === 'collect' ? 'YOUR RIDE' : 'COURIER JOB';
      const material = this.markerText.material;
      material.map = this.canvasTexture(label, '#203944', '#ffdc6b');
      material.needsUpdate = true;
    }
    (this.restrictedRing.material as THREE.MeshBasicMaterial).opacity = state.police.wanted ? .46 + Math.sin(state.time * 3) * .18 : .38;
  }

  private updateCamera(state: GameState, dt: number) {
    const car = state.player.vehicleId ? state.vehicles.find(v => v.id === state.player.vehicleId) : undefined;
    const target = car || state.player;
    this.cameraRig.setCombat(!car && !state.combat.dead && state.combat.weapon !== 'knife', state.combat.aiming);
    this.cameraRig.update(target, !!car, car?.speed ?? 0, dt);
    this.sun.position.set(target.x - 70, 120, target.z + 65);
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.target.updateMatrixWorld();
  }

  cycleCamera() { return this.cameraRig.cycleCamera(); }

  look(deltaX: number, deltaY: number) { this.cameraRig.look(deltaX, deltaY); }

  getMovementYaw() { return this.cameraRig.getMovementYaw(); }

  /** Apply equip/RMB and pending mouse input before sampling the center-screen ray. */
  prepareAim(state: GameState, input?: Pick<InputFrame, 'weapon' | 'aiming'>) {
    const car = state.player.vehicleId ? state.vehicles.find(v => v.id === state.player.vehicleId) : undefined;
    this.cameraRig.setCombat(!car && !state.combat.dead && (input?.weapon ?? state.combat.weapon) !== 'knife', input?.aiming ?? state.combat.aiming);
    this.cameraRig.update(car || state.player, !!car, car?.speed ?? 0, 0);
  }

  getAimRay(): AimRay {
    this.camera.getWorldDirection(this.aimDirection);
    return {
      origin: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      direction: { x: this.aimDirection.x, y: this.aimDirection.y, z: this.aimDirection.z },
    };
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    for (const node of this.cars.values()) disposeVehicleDamage(node);
    if (this.disposed) return;
    this.disposed = true;
    this.environmentModels.dispose();
    this.crowd.dispose();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(o => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
      } else if (o instanceof THREE.Sprite) materials.add(o.material);
    });
    Object.values(this.geometries).forEach(g => geometries.add(g));
    this.materials.forEach(m => materials.add(m));
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.textures.forEach(t => t.dispose());
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
