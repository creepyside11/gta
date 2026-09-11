import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VehicleModel } from '../game/types';

type RealVehicleModel = 'bmw-m5-f90' | 'mercedes-g63' | 'nissan-gtr-r35';
type ProceduralFallback = 'sport' | 'pickup';

type RealVehicleAsset = {
  url: string;
  width: number;
  depth: number;
  yaw: number;
  fallback: ProceduralFallback;
};

const REAL_VEHICLE_ASSETS: Record<RealVehicleModel, RealVehicleAsset> = {
  'bmw-m5-f90': {
    url: '/models/bmw-m5-f90.glb',
    width: 1.902,
    depth: 4.965,
    yaw: Math.PI,
    fallback: 'sport',
  },
  'mercedes-g63': {
    url: '/models/mercedes-g63.glb',
    width: 1.984,
    depth: 4.873,
    yaw: Math.PI,
    fallback: 'pickup',
  },
  'nissan-gtr-r35': {
    url: '/models/nissan-gtr-r35.glb',
    width: 1.895,
    depth: 4.710,
    yaw: Math.PI,
    fallback: 'sport',
  },
};

const loader = new GLTFLoader();
const cache = new Map<RealVehicleModel, Promise<THREE.Group>>();

export function isRealVehicleModel(model: VehicleModel): model is RealVehicleModel {
  return model in REAL_VEHICLE_ASSETS;
}

export function realVehicleFallback(model: RealVehicleModel): ProceduralFallback {
  return REAL_VEHICLE_ASSETS[model].fallback;
}

function normalizeModel(scene: THREE.Group, asset: RealVehicleAsset): THREE.Group {
  const model = scene.clone(true);
  model.rotation.y = asset.yaw;
  model.updateMatrixWorld(true);

  let bounds = new THREE.Box3().setFromObject(model);
  let size = bounds.getSize(new THREE.Vector3());

  // Some source files are authored with the car length on X. Keep game space
  // consistent: width on X, forward/back on Z.
  if (size.x > size.z) {
    model.rotation.y += Math.PI / 2;
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    size = bounds.getSize(new THREE.Vector3());
  }

  if (size.x > 1e-4 && size.z > 1e-4) {
    const scale = Math.min(asset.width / size.x, asset.depth / size.z);
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
  }

  bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= bounds.min.y;
  model.updateMatrixWorld(true);

  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
  });
  return model;
}

function loadAsset(model: RealVehicleModel): Promise<THREE.Group> {
  let pending = cache.get(model);
  if (!pending) {
    const asset = REAL_VEHICLE_ASSETS[model];
    pending = loader.loadAsync(asset.url).then(gltf => normalizeModel(gltf.scene, asset));
    cache.set(model, pending);
  }
  return pending;
}

/**
 * Replace the temporary procedural car after its local GLB becomes available.
 * Missing assets intentionally keep the fallback visible, so development and
 * tests continue to work before the licensed model files are installed.
 */
export function attachRealVehicleAsset(
  root: THREE.Group,
  fallbackRoot: THREE.Group,
  model: RealVehicleModel,
): void {
  void loadAsset(model).then(realModel => {
    if (!root.parent && !fallbackRoot.parent) return;
    realModel.name = `${model}-visual`;
    root.add(realModel);
    fallbackRoot.visible = false;
  }).catch(error => {
    // A 404 is expected until the user-authorized Sketchfab downloads are put
    // into public/models. Keep the procedural fallback rather than breaking play.
    console.info(`[Portside] ${model} GLB not installed; using fallback.`, error);
  });
}
