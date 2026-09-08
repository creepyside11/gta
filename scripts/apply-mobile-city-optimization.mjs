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
    label: 'mobile fields',
    from: "  private labelPhase = '';\n  private disposed = false;",
    to: "  private labelPhase = '';\n  private disposed = false;\n  private readonly mobile: boolean;\n  private readonly dynamicCullDistance: number;",
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
    label: 'mobile atmosphere',
    from: "    this.buildAtmosphere();\n\n    const ringMaterial",
    to: "    this.buildAtmosphere();\n    if (this.mobile) { this.clouds.visible = false; this.gulls.visible = false; }\n\n    const ringMaterial",
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
    label: 'skip mobile atmosphere animation',
    from: "    this.clouds.rotation.y = state.time * .00035;\n    this.gulls.position.set(Math.sin(state.time * .028) * 50, Math.sin(state.time * .2) * 1.5, Math.cos(state.time * .025) * 35);\n    this.gulls.rotation.y = state.time * .035;\n    this.gulls.children.forEach((bird, i) => { bird.rotation.z = Math.sin(state.time * 2.6 + i) * .12; });",
    to: "    if (!this.mobile) {\n      this.clouds.rotation.y = state.time * .00035;\n      this.gulls.position.set(Math.sin(state.time * .028) * 50, Math.sin(state.time * .2) * 1.5, Math.cos(state.time * .025) * 35);\n      this.gulls.rotation.y = state.time * .035;\n      this.gulls.children.forEach((bird, i) => { bird.rotation.z = Math.sin(state.time * 2.6 + i) * .12; });\n    }",
  },
]);

const simulation = 'GTA/Проект/src/game/simulation.ts';
patchFile(simulation, [
  {
    label: '60hz simulation',
    from: 'const FIXED_STEP = 1 / 90;',
    to: 'const FIXED_STEP = 1 / 60;',
  },
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

const ai = 'GTA/Проект/src/game/ai.ts';
patchFile(ai, [
  {
    label: 'west traffic loop',
    from: "  const inner: Point[] = [{ x: -4, z: -84 }, { x: -4, z: -4 }, { x: 84, z: -4 }, { x: 84, z: -84 }];",
    to: "  const inner: Point[] = [{ x: -4, z: -84 }, { x: -4, z: -4 }, { x: 84, z: -4 }, { x: 84, z: -84 }];\n  const west: Point[] = [{ x: -84, z: -84 }, { x: -84, z: -4 }, { x: -4, z: -4 }, { x: -4, z: -84 }];",
  },
  {
    label: 'extra traffic',
    from: "    vehicle('traffic-7', 'traffic', 84, -55, Math.PI, '#e0a88c', inner, 3, 'pickup'),\n    vehicle('police-0'",
    to: "    vehicle('traffic-7', 'traffic', 84, -55, Math.PI, '#e0a88c', inner, 3, 'pickup'),\n    vehicle('traffic-16', 'traffic', -84, -52, 0, '#d08165', west, 1, 'hatchback'),\n    vehicle('traffic-17', 'traffic', -52, -4, Math.PI / 2, '#82a985', west, 2, 'pickup'),\n    vehicle('traffic-18', 'traffic', -4, -36, Math.PI, '#d9b66e', west, 3, 'sedan'),\n    vehicle('traffic-19', 'traffic', -36, -84, -Math.PI / 2, '#819bb5', west, 0, 'sport'),\n    vehicle('police-0'",
  },
  {
    label: 'denser central pedestrians',
    from: "  return loops.flatMap((route, loop) => Array.from({ length: 5 }, (_, index) => {\n    const edge = index % 4;\n    const a = route[edge];\n    const b = route[(edge + 1) % 4];\n    const t = index === 4 ? 0.76 : 0.14 + index * 0.13;\n    return { id: `ped-${loop * 5 + index}`",
    to: "  return loops.flatMap((route, loop) => Array.from({ length: loop < 4 ? 8 : 5 }, (_, index) => {\n    const edge = index % 4;\n    const a = route[edge];\n    const b = route[(edge + 1) % 4];\n    const t = loop < 4 ? (index < 4 ? 0.18 + index * 0.04 : 0.66 + (index - 4) * 0.04) : index === 4 ? 0.76 : 0.14 + index * 0.13;\n    return { id: `ped-${loop * 8 + index}`",
  },
]);

const app = 'GTA/Проект/src/ui/App.tsx';
patchFile(app, [
  {
    label: 'mobile hud update rate',
    from: '      if (now - lastUI > 90) { updateUI(); lastUI = now; }',
    to: '      if (now - lastUI > (touchMode ? 150 : 90)) { updateUI(); lastUI = now; }',
  },
]);

console.log('Applied mobile performance and city-density optimizations.');
