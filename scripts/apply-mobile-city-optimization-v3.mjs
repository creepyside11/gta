import { readFileSync, writeFileSync } from 'node:fs';

function patchFile(path, replacements) {
  let source = readFileSync(path, 'utf8');
  for (const { from, to, label } of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) throw new Error(`Patch target not found (${label}) in ${path}`);
    source = source.replace(from, to);
  }
  writeFileSync(path, source);
}

const renderer = 'GTA/Проект/src/render/GameRenderer.ts';
patchFile(renderer, [
  {
    label: 'mobile and ambient fields',
    from: "  private labelPhase = '';\n  private disposed = false;",
    to: "  private labelPhase = '';\n  private disposed = false;\n  private readonly mobile: boolean;\n  private readonly dynamicCullDistance: number;\n  private readonly ambientCars: THREE.InstancedMesh;\n  private readonly ambientPeople: THREE.InstancedMesh;\n  private readonly ambientMatrix = new THREE.Matrix4();\n  private readonly ambientPosition = new THREE.Vector3();\n  private readonly ambientQuaternion = new THREE.Quaternion();\n  private readonly ambientScale = new THREE.Vector3();\n  private readonly ambientUp = new THREE.Vector3(0, 1, 0);",
  },
  {
    label: 'mobile renderer setup',
    from: "    this.host = host;\n    this.world = world;\n    this.cameraRig = new CameraRig(this.camera, world.buildings);\n    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });\n    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));\n    this.renderer.shadowMap.enabled = true;\n    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;",
    to: "    this.host = host;\n    this.world = world;\n    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;\n    this.mobile = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || coarsePointer;\n    this.dynamicCullDistance = this.mobile ? 145 : 280;\n    this.camera.far = this.mobile ? 360 : 740;\n    this.cameraRig = new CameraRig(this.camera, world.buildings);\n    this.renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, alpha: false, powerPreference: 'high-performance' });\n    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.75));\n    this.renderer.shadowMap.enabled = !this.mobile;\n    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;",
  },
  {
    label: 'mobile fog',
    from: "    this.scene.fog = new THREE.Fog('#addbdc', 115, 340);",
    to: "    this.scene.fog = new THREE.Fog('#addbdc', this.mobile ? 90 : 115, this.mobile ? 260 : 340);",
  },
  {
    label: 'mobile shadows',
    from: "    this.sun.castShadow = true;\n    this.sun.shadow.mapSize.set(2048, 2048);",
    to: "    this.sun.castShadow = !this.mobile;\n    this.sun.shadow.mapSize.set(this.mobile ? 512 : 2048, this.mobile ? 512 : 2048);",
  },
  {
    label: 'ambient city setup',
    from: "    this.buildAtmosphere();\n\n    const ringMaterial",
    to: "    this.buildAtmosphere();\n    if (this.mobile) { this.clouds.visible = false; this.gulls.visible = false; }\n    this.ambientCars = new THREE.InstancedMesh(this.geometries.box, this.material('#81949b', .92), this.mobile ? 16 : 28);\n    this.ambientCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n    this.ambientCars.castShadow = false;\n    this.ambientCars.receiveShadow = false;\n    this.ambientCars.frustumCulled = false;\n    this.scene.add(this.ambientCars);\n    this.ambientPeople = new THREE.InstancedMesh(this.geometries.box, this.material('#758b82', .95), this.mobile ? 24 : 40);\n    this.ambientPeople.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n    this.ambientPeople.castShadow = false;\n    this.ambientPeople.receiveShadow = false;\n    this.ambientPeople.frustumCulled = false;\n    this.scene.add(this.ambientPeople);\n\n    const ringMaterial",
  },
  {
    label: 'vehicle distance culling',
    from: "    for (const vehicle of state.vehicles) {\n      ids.add(vehicle.id);\n      let node = this.cars.get(vehicle.id);\n      if (!node) {\n        node = this.makeCar(vehicle);\n        this.cars.set(vehicle.id, node);\n        this.scene.add(node.root);\n      }\n      node.root.visible = vehicle.active;\n      node.root.position.set(vehicle.x, .12, vehicle.z);",
    to: "    const cullDistanceSq = this.dynamicCullDistance * this.dynamicCullDistance;\n    for (const vehicle of state.vehicles) {\n      ids.add(vehicle.id);\n      const dx = vehicle.x - state.player.x, dz = vehicle.z - state.player.z;\n      const important = vehicle.id === state.player.vehicleId || vehicle.kind === 'mission' || (vehicle.kind === 'police' && state.police.wanted > 0);\n      const visible = vehicle.active && (important || dx * dx + dz * dz <= cullDistanceSq);\n      let node = this.cars.get(vehicle.id);\n      if (!visible) { if (node) node.root.visible = false; continue; }\n      if (!node) {\n        node = this.makeCar(vehicle);\n        this.cars.set(vehicle.id, node);\n        this.scene.add(node.root);\n      }\n      node.root.visible = true;\n      node.root.position.set(vehicle.x, .12, vehicle.z);",
  },
  {
    label: 'pedestrian distance culling',
    from: "    for (const p of state.pedestrians) {\n      personIds.add(p.id);\n      let node = this.people.get(p.id);\n      if (!node) { node = this.makePerson(p.color); this.people.set(p.id, node); this.scene.add(node.root); }",
    to: "    const pedestrianCullSq = cullDistanceSq * .72;\n    for (const p of state.pedestrians) {\n      personIds.add(p.id);\n      const dx = p.x - state.player.x, dz = p.z - state.player.z;\n      let node = this.people.get(p.id);\n      if (dx * dx + dz * dz > pedestrianCullSq) { if (node) node.root.visible = false; continue; }\n      if (!node) { node = this.makePerson(p.color); this.people.set(p.id, node); this.scene.add(node.root); }",
  },
  {
    label: 'officer distance culling',
    from: "    for (const officer of state.officers) {\n      officerIds.add(officer.id);\n      let node = this.officers.get(officer.id);",
    to: "    for (const officer of state.officers) {\n      officerIds.add(officer.id);\n      const dx = officer.x - state.player.x, dz = officer.z - state.player.z;\n      let node = this.officers.get(officer.id);\n      if (dx * dx + dz * dz > cullDistanceSq) { if (node) node.root.visible = false; continue; }",
  },
  {
    label: 'ambient animation hook',
    from: "    this.updateMarker(state);\n    this.updateShots(state);\n    this.clouds.rotation.y = state.time * .00035;",
    to: "    this.updateMarker(state);\n    this.updateShots(state);\n    this.updateAmbientActivity(state);\n    this.clouds.rotation.y = state.time * .00035;",
  },
  {
    label: 'skip mobile atmosphere animation',
    from: "    this.clouds.rotation.y = state.time * .00035;\n    this.gulls.position.set(Math.sin(state.time * .028) * 50, Math.sin(state.time * .2) * 1.5, Math.cos(state.time * .025) * 35);\n    this.gulls.rotation.y = state.time * .035;\n    this.gulls.children.forEach((bird, i) => { bird.rotation.z = Math.sin(state.time * 2.6 + i) * .12; });",
    to: "    if (!this.mobile) {\n      this.clouds.rotation.y = state.time * .00035;\n      this.gulls.position.set(Math.sin(state.time * .028) * 50, Math.sin(state.time * .2) * 1.5, Math.cos(state.time * .025) * 35);\n      this.gulls.rotation.y = state.time * .035;\n      this.gulls.children.forEach((bird, i) => { bird.rotation.z = Math.sin(state.time * 2.6 + i) * .12; });\n    }",
  },
  {
    label: 'ambient activity method',
    from: "  private updateMarker(state: GameState) {",
    to: "  private updateAmbientActivity(state: GameState) {\n    const roads = this.world.roads;\n    const half = this.world.size / 2 - 12;\n    const span = half * 2;\n    for (let i = 0; i < this.ambientCars.count; i++) {\n      const axis = i % 2;\n      const direction = i % 4 < 2 ? 1 : -1;\n      const road = roads[(i * 3 + 1) % roads.length];\n      const lane = (i % 8 < 4 ? 1 : -1) * this.world.roadWidth * .2;\n      const speed = 6.2 + (i % 5) * .55;\n      const raw = state.time * speed * direction + i * 31.7;\n      const along = ((raw % span) + span) % span - half;\n      const x = axis ? along : road + lane;\n      const z = axis ? road + lane : along;\n      const dx = x - state.player.x, dz = z - state.player.z;\n      this.ambientPosition.set(x, .43, z);\n      this.ambientQuaternion.setFromAxisAngle(this.ambientUp, axis ? (direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (direction > 0 ? 0 : Math.PI));\n      if (dx * dx + dz * dz < 2304) this.ambientScale.setScalar(0);\n      else this.ambientScale.set(1.05, .65, 2.2);\n      this.ambientMatrix.compose(this.ambientPosition, this.ambientQuaternion, this.ambientScale);\n      this.ambientCars.setMatrixAt(i, this.ambientMatrix);\n    }\n    this.ambientCars.instanceMatrix.needsUpdate = true;\n    const sidewalk = this.world.roadWidth / 2 + 2.25;\n    for (let i = 0; i < this.ambientPeople.count; i++) {\n      const axis = i % 2;\n      const direction = i % 3 ? 1 : -1;\n      const road = roads[(i * 7 + 2) % roads.length];\n      const side = i % 4 < 2 ? 1 : -1;\n      const speed = 1.05 + (i % 6) * .08;\n      const raw = state.time * speed * direction + i * 17.3;\n      const along = ((raw % span) + span) % span - half;\n      const x = axis ? along : road + side * sidewalk;\n      const z = axis ? road + side * sidewalk : along;\n      const dx = x - state.player.x, dz = z - state.player.z;\n      this.ambientPosition.set(x, .95, z);\n      this.ambientQuaternion.setFromAxisAngle(this.ambientUp, axis ? (direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (direction > 0 ? 0 : Math.PI));\n      if (dx * dx + dz * dz < 1024) this.ambientScale.setScalar(0);\n      else this.ambientScale.set(.32, 1.7, .32);\n      this.ambientMatrix.compose(this.ambientPosition, this.ambientQuaternion, this.ambientScale);\n      this.ambientPeople.setMatrixAt(i, this.ambientMatrix);\n    }\n    this.ambientPeople.instanceMatrix.needsUpdate = true;\n  }\n\n  private updateMarker(state: GameState) {",
  },
]);

const simulation = 'GTA/Проект/src/game/simulation.ts';
patchFile(simulation, [
  {
    label: 'foot collision allocation',
    from: "    for (const solid of [...this.world.buildings, ...this.world.obstacles]) {\n      if (circleIntersectsBox(x, z, radius, solid)) return true;\n    }",
    to: "    for (const solid of this.world.buildings) if (circleIntersectsBox(x, z, radius, solid)) return true;\n    for (const solid of this.world.obstacles) if (circleIntersectsBox(x, z, radius, solid)) return true;",
  },
  {
    label: 'vehicle collision allocation',
    from: "    for (const solid of [...this.world.buildings, ...this.world.obstacles]) if (boxIntersects(test, solid, 0.035)) return solid.id;",
    to: "    for (const solid of this.world.buildings) if (boxIntersects(test, solid, 0.035)) return solid.id;\n    for (const solid of this.world.obstacles) if (boxIntersects(test, solid, 0.035)) return solid.id;",
  },
  {
    label: 'pedestrian danger squared distance',
    from: "      const danger = this.state.vehicles.find(v => v.active && Math.abs(v.speed) > 4 && dist(v, p) < 7);",
    to: "      const danger = this.state.vehicles.find(v => v.active && Math.abs(v.speed) > 4 && (v.x - p.x) ** 2 + (v.z - p.z) ** 2 < 49);",
  },
  {
    label: 'pedestrian separation squared distance',
    from: "      const blockedByPedestrian = this.state.pedestrians.some(other => other !== p && other.state !== 'dead' && dist({ x, z }, other) < 0.76);",
    to: "      const blockedByPedestrian = this.state.pedestrians.some(other => other !== p && other.state !== 'dead' && (other.x - x) ** 2 + (other.z - z) ** 2 < 0.5776);",
  },
]);

const app = 'GTA/Проект/src/ui/App.tsx';
patchFile(app, [
  {
    label: 'mobile simulation cadence',
    from: "        accumulator = Math.min(accumulator + dt, 5 / 60);\n        while (accumulator >= 1 / 60) {\n          const controls = input.sample();\n          renderer.prepareAim(simulation.state, controls);\n          simulation.step(1 / 60, { ...controls, viewYaw: renderer.getMovementYaw(), aimRay: renderer.getAimRay() });\n          accumulator -= 1 / 60;\n        }",
    to: "        const simulationStep = touchMode ? 1 / 30 : 1 / 60;\n        accumulator = Math.min(accumulator + dt, 5 * simulationStep);\n        while (accumulator >= simulationStep) {\n          const controls = input.sample();\n          renderer.prepareAim(simulation.state, controls);\n          simulation.step(simulationStep, { ...controls, viewYaw: renderer.getMovementYaw(), aimRay: renderer.getAimRay() });\n          accumulator -= simulationStep;\n        }",
  },
  {
    label: 'mobile hud update rate',
    from: '      if (now - lastUI > 90) { updateUI(); lastUI = now; }',
    to: '      if (now - lastUI > (touchMode ? 150 : 90)) { updateUI(); lastUI = now; }',
  },
]);

console.log('Applied safe mobile performance and ambient-city optimizations.');
