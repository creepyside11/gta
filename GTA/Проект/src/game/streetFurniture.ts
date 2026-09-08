import { boxIntersects, circleIntersectsBox } from './collision';
import type { Box } from './collision';
import type { Point, Solid, World } from './types';

type FurnitureKind = 'tree' | 'planter' | 'bench' | 'bin';
type StreetAxis = 'x' | 'z';

/** Plant and furnish the existing city without moving buildings or pedestrian routes. */
export function populateStreetFurniture(world: World): void {
  if (world.obstacles.some(obstacle => obstacle.id.startsWith('streetscape-'))) return;
  const edge = world.size / 2;
  const promenade = edge - 11.3;
  const reserved: Box[] = [
    { x: 22.5, z: 40, width: 29, depth: 30, yaw: 0 },
    ...[-131, 131].flatMap(line => [
      { x: line, z: 0, width: 1.5, depth: 284, yaw: 0 },
      { x: 0, z: line, width: 284, depth: 1.5, yaw: 0 },
    ]),
    ...[-promenade, promenade].flatMap(line => [
      { x: line, z: 0, width: 1.5, depth: world.size, yaw: 0 },
      { x: 0, z: line, width: world.size, depth: 1.5, yaw: 0 },
    ]),
  ];
  let serial = 0;

  const fits = (solid: Solid): boolean => {
    const extentX = (Math.abs(Math.cos(solid.yaw)) * solid.width + Math.abs(Math.sin(solid.yaw)) * solid.depth) / 2;
    const extentZ = (Math.abs(Math.sin(solid.yaw)) * solid.width + Math.abs(Math.cos(solid.yaw)) * solid.depth) / 2;
    if (Math.abs(solid.x) + extentX >= edge - 3 || Math.abs(solid.z) + extentZ >= edge - 3) return false;
    // This also preserves the player's original x=13 pavement approach.
    if (world.roads.some(road => Math.abs(solid.x - road) - extentX < 12.8 || Math.abs(solid.z - road) - extentZ < 12.8)) return false;
    if (reserved.some(area => boxIntersects(solid, area))) return false;
    if (circleIntersectsBox(world.restricted.x, world.restricted.z, 17, solid)) return false;
    if ([...world.buildings, ...world.obstacles].some(other => boxIntersects(solid, other, .2))) return false;
    if (solid.kind === 'tree') {
      // A trunk may fit where its crown would cut through a facade. Use a low
      // flowerbed at these narrow frontages instead of burying leaves in walls.
      if (world.buildings.some(building => circleIntersectsBox(solid.x, solid.z, 2.5, building))) return false;
      if (world.obstacles.some(other => other.kind === 'tree' && Math.hypot(other.x - solid.x, other.z - solid.z) < 4.8)) return false;
    }
    return true;
  };

  const add = (point: Point, kind: FurnitureKind, seed: number, yaw = 0): boolean => {
    const dimensions: Record<FurnitureKind, [number, number, number]> = {
      tree: [.85, .85, 4 + seed % 3],
      planter: [1.35, seed % 2 ? 3.1 : 2.3, .62],
      bench: [.8, 2.2, 1.4], bin: [.78, .78, 1.2],
    };
    const [width, depth, height] = dimensions[kind];
    const colors: Record<FurnitureKind, string[]> = {
      tree: ['#538b72', '#688d59', '#729660'],
      planter: ['#c4b197', '#b9ad97', '#bd9d86'],
      bench: ['#b28a5b', '#ad835b', '#bc936b'],
      bin: ['#507b72', '#526f70'],
    };
    const palette = colors[kind];
    const solid: Solid = {
      id: `streetscape-${kind}-${serial}`, ...point, kind,
      width, depth, height, yaw, color: palette[seed % palette.length],
    };
    if (!fits(solid)) return false;
    world.obstacles.push(solid);
    serial++;
    return true;
  };

  const pointOnRow = (axis: StreetAxis, across: number, along: number): Point =>
    axis === 'z' ? { x: across, z: along } : { x: along, z: across };
  const streetFacing = (axis: StreetAxis, side: number): number =>
    axis === 'z' ? side > 0 ? 0 : Math.PI : -side * Math.PI / 2;

  // Three evenly spaced stations on each 80m frontage leave wide gaps between
  // planted beds. Benches face the street and have a bin within easy reach.
  const alongSlots: number[] = [];
  const roads = [...world.roads].sort((a, b) => a - b);
  alongSlots.push((roads[0] - edge) / 2);
  for (let index = 0; index < roads.length - 1; index++) {
    const start = roads[index], span = roads[index + 1] - start;
    for (const fraction of [.3, .5, .7]) alongSlots.push(start + span * fraction);
  }
  alongSlots.push((roads[roads.length - 1] + edge) / 2);
  for (const [roadIndex, road] of roads.entries()) {
    for (const [axisIndex, axis] of (['z', 'x'] as const).entries()) {
      for (const side of [-1, 1]) {
        const across = road + side * 14.8;
        const yaw = streetFacing(axis, side);
        for (const [slot, along] of alongSlots.entries()) {
          const seed = roadIndex * 19 + axisIndex * 11 + (side + 1) * 3 + slot;
          const point = pointOnRow(axis, across, along);
          const kind: FurnitureKind = seed % 4 === 0 ? 'bench' : seed % 4 === 2 ? 'planter' : 'tree';
          if (add(point, kind, seed, yaw)) {
            if (kind === 'bench') add(pointOnRow(axis, across, along + 3.2), 'bin', seed + 1, yaw);
          } else if (kind !== 'planter') add(point, 'planter', seed, yaw);
        }
      }
    }
  }

  // The seaward side of the perimeter path alternates shaded planting with
  // seats looking out over the water. Its pedestrian centerline remains open.
  for (const [axisIndex, axis] of (['z', 'x'] as const).entries()) {
    for (const side of [-1, 1]) {
      const across = side * (edge - 6);
      const yaw = streetFacing(axis, -side);
      for (let along = -176, slot = 0; along <= 176; along += 16, slot++) {
        const seed = axisIndex * 31 + (side + 1) * 7 + slot;
        const point = pointOnRow(axis, across, along);
        const kind: FurnitureKind = seed % 3 === 0 ? 'bench' : seed % 3 === 1 ? 'tree' : 'planter';
        if (add(point, kind, seed, yaw)) {
          if (kind === 'bench') add(pointOnRow(axis, across, along + 3.2), 'bin', seed, yaw);
        } else if (kind === 'tree') add(point, 'planter', seed, yaw);
      }
    }
  }

  // Free courtyard pockets become small seating gardens. Leave generous space
  // around each seat so a successful placement does not block a narrow passage.
  for (let ix = 0; ix < roads.length - 1; ix++) {
    for (let iz = 0; iz < roads.length - 1; iz++) {
      const center = { x: (roads[ix] + roads[ix + 1]) / 2, z: (roads[iz] + roads[iz + 1]) / 2 };
      const seed = ix * 7 + iz * 3;
      const yaw = seed % 2 ? Math.PI / 2 : 0;
      const axis: StreetAxis = seed % 2 ? 'x' : 'z';
      const candidates = [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12], [-12, -12], [12, 12]];
      for (const [dx, dz] of candidates) {
        const point = { x: center.x + dx, z: center.z + dz };
        if (world.buildings.some(building => circleIntersectsBox(point.x, point.z, 3.2, building))) continue;
        if (!add(point, 'bench', seed, yaw)) continue;
        const along = axis === 'z' ? point.z : point.x;
        const across = axis === 'z' ? point.x : point.z;
        add(pointOnRow(axis, across, along + 3.4), 'planter', seed + 1, yaw);
        add(pointOnRow(axis, across, along - 3.2), 'bin', seed + 2, yaw);
        add(pointOnRow(axis, across + 4.2, along), 'tree', seed + 3);
        break;
      }
    }
  }
}
