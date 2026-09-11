from pathlib import Path

world_path = Path('GTA/Проект/src/game/world.ts')
world = world_path.read_text()

old_import = "import type { Building, BuildingArchitecture, Solid, World, WorldDistrict } from './types';"
new_import = "import type { Building, BuildingArchitecture, EnvironmentAssetId, Solid, World, WorldDistrict } from './types';"
assert old_import in world
world = world.replace(old_import, new_import, 1)

old = "  const addMetroBuilding = (districtId: string, x: number, z: number, width: number, depth: number, seed: number, label?: string): void => {"
new = "  const addMetroBuilding = (districtId: string, x: number, z: number, width: number, depth: number, seed: number, label?: string, assetModel?: EnvironmentAssetId): void => {"
assert old in world
world = world.replace(old, new, 1)

old = """      color: PALETTE[(seed + districtId.length) % PALETTE.length], style: seed % 4, architecture,
      ...(label ? { label } : {}),
    };"""
new = """      color: PALETTE[(seed + districtId.length) % PALETTE.length], style: seed % 4, architecture,
      ...(label ? { label } : {}),
      ...(assetModel ? { assetModel } : {}),
    };"""
assert old in world
world = world.replace(old, new, 1)

old = "  const addMetroProp = (districtId: string, x: number, z: number, kind: 'tree' | 'planter' | 'bench' | 'bin', seed: number, yaw = 0): void => {"
new = "  const addMetroProp = (districtId: string, x: number, z: number, kind: 'tree' | 'planter' | 'bench' | 'bin', seed: number, yaw = 0, assetModel?: EnvironmentAssetId): void => {"
assert old in world
world = world.replace(old, new, 1)

old = "    const prop: Solid = { id: `metro-${districtId}-${kind}-${propSerial++}`, kind, x, z, width, depth, height, yaw, color: colors[kind] };"
new = "    const prop: Solid = { id: `metro-${districtId}-${kind}-${propSerial++}`, kind, x, z, width, depth, height, yaw, color: colors[kind], ...(assetModel ? { assetModel } : {}) };"
assert old in world
world = world.replace(old, new, 1)

old = """  const sideSlots = [-140, -100, -60, 20, 100, 140];
  sideSlots.forEach((along, index) => {
    const kind = index % 3 === 0 ? 'bench' : index % 3 === 1 ? 'tree' : 'planter';
    addMetroProp('vice-beach', 292, along, kind, 100 + index, Math.PI / 2);
    addMetroProp('west-harbor', -292, -along, kind, 110 + index, -Math.PI / 2);
    addMetroProp('northside', -along, -292, kind, 120 + index, 0);
    addMetroProp('sunport', along, 292, kind, 130 + index, Math.PI);
  });"""
new = """  const sideSlots = [-140, -100, -60, 20, 100, 140];
  sideSlots.forEach((along, index) => {
    const kind = index % 3 === 0 ? 'bench' : index % 3 === 1 ? 'tree' : 'planter';
    const isTree = kind === 'tree';
    addMetroProp('vice-beach', 292, along, kind, 100 + index, Math.PI / 2, isTree ? 'tree-palm' : undefined);
    addMetroProp('west-harbor', -292, -along, kind, 110 + index, -Math.PI / 2, isTree ? 'tree-oak' : undefined);
    addMetroProp('northside', -along, -292, kind, 120 + index, 0, isTree ? 'tree-pine' : undefined);
    addMetroProp('sunport', along, 292, kind, 130 + index, Math.PI, isTree ? 'tree-oak' : undefined);
  });"""
assert old in world
world = world.replace(old, new, 1)

needle = "  addMetroBuilding('sunport', 120, 440, 42, 28, 158, 'AIR FREIGHT');\n}"
insert = """  addMetroBuilding('sunport', 120, 440, 42, 28, 158, 'AIR FREIGHT');

  // Fill the previously empty diagonal quadrants with low-rise neighborhoods.
  // Every house remains a simulation collider; the GLB only replaces the visual shell.
  const houseAssets: EnvironmentAssetId[] = ['house-a', 'house-b', 'house-h', 'house-i'];
  const neighborhoods: { x: number; z: number; district: string; tree: EnvironmentAssetId; seed: number }[] = [
    { x: 240, z: -240, district: 'northside', tree: 'tree-pine', seed: 200 },
    { x: -240, z: -240, district: 'northside', tree: 'tree-oak', seed: 240 },
    { x: 240, z: 240, district: 'sunport', tree: 'tree-palm', seed: 280 },
    { x: -240, z: 240, district: 'sunport', tree: 'tree-oak', seed: 320 },
  ];
  const homeOffsets = [-48, 0, 48];
  for (const block of neighborhoods) {
    let local = 0;
    for (const dx of homeOffsets) for (const dz of homeOffsets) {
      if (dx === 0 && dz === 0) continue;
      const seed = block.seed + local++;
      addMetroBuilding(
        block.district, block.x + dx, block.z + dz,
        20 + seed % 3 * 2, 18 + (seed + 1) % 3 * 2, seed,
        undefined, houseAssets[seed % houseAssets.length],
      );
    }
    const garden = [[0, 0], [-17, 0], [17, 0], [0, -17], [0, 17]] as const;
    garden.forEach(([dx, dz], index) => addMetroProp(block.district, block.x + dx, block.z + dz, 'tree', block.seed + 30 + index, 0, block.tree));
    for (const dx of [-64, 64]) for (const dz of [-64, 64])
      addMetroProp(block.district, block.x + dx, block.z + dz, 'tree', block.seed + 40 + dx + dz, 0, block.tree);
  }

  // Continuous landscaping around the coastline makes long drives feel inhabited.
  const coastBands = [-440, -360, -240, -120, -40, 40, 120, 240, 360, 440];
  coastBands.forEach((along, index) => {
    addMetroProp('vice-beach', edge - 25, along, 'tree', 400 + index, 0, 'tree-palm');
    addMetroProp('west-harbor', -edge + 25, along, 'tree', 420 + index, 0, 'tree-oak');
    addMetroProp('northside', along, -edge + 25, 'tree', 440 + index, 0, 'tree-pine');
    addMetroProp('sunport', along, edge - 25, 'tree', 460 + index, 0, index % 2 ? 'tree-palm' : 'tree-oak');
  });
}"""
assert needle in world
world = world.replace(needle, insert, 1)
world_path.write_text(world)

renderer_path = Path('GTA/Проект/src/render/GameRenderer.ts')
renderer = renderer_path.read_text()
assert "import { WaterWorld } from './WaterWorld';" in renderer
renderer = renderer.replace("import { WaterWorld } from './WaterWorld';", "import { WaterWorld } from './WaterWorld';\nimport { EnvironmentModels } from './EnvironmentModels';", 1)
assert "  private readonly waterWorld: WaterWorld;" in renderer
renderer = renderer.replace("  private readonly waterWorld: WaterWorld;", "  private readonly waterWorld: WaterWorld;\n  private readonly environmentModels: EnvironmentModels;", 1)

old = """    this.buildGround();
    world.buildings.forEach(b => this.buildBuilding(b));
    this.buildProps();
    this.buildHarbor();
    this.waterWorld = new WaterWorld(this.scene, world, this.mobile);"""
new = """    this.buildGround();
    world.buildings.forEach(b => { if (!b.assetModel) this.buildBuilding(b); });
    this.buildProps();
    this.environmentModels = new EnvironmentModels(this.scene, world, this.mobile);
    this.buildHarbor();
    this.waterWorld = new WaterWorld(this.scene, world, this.mobile);"""
assert old in renderer
renderer = renderer.replace(old, new, 1)

old = """    // Seawall, promenade, and rail posts define the edge of the playable island.
    for (const sign of [-1, 1]) {
      this.batch('box', '#e6dec8', sign * (half - 3.3), .09, 0, 6.6, .22, w.size, 0, false);
      this.batch('box', '#e6dec8', 0, .1, sign * (half - 3.3), w.size, .22, 6.6, 0, false);
      this.batch('box', '#f0e6cc', sign * (half + .2), -.28, 0, 1.2, 1.8, w.size + 2);
      this.batch('box', '#f0e6cc', 0, -.28, sign * (half + .2), w.size + 2, 1.8, 1.2);
      this.batch('box', '#789897', sign * (half - .7), 1.09, 0, .1, .1, w.size - 2);
      this.batch('box', '#789897', 0, 1.09, sign * (half - .7), w.size - 2, .1, .1);
      for (let n = -half + 3; n < half; n += 5) {
        this.batch('box', '#789897', sign * (half - .7), .63, n, .12, 1.05, .12);
        this.batch('box', '#789897', n, .63, sign * (half - .7), .12, 1.05, .12);
      }
    }"""
new = """    // Hard perimeter rails are intentionally gone: WaterWorld now builds walkable sand,
    // wet shoreline and animated surf around the island."""
assert old in renderer
renderer = renderer.replace(old, new, 1)

old = """    this.world.obstacles.forEach((o, i) => {
      if (o.kind === 'tree') {"""
new = """    this.world.obstacles.forEach((o, i) => {
      if (o.assetModel?.startsWith('tree-') || o.assetModel === 'rock-large') return;
      if (o.kind === 'tree') {"""
assert old in renderer
renderer = renderer.replace(old, new, 1)

old = """    this.disposed = true;
    this.crowd.dispose();"""
new = """    this.disposed = true;
    this.environmentModels.dispose();
    this.crowd.dispose();"""
assert old in renderer
renderer = renderer.replace(old, new, 1)
renderer_path.write_text(renderer)

env_path = Path('GTA/Проект/src/render/EnvironmentModels.ts')
env = env_path.read_text()
old = """  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
  }"""
new = """  dispose() {
    // Keep the root attached until GameRenderer traverses the scene and disposes
    // the shared GLB geometry/material resources exactly once.
    this.disposed = true;
  }"""
assert old in env
env_path.write_text(env.replace(old, new, 1))
