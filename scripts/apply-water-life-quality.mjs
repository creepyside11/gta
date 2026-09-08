import { readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

function patchFile(path, replacements) {
  const raw = readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let source = raw.replace(/\r\n/g, '\n');
  for (const { from, to, label } of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) throw new Error(`Patch target not found (${label}) in ${path}`);
    source = source.replace(from, to);
  }
  writeFileSync(path, crlf ? source.replace(/\n/g, '\r\n') : source);
}

const types = 'GTA/Проект/src/game/types.ts';
patchFile(types, [{
  label: 'player swimming state',
  from: "export interface Player extends Point { yaw: number; vehicleId: string | null; moving: boolean }",
  to: "export interface Player extends Point { yaw: number; vehicleId: string | null; moving: boolean; swimming: boolean }",
}]);

const simulation = 'GTA/Проект/src/game/simulation.ts';
patchFile(simulation, [
  {
    label: 'water margin constant',
    from: "const TAU = Math.PI * 2;",
    to: "const TAU = Math.PI * 2;\nconst WATER_MARGIN = 150;",
  },
  {
    label: 'initial swimming state',
    from: "    time: 0, player: { ...SPAWN, yaw: Math.PI, vehicleId: null, moving: false },",
    to: "    time: 0, player: { ...SPAWN, yaw: Math.PI, vehicleId: null, moving: false, swimming: false },",
  },
  {
    label: 'water-aware foot collision',
    from: `  private footBlocked(x: number, z: number, ignoreVehicle?: string, radius = FOOT_RADIUS, ignoreOfficer?: string): boolean {\n    if (Math.abs(x) + radius > this.world.size / 2 - 1 || Math.abs(z) + radius > this.world.size / 2 - 1) return true;\n    for (const solid of this.world.buildings) if (circleIntersectsBox(x, z, radius, solid)) return true;\n    for (const solid of this.world.obstacles) if (circleIntersectsBox(x, z, radius, solid)) return true;\n    if (this.state.vehicles.some(v => v.active && v.id !== ignoreVehicle && circleIntersectsBox(x, z, radius, v))) return true;\n    return this.state.officers.some(officer => officer.id !== ignoreOfficer && officer.state !== 'riding' && officer.state !== 'dead' && dist({ x, z }, officer) < radius + 0.38);\n  }`,
    to: `  private isWaterPoint(x: number, z: number): boolean {\n    const islandEdge = this.world.size / 2 - .62;\n    return Math.abs(x) > islandEdge || Math.abs(z) > islandEdge;\n  }\n\n  private footBlocked(x: number, z: number, ignoreVehicle?: string, radius = FOOT_RADIUS, ignoreOfficer?: string, allowWater = false): boolean {\n    const islandEdge = this.world.size / 2 - .62;\n    if (allowWater) {\n      const waterLimit = this.world.size / 2 + WATER_MARGIN;\n      if (Math.abs(x) + radius > waterLimit || Math.abs(z) + radius > waterLimit) return true;\n      if (this.isWaterPoint(x, z)) return false;\n    } else if (Math.abs(x) + radius > islandEdge || Math.abs(z) + radius > islandEdge) return true;\n    for (const solid of this.world.buildings) if (circleIntersectsBox(x, z, radius, solid)) return true;\n    for (const solid of this.world.obstacles) if (circleIntersectsBox(x, z, radius, solid)) return true;\n    if (this.state.vehicles.some(v => v.active && v.id !== ignoreVehicle && circleIntersectsBox(x, z, radius, v))) return true;\n    return this.state.officers.some(officer => officer.id !== ignoreOfficer && officer.state !== 'riding' && officer.state !== 'dead' && dist({ x, z }, officer) < radius + 0.38);\n  }`,
  },
  {
    label: 'swimming movement',
    from: `  private updateWalking(dt: number, input: InputFrame): void {\n    const p = this.state.player;\n    const strafe = Number.isFinite(input.turn) ? clamp(input.turn, -1, 1) : 0;\n    const forward = Number.isFinite(input.forward) ? clamp(input.forward, -1, 1) : 0;\n    const viewYaw = input.viewYaw;\n    // Keep keyboard-only callers facing -Z; a real view supplies its own heading.\n    const sin = viewYaw !== undefined && Number.isFinite(viewYaw) ? Math.sin(viewYaw) : 0;\n    const cos = viewYaw !== undefined && Number.isFinite(viewYaw) ? Math.cos(viewYaw) : -1;\n    const dx = forward * sin - strafe * cos;\n    const dz = forward * cos + strafe * sin;\n    const length = Math.hypot(dx, dz);\n    p.moving = length > 0;\n    if (!length) return;\n    const speed = input.sprint ? 8 : 5.2;\n    const moveX = dx / length * speed * dt;\n    const moveZ = dz / length * speed * dt;\n    p.yaw += angleDelta(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 16);\n    if (!this.footBlocked(p.x + moveX, p.z)) p.x += moveX;\n    if (!this.footBlocked(p.x, p.z + moveZ)) p.z += moveZ;\n  }`,
    to: `  private updateWalking(dt: number, input: InputFrame): void {\n    const p = this.state.player;\n    const wasSwimming = p.swimming;\n    p.swimming = this.isWaterPoint(p.x, p.z);\n    const strafe = Number.isFinite(input.turn) ? clamp(input.turn, -1, 1) : 0;\n    const forward = Number.isFinite(input.forward) ? clamp(input.forward, -1, 1) : 0;\n    const viewYaw = input.viewYaw;\n    // Keep keyboard-only callers facing -Z; a real view supplies its own heading.\n    const sin = viewYaw !== undefined && Number.isFinite(viewYaw) ? Math.sin(viewYaw) : 0;\n    const cos = viewYaw !== undefined && Number.isFinite(viewYaw) ? Math.cos(viewYaw) : -1;\n    const dx = forward * sin - strafe * cos;\n    const dz = forward * cos + strafe * sin;\n    const length = Math.hypot(dx, dz);\n    p.moving = length > 0;\n    if (!length) return;\n    const swimmingNext = p.swimming || this.isWaterPoint(p.x + dx * .3, p.z + dz * .3);\n    const speed = swimmingNext ? (input.sprint ? 3.8 : 2.9) : input.sprint ? 8 : 5.2;\n    const moveX = dx / length * speed * dt;\n    const moveZ = dz / length * speed * dt;\n    p.yaw += angleDelta(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * (swimmingNext ? 8 : 16));\n    if (!this.footBlocked(p.x + moveX, p.z, undefined, FOOT_RADIUS, undefined, true)) p.x += moveX;\n    if (!this.footBlocked(p.x, p.z + moveZ, undefined, FOOT_RADIUS, undefined, true)) p.z += moveZ;\n    p.swimming = this.isWaterPoint(p.x, p.z);\n    if (!wasSwimming && p.swimming) this.message('Swimming · use movement controls to head back to shore.', 3);\n  }`,
  },
  {
    label: 'driving clears swimming',
    from: "    p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.moving = Math.abs(car.speed) > 0.1;",
    to: "    p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.moving = Math.abs(car.speed) > 0.1; p.swimming = false;",
  },
  {
    label: 'exit vehicle swimming state',
    from: "      s.player.yaw = controlled.yaw; s.player.moving = false;",
    to: "      s.player.yaw = controlled.yaw; s.player.moving = false; s.player.swimming = false;",
  },
  {
    label: 'enter vehicle swimming state',
    from: "    s.player.vehicleId = car.id; s.player.x = car.x; s.player.z = car.z; s.player.yaw = car.yaw; car.steer = 0;",
    to: "    s.player.vehicleId = car.id; s.player.x = car.x; s.player.z = car.z; s.player.yaw = car.yaw; s.player.swimming = false; car.steer = 0;",
  },
  {
    label: 'restart swimming state',
    from: "    s.player.x = spawn.x; s.player.z = spawn.z; s.player.yaw = Math.PI; s.player.moving = false;",
    to: "    s.player.x = spawn.x; s.player.z = spawn.z; s.player.yaw = Math.PI; s.player.moving = false; s.player.swimming = false;",
  },
  {
    label: 'swimming hint',
    from: "    if (this.state.mission.phase === 'available' && dist(this.state.player, this.world.pickup) < 4) return 'E · Start Portside Express';",
    to: "    if (this.state.player.swimming) return 'SWIM · Move toward shore · Sprint for a faster stroke';\n    if (this.state.mission.phase === 'available' && dist(this.state.player, this.world.pickup) < 4) return 'E · Start Portside Express';",
  },
]);

const renderer = 'GTA/Проект/src/render/GameRenderer.ts';
patchFile(renderer, [
  {
    label: 'water world import',
    from: "import { buildSpecialBuilding } from './BuildingModels';",
    to: "import { buildSpecialBuilding } from './BuildingModels';\nimport { WaterWorld } from './WaterWorld';",
  },
  {
    label: 'water world field',
    from: "  private readonly ambientUp = new THREE.Vector3(0, 1, 0);",
    to: "  private readonly ambientUp = new THREE.Vector3(0, 1, 0);\n  private readonly waterWorld: WaterWorld;",
  },
  {
    label: 'restore mobile image quality',
    from: `    this.dynamicCullDistance = this.mobile ? 145 : 280;\n    this.camera.far = this.mobile ? 360 : 740;\n    this.cameraRig = new CameraRig(this.camera, world.buildings);\n    this.renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, alpha: false, powerPreference: 'high-performance' });\n    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.75));\n    this.renderer.shadowMap.enabled = !this.mobile;\n    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;`,
    to: `    this.dynamicCullDistance = this.mobile ? 185 : 280;\n    this.camera.far = this.mobile ? 560 : 740;\n    this.cameraRig = new CameraRig(this.camera, world.buildings);\n    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });\n    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.4 : 1.75));\n    this.renderer.shadowMap.enabled = true;\n    this.renderer.shadowMap.type = this.mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;`,
  },
  {
    label: 'restore fog quality',
    from: "    this.scene.fog = new THREE.Fog('#addbdc', this.mobile ? 90 : 115, this.mobile ? 260 : 340);",
    to: "    this.scene.fog = new THREE.Fog('#addbdc', this.mobile ? 108 : 115, this.mobile ? 350 : 340);",
  },
  {
    label: 'restore mobile shadows',
    from: "    this.sun.castShadow = !this.mobile;\n    this.sun.shadow.mapSize.set(this.mobile ? 512 : 2048, this.mobile ? 512 : 2048);",
    to: "    this.sun.castShadow = true;\n    this.sun.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);",
  },
  {
    label: 'create dynamic water world',
    from: "    this.buildHarbor();\n    this.flushBatches();",
    to: "    this.buildHarbor();\n    this.waterWorld = new WaterWorld(this.scene, world, this.mobile);\n    this.flushBatches();",
  },
  {
    label: 'keep gulls on mobile',
    from: "    if (this.mobile) { this.clouds.visible = false; this.gulls.visible = false; }",
    to: "    if (this.mobile) this.clouds.visible = false;",
  },
  {
    label: 'denser varied ambient people',
    from: `    this.ambientPeople = new THREE.InstancedMesh(this.geometries.box, this.material('#758b82', .95), this.mobile ? 24 : 40);\n    this.ambientPeople.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n    this.ambientPeople.castShadow = false;\n    this.ambientPeople.receiveShadow = false;\n    this.ambientPeople.frustumCulled = false;\n    this.scene.add(this.ambientPeople);`,
    to: `    this.ambientPeople = new THREE.InstancedMesh(this.geometries.cylinder, this.material('#f0c9a6', .95), this.mobile ? 72 : 120);\n    this.ambientPeople.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n    const crowdColors = ['#d96f62', '#5d849c', '#d7ae55', '#6d9a75', '#9a759d', '#54726d', '#c88763', '#7380a3'];\n    for (let i = 0; i < this.ambientPeople.count; i++) this.ambientPeople.setColorAt(i, new THREE.Color(crowdColors[i % crowdColors.length]));\n    if (this.ambientPeople.instanceColor) this.ambientPeople.instanceColor.needsUpdate = true;\n    this.ambientPeople.castShadow = false;\n    this.ambientPeople.receiveShadow = true;\n    this.ambientPeople.frustumCulled = false;\n    this.scene.add(this.ambientPeople);`,
  },
  {
    label: 'swimming animation helper',
    from: `  private animateDead(node: PersonNode, x: number, z: number, yaw: number, age: number) {`,
    to: `  private animateSwimming(node: PersonNode, x: number, z: number, yaw: number, phase: number, moving: boolean) {\n    node.root.visible = true;\n    node.root.position.set(x, -1.93 + Math.sin(phase * .45) * .045, z);\n    node.root.rotation.y = yaw;\n    const stroke = moving ? Math.sin(phase) : 0;\n    node.body.position.set(0, 0, 0);\n    node.body.rotation.set(-.22, 0, 0);\n    node.leftArm.visible = node.rightArm.visible = true;\n    node.leftArm.rotation.set(stroke * 1.15 - .35, 0, -.22);\n    node.rightArm.rotation.set(-stroke * 1.15 - .35, 0, .22);\n    node.leftLeg.rotation.set(-stroke * .38, 0, 0);\n    node.rightLeg.rotation.set(stroke * .38, 0, 0);\n    if (node.armedArms) node.armedArms.root.visible = false;\n    if (node.weapons) for (const weapon of Object.values(node.weapons)) weapon.root.visible = false;\n  }\n\n  private animateDead(node: PersonNode, x: number, z: number, yaw: number, age: number) {`,
  },
  {
    label: 'use swimming animation',
    from: `      this.animatePerson(this.player, state.player.x, state.player.z, yaw, state.time * 10.5, state.player.moving);\n      const flashing = combat.shots.some(shot => shot.owner === 'player' && shot.weapon === combat.weapon && state.time - shot.time < .075);`,
    to: `      if (state.player.swimming) this.animateSwimming(this.player, state.player.x, state.player.z, yaw, state.time * 7.2, state.player.moving);\n      else this.animatePerson(this.player, state.player.x, state.player.z, yaw, state.time * 10.5, state.player.moving);\n      const flashing = combat.shots.some(shot => shot.owner === 'player' && shot.weapon === combat.weapon && state.time - shot.time < .075);`,
  },
  {
    label: 'update water animation',
    from: "    this.updateAmbientActivity(state);\n    if (!this.mobile) {",
    to: "    this.updateAmbientActivity(state);\n    this.waterWorld.update(state.time);\n    if (!this.mobile) {",
  },
  {
    label: 'waterfront crowd distribution',
    from: `    const sidewalk = this.world.roadWidth / 2 + 2.25;\n    for (let i = 0; i < this.ambientPeople.count; i++) {\n      const axis = i % 2;\n      const direction = i % 3 ? 1 : -1;\n      const road = roads[(i * 7 + 2) % roads.length];\n      const side = i % 4 < 2 ? 1 : -1;\n      const speed = 1.05 + (i % 6) * .08;\n      const raw = state.time * speed * direction + i * 17.3;\n      const along = ((raw % span) + span) % span - half;\n      const x = axis ? along : road + side * sidewalk;\n      const z = axis ? road + side * sidewalk : along;\n      const dx = x - state.player.x, dz = z - state.player.z;\n      this.ambientPosition.set(x, .95, z);\n      this.ambientQuaternion.setFromAxisAngle(this.ambientUp, axis ? (direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (direction > 0 ? 0 : Math.PI));\n      if (dx * dx + dz * dz < 1024) this.ambientScale.setScalar(0);\n      else this.ambientScale.set(.32, 1.7, .32);\n      this.ambientMatrix.compose(this.ambientPosition, this.ambientQuaternion, this.ambientScale);\n      this.ambientPeople.setMatrixAt(i, this.ambientMatrix);\n    }\n    this.ambientPeople.instanceMatrix.needsUpdate = true;`,
    to: `    const sidewalk = this.world.roadWidth / 2 + 2.25;\n    const promenade = this.world.size / 2 - 4.4;\n    for (let i = 0; i < this.ambientPeople.count; i++) {\n      const axis = i % 2;\n      const direction = i % 3 ? 1 : -1;\n      const road = roads[(i * 7 + 2) % roads.length];\n      const side = i % 4 < 2 ? 1 : -1;\n      const speed = 1.05 + (i % 6) * .08;\n      const raw = state.time * speed * direction + i * 17.3;\n      const along = ((raw % span) + span) % span - half;\n      const waterfront = i % 5 === 0;\n      const coastSide = i % 4;\n      const x = waterfront ? (coastSide < 2 ? (coastSide ? promenade : -promenade) : along) : axis ? along : road + side * sidewalk;\n      const z = waterfront ? (coastSide < 2 ? along : (coastSide === 2 ? promenade : -promenade)) : axis ? road + side * sidewalk : along;\n      const dx = x - state.player.x, dz = z - state.player.z;\n      this.ambientPosition.set(x, .78, z);\n      const heading = waterfront ? (coastSide < 2 ? (direction > 0 ? 0 : Math.PI) : (direction > 0 ? Math.PI / 2 : -Math.PI / 2)) : axis ? (direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (direction > 0 ? 0 : Math.PI);\n      this.ambientQuaternion.setFromAxisAngle(this.ambientUp, heading);\n      if (dx * dx + dz * dz < 324) this.ambientScale.setScalar(0);\n      else this.ambientScale.set(.24, 1.35, .24);\n      this.ambientMatrix.compose(this.ambientPosition, this.ambientQuaternion, this.ambientScale);\n      this.ambientPeople.setMatrixAt(i, this.ambientMatrix);\n    }\n    this.ambientPeople.instanceMatrix.needsUpdate = true;`,
  },
]);

const waterWorld = `import * as THREE from 'three';\nimport type { World } from '../game/types';\n\ntype Craft = { root: THREE.Group; phase: number; speed: number; rx: number; rz: number; wake: THREE.Mesh };\n\nexport class WaterWorld {\n  private readonly water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;\n  private readonly craft: Craft[] = [];\n\n  constructor(scene: THREE.Scene, world: World, mobile: boolean) {\n    const size = Math.max(1100, world.size + 720);\n    const geometry = new THREE.PlaneGeometry(size, size, mobile ? 30 : 56, mobile ? 30 : 56);\n    const material = new THREE.ShaderMaterial({\n      uniforms: {\n        time: { value: 0 },\n        deepColor: { value: new THREE.Color('#287c8d') },\n        shallowColor: { value: new THREE.Color('#62c4c3') },\n        skyColor: { value: new THREE.Color('#c8eff1') },\n      },\n      vertexShader: 'uniform float time; varying float vWave; varying vec3 vWorld; void main(){ vec3 p=position; float w=sin(p.x*.036+time*1.15)*.13+cos(p.y*.031-time*.82)*.09+sin((p.x+p.y)*.018+time*.56)*.06; p.z+=w; vWave=w; vec4 world=modelMatrix*vec4(p,1.0); vWorld=world.xyz; gl_Position=projectionMatrix*viewMatrix*world; }',\n      fragmentShader: 'uniform float time; uniform vec3 deepColor; uniform vec3 shallowColor; uniform vec3 skyColor; varying float vWave; varying vec3 vWorld; void main(){ float bands=.5+.5*sin(vWorld.x*.075+vWorld.z*.052+time*1.7); float foam=smoothstep(.72,1.0,bands)*.18; vec3 base=mix(deepColor,shallowColor,clamp(.48+vWave*1.8,0.0,1.0)); float glint=pow(max(0.0,sin(vWorld.x*.024-time)*cos(vWorld.z*.021+time*.7)),10.0)*.42; vec3 color=mix(base,skyColor,glint+foam); gl_FragColor=vec4(color,.97); }',\n      transparent: true,\n      depthWrite: true,\n      side: THREE.DoubleSide,\n    });\n    this.water = new THREE.Mesh(geometry, material);\n    this.water.rotation.x = -Math.PI / 2;\n    this.water.position.y = -.82;\n    this.water.receiveShadow = true;\n    scene.add(this.water);\n\n    const edge = world.size / 2;\n    const craftCount = mobile ? 7 : 11;\n    for (let i = 0; i < craftCount; i++) {\n      const yacht = i % 3 === 0;\n      const root = yacht ? this.makeYacht(i) : this.makeBoat(i);\n      const wake = this.makeWake(yacht);\n      root.add(wake);\n      scene.add(root);\n      this.craft.push({ root, wake, phase: i / craftCount * Math.PI * 2, speed: .055 + (i % 4) * .009, rx: edge + 38 + i % 3 * 17, rz: edge + 45 + (i * 2) % 4 * 14 });\n    }\n  }\n\n  private mat(color: string, roughness = .72, metalness = .02) {\n    return new THREE.MeshStandardMaterial({ color, roughness, metalness });\n  }\n\n  private mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true) {\n    const mesh = new THREE.Mesh(geometry, material);\n    mesh.position.set(x, y, z);\n    mesh.castShadow = shadow;\n    mesh.receiveShadow = true;\n    parent.add(mesh);\n    return mesh;\n  }\n\n  private makeBoat(seed: number) {\n    const root = new THREE.Group();\n    const colors = ['#f2efe5', '#e77e68', '#6ba5b5', '#ddb85f'];\n    const paint = this.mat(colors[seed % colors.length], .5);\n    const dark = this.mat('#294852', .42, .08);\n    const hull = this.mesh(root, new THREE.BoxGeometry(2.5, .55, 6.1), paint, 0, .05, 0);\n    hull.scale.x = .86;\n    const bow = this.mesh(root, new THREE.ConeGeometry(1.2, 2.1, 4), paint, 0, .08, 3.45);\n    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;\n    this.mesh(root, new THREE.BoxGeometry(1.65, .48, 2.05), dark, 0, .62, -.35);\n    const glass = this.mesh(root, new THREE.BoxGeometry(1.45, .34, .08), new THREE.MeshStandardMaterial({ color: '#9ed6de', roughness: .18, metalness: .08, transparent: true, opacity: .82 }), 0, .93, .72, false);\n    glass.rotation.x = -.32;\n    this.mesh(root, new THREE.BoxGeometry(1.85, .1, 2.55), this.mat('#f3e9d5', .82), 0, .42, -.22);\n    this.mesh(root, new THREE.CylinderGeometry(.15, .18, .55, 8), dark, 0, .38, -3.03);\n    root.scale.setScalar(.82 + seed % 2 * .08);\n    return root;\n  }\n\n  private makeYacht(seed: number) {\n    const root = new THREE.Group();\n    const paint = this.mat(seed % 2 ? '#f5f0df' : '#e8ece8', .48);\n    const stripe = this.mat(seed % 2 ? '#3f7f92' : '#6b829a', .42, .05);\n    this.mesh(root, new THREE.BoxGeometry(3.2, .72, 9.5), paint, 0, .02, 0);\n    const bow = this.mesh(root, new THREE.ConeGeometry(1.55, 3.2, 4), paint, 0, .06, 5.25);\n    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;\n    this.mesh(root, new THREE.BoxGeometry(3.26, .18, 6.5), stripe, 0, .06, -.7);\n    this.mesh(root, new THREE.BoxGeometry(2.25, .72, 3.4), this.mat('#f4ead8', .78), 0, .8, -1.25);\n    this.mesh(root, new THREE.BoxGeometry(2.05, .42, .1), new THREE.MeshStandardMaterial({ color: '#78aab8', roughness: .2, transparent: true, opacity: .86 }), 0, 1.08, .5, false);\n    const mast = this.mesh(root, new THREE.CylinderGeometry(.08, .1, 7.2, 8), this.mat('#d8d0bc', .58), 0, 4.5, .25);\n    mast.castShadow = true;\n    const sailGeometry = new THREE.BufferGeometry();\n    sailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,5.6,0, 2.65,.35,0], 3));\n    sailGeometry.computeVertexNormals();\n    const sail = this.mesh(root, sailGeometry, new THREE.MeshStandardMaterial({ color: '#fff8e8', roughness: .9, side: THREE.DoubleSide }), .12, 1.45, .25);\n    sail.rotation.y = .08;\n    this.mesh(root, new THREE.BoxGeometry(2.5, .12, 4.2), this.mat('#d7c19b', .88), 0, .5, -1.1);\n    root.scale.setScalar(.88 + seed % 2 * .06);\n    return root;\n  }\n\n  private makeWake(yacht: boolean) {\n    const material = new THREE.MeshBasicMaterial({ color: '#d8f4ef', transparent: true, opacity: yacht ? .24 : .31, depthWrite: false, side: THREE.DoubleSide });\n    const wake = new THREE.Mesh(new THREE.PlaneGeometry(yacht ? 3.2 : 2.2, yacht ? 10 : 7), material);\n    wake.rotation.x = -Math.PI / 2;\n    wake.position.set(0, -.29, yacht ? -7.2 : -5.1);\n    return wake;\n  }\n\n  update(time: number) {\n    this.water.material.uniforms.time.value = time;\n    for (let i = 0; i < this.craft.length; i++) {\n      const craft = this.craft[i];\n      const angle = craft.phase + time * craft.speed;\n      const x = Math.cos(angle) * craft.rx;\n      const z = Math.sin(angle) * craft.rz;\n      const dx = -Math.sin(angle) * craft.rx;\n      const dz = Math.cos(angle) * craft.rz;\n      craft.root.position.set(x, -.5 + Math.sin(time * 1.6 + i) * .055, z);\n      craft.root.rotation.y = Math.atan2(dx, dz);\n      craft.root.rotation.z = Math.sin(time * 1.25 + i * .7) * .018;\n      craft.root.rotation.x = Math.sin(time * 1.05 + i) * .012;\n      (craft.wake.material as THREE.MeshBasicMaterial).opacity = (.2 + (i % 3) * .035) * (.88 + Math.sin(time * 2 + i) * .12);\n    }\n  }\n}\n`;
mkdirSync('GTA/Проект/src/render', { recursive: true });
writeFileSync('GTA/Проект/src/render/WaterWorld.ts', waterWorld);

const swimmingTest = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Simulation } from '../src/game/simulation';\nimport { NO_INPUT } from '../src/game/types';\n\ntest('player can enter the ocean, swims slower, and returns to shore', () => {\n  const sim = new Simulation();\n  const edge = sim.world.size / 2;\n  sim.state.player.x = edge - 1.25;\n  sim.state.player.z = 0;\n  const outward = { ...NO_INPUT, forward: 1, viewYaw: Math.PI / 2 };\n  for (let i = 0; i < 60; i++) sim.step(1 / 60, outward);\n  assert.ok(sim.state.player.x > edge);\n  assert.equal(sim.state.player.swimming, true);\n  const start = sim.state.player.x;\n  for (let i = 0; i < 60; i++) sim.step(1 / 60, outward);\n  const swimDistance = sim.state.player.x - start;\n  assert.ok(swimDistance > 2.4 && swimDistance < 4.2);\n  const inward = { ...NO_INPUT, forward: 1, viewYaw: -Math.PI / 2 };\n  for (let i = 0; i < 180; i++) sim.step(1 / 60, inward);\n  assert.ok(sim.state.player.x < edge - .7);\n  assert.equal(sim.state.player.swimming, false);\n});\n\ntest('mission reset always returns a swimmer to dry land', () => {\n  const sim = new Simulation();\n  sim.state.player.x = sim.world.size / 2 + 20;\n  sim.state.player.swimming = true;\n  sim.restartMission();\n  assert.equal(sim.state.player.swimming, false);\n  assert.ok(Math.abs(sim.state.player.x) < sim.world.size / 2);\n});\n`;
writeFileSync('GTA/Проект/tests/swimming.test.ts', swimmingTest);

console.log('Applied water, boats, swimming, crowd density and mobile quality improvements.');
