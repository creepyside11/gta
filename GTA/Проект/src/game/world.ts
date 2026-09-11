import { boxIntersects, circleIntersectsBox } from './collision';
import { populateStreetFurniture } from './streetFurniture';
import type { Building, BuildingArchitecture, Solid, World, WorldDistrict } from './types';

const PALETTE = ['#d6a38b', '#7aaba4', '#e3c89b', '#b8bfc0', '#d18e74', '#8ca9b7', '#c3ac91', '#9fb29c'];
const LEGACY_SIZE = 284 * Math.SQRT2;
const LEGACY_ROADS = [-160, -80, 0, 80, 160];
const METRO_SIZE = 960;
const METRO_ROADS = [-400, -320, -160, -80, 0, 80, 160, 320, 400];

/** A deterministic metro region: visuals and simulation share these exact footprints. */
export function createWorld(): World {
  // Build the original island first so its streets, mission locations and scenery remain unchanged.
  const world: World = {
    size: LEGACY_SIZE,
    roads: [...LEGACY_ROADS],
    roadWidth: 18,
    buildings: [],
    obstacles: [],
    districts: [{ id: 'portside-core', name: 'PORTSIDE', x: 0, z: 0, width: 410, depth: 410, kind: 'downtown' }],
    pickup: { x: 14, z: 40 },
    destination: { x: 80, z: -58 },
    restricted: { x: -100, z: -110, radius: 14 },
  };
  const plaza = { x: 22.5, z: 40, width: 29, depth: 30, yaw: 0 };
  const reserved = (solid: Solid): boolean =>
    boxIntersects(solid, plaza) ||
    circleIntersectsBox(world.restricted.x, world.restricted.z, 17, solid);

  const addBuilding = (x: number, z: number, width: number, depth: number, seed: number, label?: string): void => {
    const building: Building = {
      id: `building-${world.buildings.length}`, kind: 'building', x, z,
      width, depth, height: 7 + (seed * 7 + 3) % 17, yaw: 0,
      color: PALETTE[seed % PALETTE.length], style: seed % 4,
      ...(label ? { label } : {}),
    };
    if (!reserved(building)) world.buildings.push(building);
  };

  // Normalized courtyard arrangements; outer blocks are clipped by the original city edge.
  const layouts = [
    [[.24, .34, .36, .50], [.73, .65, .36, .52]],
    [[.31, .25, .52, .32], [.23, .72, .34, .36], [.73, .72, .36, .36]],
    [[.50, .25, .82, .32], [.33, .70, .48, .44]],
    [[.25, .50, .32, .80], [.73, .25, .36, .32], [.73, .72, .36, .36]],
  ];
  const centers = [-120, -40, 40, 120];
  const span = (center: number): [number, number] => {
    if (center === -120) return [-128, -96];
    if (center === 120) return [96, 128];
    return [center - 24, center + 24];
  };
  for (let ix = 0; ix < centers.length; ix++) {
    for (let iz = 0; iz < centers.length; iz++) {
      const [x0, x1] = span(centers[ix]);
      const [z0, z1] = span(centers[iz]);
      const seed = ix * 4 + iz;
      if (ix === 0 && iz === 0) {
        // Leave the restricted compound open so trespassing is an explicit choice.
        addBuilding(-123, -123, 10, 8, seed, 'DEPOT');
        addBuilding(-124, -100, 8, 8, seed + 1);
      } else if (ix === 2 && iz === 2) {
        // Courier pickup, starting player, and pavement approach stay unobstructed.
        addBuilding(51, 34, 20, 24, seed, 'COURIER');
        addBuilding(51, 60, 24, 8, seed + 1, 'CAFE');
        addBuilding(24, 20, 14, 8, seed + 2);
      } else {
        const layout = layouts[(ix * 3 + iz) % layouts.length];
        layout.forEach(([x, z, width, depth], index) => {
          addBuilding(
            x0 + x * (x1 - x0), z0 + z * (z1 - z0),
            width * (x1 - x0), depth * (z1 - z0), seed * 3 + index,
            (seed + index) % 7 === 0 ? ['MARKET', 'HOTEL', 'STUDIO'][(seed + index) % 3] : undefined,
          );
        });
      }

      // Small street-facing gardens; tree collision covers the trunk, not canopy.
      const spots = [
        { x: x0 + 1.2, z: z0 + 1.2 },
        { x: x1 - 1.2, z: z1 - 1.2 },
        { x: x1 - 1.2, z: z0 + (z1 - z0) * .48 },
      ];
      spots.forEach((spot, index) => {
        const obstacle: Solid = {
          id: `garden-${ix}-${iz}-${index}`, ...spot, yaw: 0,
          kind: index === 2 && seed % 3 === 0 ? 'planter' : 'tree',
          width: index === 2 && seed % 3 === 0 ? 2 : .85,
          depth: index === 2 && seed % 3 === 0 ? 2 : .85,
          height: index === 2 && seed % 3 === 0 ? .7 : 4 + seed % 3,
          color: index === 2 && seed % 3 === 0 ? '#bba886' : '#538b72',
        };
        if (!reserved(obstacle) && !world.buildings.some(building => boxIntersects(building, obstacle, .6))) {
          world.obstacles.push(obstacle);
        }
      });
    }
  }
  const furniture = [{ x: 15, z: 60 }, { x: -14.8, z: 32 }, { x: 94.5, z: -51 }, { x: -94.5, z: 55 }];
  furniture.forEach((position, index) => {
    const bench: Solid = { id: `bench-${index}`, kind: 'bench', ...position, yaw: 0, width: .8, depth: 2.2, height: 1.4, color: '#b28a5b' };
    const bin: Solid = { id: `bin-${index}`, kind: 'bin', x: position.x, z: position.z + 2.1, yaw: 0, width: .78, depth: .78, height: 1.2, color: '#507b72' };
    for (const solid of [bench, bin]) {
      if (![...world.buildings, ...world.obstacles].some(other => boxIntersects(solid, other, .2))) world.obstacles.push(solid);
    }
  });

  // Keep the existing enlarged downtown exactly as it was before growing the regional map.
  populateExpansion(world);
  populateStreetFurniture(world);
  populateMetroCities(world);
  return world;
}

/** Extend the original downtown around its first four blocks without moving legacy colliders. */
function populateExpansion(world: World): void {
  const edge = LEGACY_SIZE / 2;
  const outerLotEnd = edge - 14;
  const outerLotWidth = outerLotEnd - 176;
  const spans: [number, number][] = [
    [-outerLotEnd, -176], [-144, -96], [-64, -16],
    [16, 64], [96, 144], [176, outerLotEnd],
  ];
  const originalBuildingCount = world.buildings.length;
  const originalObstacleCount = world.obstacles.length;

  const clearLot = (solid: Solid): boolean => {
    const extentX = (Math.abs(Math.cos(solid.yaw)) * solid.width + Math.abs(Math.sin(solid.yaw)) * solid.depth) / 2;
    const extentZ = (Math.abs(Math.sin(solid.yaw)) * solid.width + Math.abs(Math.cos(solid.yaw)) * solid.depth) / 2;
    if (Math.abs(solid.x) + extentX >= edge - 3 || Math.abs(solid.z) + extentZ >= edge - 3) return false;
    if (LEGACY_ROADS.some(road => Math.abs(solid.x - road) - extentX < 12.8 || Math.abs(solid.z - road) - extentZ < 12.8)) return false;
    return ![...world.buildings, ...world.obstacles].some(other => boxIntersects(solid, other, .2));
  };

  const addBuilding = (x: number, z: number, width: number, depth: number, architecture: BuildingArchitecture, seed: number): void => {
    const heights: Record<BuildingArchitecture, number> = {
      apartment: 13 + seed % 4 * 2, warehouse: 9 + seed % 3,
      office: 24 + seed % 3 * 3, townhouse: 7 + seed % 4,
      supermarket: 6 + seed % 3, civic: 14 + seed % 3 * 2,
    };
    const labels: Partial<Record<BuildingArchitecture, string>> = {
      warehouse: 'FREIGHT', office: 'PORTSIDE', supermarket: 'MARKET', civic: seed % 2 ? 'LIBRARY' : 'CITY HALL',
    };
    const building: Building = {
      id: `district-building-${world.buildings.length - originalBuildingCount}`, kind: 'building',
      x, z, width, depth, height: heights[architecture], yaw: 0,
      color: PALETTE[(seed + 3) % PALETTE.length], style: seed % 4, architecture,
      ...(labels[architecture] ? { label: labels[architecture] } : {}),
    };
    if (clearLot(building)) world.buildings.push(building);
  };

  const addProp = (x: number, z: number, kind: 'tree' | 'planter' | 'bench' | 'bin', seed: number, yaw = 0): void => {
    const sizes = { tree: [.85, .85, 4 + seed % 3], planter: [2, 2, .7], bench: [.8, 2.2, 1.4], bin: [.78, .78, 1.2] };
    const [width, depth, height] = sizes[kind];
    const colors = { tree: '#538b72', planter: '#bba886', bench: '#b28a5b', bin: '#507b72' };
    const obstacle: Solid = {
      id: `district-${kind}-${world.obstacles.length - originalObstacleCount}`, kind,
      x, z, width, depth, height, yaw, color: colors[kind],
    };
    if (clearLot(obstacle)) world.obstacles.push(obstacle);
  };

  for (let ix = 0; ix < spans.length; ix++) {
    for (let iz = 0; iz < spans.length; iz++) {
      const outerX = ix === 0 || ix === spans.length - 1;
      const outerZ = iz === 0 || iz === spans.length - 1;
      if (!outerX && !outerZ) continue;
      const [x0, x1] = spans[ix];
      const [z0, z1] = spans[iz];
      const x = (x0 + x1) / 2;
      const z = (z0 + z1) / 2;
      const seed = ix * 6 + iz;
      if (outerX && outerZ) {
        addBuilding(x, z, outerLotWidth, outerLotWidth, 'civic', seed);
        addProp(Math.sign(x) * (edge - 8), z, 'tree', seed);
        addProp(x, Math.sign(z) * (edge - 8), 'planter', seed + 1);
        continue;
      }
      for (let index = 0; index < 2; index++) {
        const along = .25 + index * .5;
        const architectures: BuildingArchitecture[] = ['townhouse', 'apartment', 'townhouse', 'supermarket'];
        const architecture = architectures[(seed + index) % architectures.length];
        addBuilding(
          outerX ? x : x0 + (x1 - x0) * along,
          outerZ ? z : z0 + (z1 - z0) * along,
          outerX ? outerLotWidth : 18,
          outerZ ? outerLotWidth : 18,
          architecture, seed + index,
        );
      }
      const exterior = Math.sign(outerX ? x : z) * (edge - 8);
      if (seed % 3 === 0) {
        addProp(outerX ? exterior : x, outerZ ? exterior : z, 'bench', seed, outerX ? 0 : Math.PI / 2);
        addProp(outerX ? exterior : x + 3.2, outerZ ? exterior : z + 3.2, 'bin', seed);
      } else {
        for (const offset of [-10, 10]) addProp(
          outerX ? exterior : x + offset, outerZ ? exterior : z + offset,
          offset > 0 && seed % 2 === 0 ? 'planter' : 'tree', seed,
        );
      }
    }
  }

  for (const axis of ['x', 'z'] as const) {
    for (const sign of [-1, 1]) {
      for (const along of [-40, 40]) {
        const seed = (axis === 'x' ? 40 : 44) + (sign + 1) + (along > 0 ? 1 : 0);
        const x = axis === 'x' ? sign * 139 : along;
        const z = axis === 'z' ? sign * 139 : along;
        addBuilding(x, z, axis === 'x' ? 14 : 24, axis === 'z' ? 14 : 24, along < 0 ? 'warehouse' : 'office', seed);
        for (const offset of [-17, 17]) addProp(
          axis === 'x' ? x : x + offset, axis === 'z' ? z : z + offset,
          offset < 0 ? 'tree' : 'planter', seed,
        );
      }
    }
  }
}

/** Grow Portside into a large regional map with four satellite cities and long highway corridors. */
function populateMetroCities(world: World): void {
  world.size = METRO_SIZE;
  world.roads = [...METRO_ROADS];
  world.districts = [
    { id: 'portside-core', name: 'PORTSIDE', x: 0, z: 0, width: 410, depth: 410, kind: 'downtown' },
    { id: 'vice-beach', name: 'VICE BEACH', x: 320, z: 0, width: 250, depth: 370, kind: 'beach' },
    { id: 'west-harbor', name: 'WEST HARBOR', x: -320, z: 0, width: 250, depth: 370, kind: 'industrial' },
    { id: 'northside', name: 'NORTHSIDE', x: 0, z: -320, width: 370, depth: 250, kind: 'residential' },
    { id: 'sunport', name: 'SUNPORT', x: 0, z: 320, width: 370, depth: 250, kind: 'airport' },
  ];

  // One clear residential block in every satellite city is reserved for local pedestrians.
  const pedestrianReserves = [
    { x: 360, z: 40, width: 64, depth: 64, yaw: 0 },
    { x: -360, z: -40, width: 64, depth: 64, yaw: 0 },
    { x: -40, z: -360, width: 64, depth: 64, yaw: 0 },
    { x: 40, z: 360, width: 64, depth: 64, yaw: 0 },
  ];
  const edge = METRO_SIZE / 2;
  let buildingSerial = 0;
  let propSerial = 0;

  const clearMetro = (solid: Solid): boolean => {
    const extentX = (Math.abs(Math.cos(solid.yaw)) * solid.width + Math.abs(Math.sin(solid.yaw)) * solid.depth) / 2;
    const extentZ = (Math.abs(Math.sin(solid.yaw)) * solid.width + Math.abs(Math.cos(solid.yaw)) * solid.depth) / 2;
    if (Math.abs(solid.x) + extentX >= edge - 10 || Math.abs(solid.z) + extentZ >= edge - 10) return false;
    if (METRO_ROADS.some(road => Math.abs(solid.x - road) - extentX < 12.8 || Math.abs(solid.z - road) - extentZ < 12.8)) return false;
    if (pedestrianReserves.some(area => boxIntersects(solid, area, .8))) return false;
    return ![...world.buildings, ...world.obstacles].some(other => boxIntersects(solid, other, .35));
  };

  const districtById = (id: string): WorldDistrict => world.districts.find(district => district.id === id)!;
  const architectureFor = (district: WorldDistrict, seed: number): BuildingArchitecture => {
    const options: Record<WorldDistrict['kind'], BuildingArchitecture[]> = {
      downtown: ['office', 'apartment'],
      beach: ['apartment', 'office', 'townhouse', 'supermarket'],
      industrial: ['warehouse', 'warehouse', 'office', 'supermarket'],
      residential: ['townhouse', 'apartment', 'civic', 'supermarket'],
      airport: ['warehouse', 'office', 'supermarket', 'civic'],
    };
    const list = options[district.kind];
    return list[seed % list.length];
  };

  const addMetroBuilding = (districtId: string, x: number, z: number, width: number, depth: number, seed: number, label?: string): void => {
    const district = districtById(districtId);
    const architecture = architectureFor(district, seed);
    const heights: Record<BuildingArchitecture, number> = {
      apartment: 14 + seed % 4 * 2, warehouse: 9 + seed % 3,
      office: district.kind === 'beach' ? 25 + seed % 4 * 3 : 22 + seed % 3 * 3,
      townhouse: 7 + seed % 4, supermarket: 6 + seed % 3, civic: 14 + seed % 4 * 2,
    };
    const building: Building = {
      id: `metro-${districtId}-building-${buildingSerial++}`, kind: 'building', x, z,
      width, depth, height: heights[architecture], yaw: 0,
      color: PALETTE[(seed + districtId.length) % PALETTE.length], style: seed % 4, architecture,
      ...(label ? { label } : {}),
    };
    if (clearMetro(building)) world.buildings.push(building);
  };

  const addMetroProp = (districtId: string, x: number, z: number, kind: 'tree' | 'planter' | 'bench' | 'bin', seed: number, yaw = 0): void => {
    const sizes = { tree: [.85, .85, 5 + seed % 3], planter: [1.8, 2.6, .7], bench: [.8, 2.2, 1.4], bin: [.78, .78, 1.2] };
    const [width, depth, height] = sizes[kind];
    const colors = { tree: '#538b72', planter: '#c1ad8d', bench: '#b28a5b', bin: '#507b72' };
    const prop: Solid = { id: `metro-${districtId}-${kind}-${propSerial++}`, kind, x, z, width, depth, height, yaw, color: colors[kind] };
    if (clearMetro(prop)) world.obstacles.push(prop);
  };

  const rows = [-120, -40, 40, 120];
  rows.forEach((z, row) => {
    for (const [slot, x] of [215, 265, 360].entries()) addMetroBuilding('vice-beach', x, z, slot === 2 ? 30 : 32, 34, row * 3 + slot,
      row === 0 && slot === 2 ? 'OCEAN HOTEL' : row === 3 && slot === 0 ? 'NEON PLAZA' : undefined);
    for (const [slot, x] of [-360, -265, -215].entries()) addMetroBuilding('west-harbor', x, z, slot === 0 ? 32 : 34, 36, 20 + row * 3 + slot,
      row === 1 && slot === 1 ? 'WEST DOCKS' : row === 3 && slot === 2 ? 'FREIGHT HUB' : undefined);
  });

  const columns = [-120, -40, 40, 120];
  columns.forEach((x, column) => {
    for (const [slot, z] of [-360, -265, -215].entries()) addMetroBuilding('northside', x, z, 36, slot === 0 ? 30 : 32, 40 + column * 3 + slot,
      column === 0 && slot === 1 ? 'NORTHSIDE' : column === 3 && slot === 2 ? 'CIVIC CENTER' : undefined);
    for (const [slot, z] of [215, 265, 360].entries()) addMetroBuilding('sunport', x, z, 38, slot === 2 ? 30 : 34, 60 + column * 3 + slot,
      column === 1 && slot === 1 ? 'SUNPORT' : column === 3 && slot === 0 ? 'AIR CARGO' : undefined);
  });

  // Each satellite gets its own palms, benches and planted median pockets without filling the highway gaps.
  const sideSlots = [-140, -100, -60, 20, 100, 140];
  sideSlots.forEach((along, index) => {
    const kind = index % 3 === 0 ? 'bench' : index % 3 === 1 ? 'tree' : 'planter';
    addMetroProp('vice-beach', 292, along, kind, 100 + index, Math.PI / 2);
    addMetroProp('west-harbor', -292, -along, kind, 110 + index, -Math.PI / 2);
    addMetroProp('northside', -along, -292, kind, 120 + index, 0);
    addMetroProp('sunport', along, 292, kind, 130 + index, Math.PI);
  });

  // Landmark rows make the four satellite skylines readable from the long approaches.
  addMetroBuilding('vice-beach', 440, -120, 28, 38, 151, 'MARINA');
  addMetroBuilding('vice-beach', 440, 120, 28, 38, 152, 'BEACH CLUB');
  addMetroBuilding('west-harbor', -440, -120, 28, 40, 153, 'SHIPYARD');
  addMetroBuilding('west-harbor', -440, 120, 28, 40, 154, 'CONTAINER CO');
  addMetroBuilding('northside', -120, -440, 40, 28, 155, 'NORTH MALL');
  addMetroBuilding('northside', 120, -440, 40, 28, 156, 'ARENA');
  addMetroBuilding('sunport', -120, 440, 42, 28, 157, 'TERMINAL');
  addMetroBuilding('sunport', 120, 440, 42, 28, 158, 'AIR FREIGHT');
}