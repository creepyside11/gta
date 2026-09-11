import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Building, EnvironmentAssetId, Solid, World } from '../game/types';

const URLS: Record<EnvironmentAssetId, string> = {
  'house-a': '/models/environment/house-a.glb',
  'house-b': '/models/environment/house-b.glb',
  'house-h': '/models/environment/house-h.glb',
  'house-i': '/models/environment/house-i.glb',
  'tree-oak': '/models/environment/tree-oak.glb',
  'tree-palm': '/models/environment/tree-palm.glb',
  'tree-pine': '/models/environment/tree-pine.glb',
  'rock-large': '/models/environment/rock-large.glb',
};

type Prototype = {
  scene: THREE.Group;
  box: THREE.Box3;
  size: THREE.Vector3;
};

/**
 * Loads a deliberately small CC0 model set and reuses geometry/materials across clones.
 * Simulation still owns the colliders; these models are presentation only.
 */
export class EnvironmentModels {
  readonly root = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<EnvironmentAssetId, Promise<Prototype>>();
  private readonly mobile: boolean;
  private disposed = false;

  constructor(scene: THREE.Scene, world: World, mobile: boolean) {
    this.mobile = mobile;
    this.root.name = 'environment-models';
    scene.add(this.root);
    for (const building of world.buildings) if (building.assetModel?.startsWith('house-')) void this.addBuilding(building);
    for (const prop of world.obstacles) {
      if (prop.assetModel?.startsWith('tree-')) void this.addTree(prop);
      else if (prop.assetModel === 'rock-large') void this.addRock(prop);
    }
  }

  private load(id: EnvironmentAssetId): Promise<Prototype> {
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.loader.loadAsync(URLS[id]).then(gltf => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = !this.mobile;
          object.receiveShadow = true;
          object.frustumCulled = true;
          if (Array.isArray(object.material)) object.material.forEach(material => this.tuneMaterial(material));
          else this.tuneMaterial(object.material);
        });
        return { scene, box, size };
      });
      this.cache.set(id, pending);
    }
    return pending;
  }

  private tuneMaterial(material: THREE.Material) {
    const standard = material as THREE.MeshStandardMaterial;
    if ('roughness' in standard) standard.roughness = Math.max(.55, standard.roughness ?? .75);
    if ('metalness' in standard) standard.metalness = Math.min(.12, standard.metalness ?? 0);
  }

  private makeClone(proto: Prototype) {
    const clone = proto.scene.clone(true);
    clone.updateMatrixWorld(true);
    return clone;
  }

  private async addBuilding(building: Building) {
    const id = building.assetModel as EnvironmentAssetId;
    try {
      const proto = await this.load(id);
      if (this.disposed) return;
      const clone = this.makeClone(proto);
      const sx = building.width * .92 / Math.max(.01, proto.size.x);
      const sy = building.height * .98 / Math.max(.01, proto.size.y);
      const sz = building.depth * .92 / Math.max(.01, proto.size.z);
      clone.scale.set(sx, sy, sz);
      clone.rotation.y = building.yaw;
      // Put the original model's lowest point directly on the pavement.
      clone.position.set(building.x, .14 - proto.box.min.y * sy, building.z);
      clone.name = `asset-${building.id}`;
      this.root.add(clone);
    } catch (error) {
      console.warn(`Environment model ${id} failed to load`, error);
      this.addBuildingFallback(building);
    }
  }

  private addBuildingFallback(building: Building) {
    if (this.disposed) return;
    const group = new THREE.Group();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(building.width * .92, building.height, building.depth * .92),
      new THREE.MeshStandardMaterial({ color: building.color, roughness: .86 }),
    );
    wall.position.y = building.height / 2 + .12;
    wall.receiveShadow = true;
    group.add(wall);
    group.position.set(building.x, 0, building.z);
    this.root.add(group);
  }

  private async addTree(prop: Solid) {
    const id = prop.assetModel as EnvironmentAssetId;
    try {
      const proto = await this.load(id);
      if (this.disposed) return;
      const clone = this.makeClone(proto);
      const scale = prop.height / Math.max(.01, proto.size.y);
      clone.scale.setScalar(scale);
      clone.rotation.y = this.hashYaw(prop.id);
      clone.position.set(prop.x, .13 - proto.box.min.y * scale, prop.z);
      clone.name = `asset-${prop.id}`;
      this.root.add(clone);
    } catch (error) {
      console.warn(`Environment model ${id} failed to load`, error);
    }
  }

  private async addRock(prop: Solid) {
    try {
      const proto = await this.load('rock-large');
      if (this.disposed) return;
      const clone = this.makeClone(proto);
      const sx = Math.max(1.1, prop.width) / Math.max(.01, proto.size.x);
      const sy = Math.max(.7, prop.height) / Math.max(.01, proto.size.y);
      const sz = Math.max(1.1, prop.depth) / Math.max(.01, proto.size.z);
      clone.scale.set(sx, sy, sz);
      clone.rotation.y = this.hashYaw(prop.id);
      clone.position.set(prop.x, .12 - proto.box.min.y * sy, prop.z);
      this.root.add(clone);
    } catch (error) {
      console.warn('Environment rock failed to load', error);
    }
  }

  private hashYaw(id: string) {
    let value = 0;
    for (let i = 0; i < id.length; i++) value = (value * 31 + id.charCodeAt(i)) | 0;
    return ((value >>> 0) % 6283) / 1000;
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
  }
}
