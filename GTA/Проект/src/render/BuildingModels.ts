import type { Building } from '../game/types';
import type { Shape } from './VehicleModels';

export type BuildingBatch = (
  shape: Shape, color: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw?: number, shadow?: boolean, tiltZ?: number, tiltX?: number,
) => void;
export type BuildingSign = (
  text: string, width: number, height: number, background: string, foreground: string,
  x: number, y: number, z: number, yaw?: number,
) => void;

const STONE = '#eee4cb';
const GLASS = '#4b737d';
const FRAME = '#d5ddcb';
const DARK = '#37535b';

/** Static architecture shares the city's batches and stays inside its solid footprint. */
export function buildSpecialBuilding(b: Building, batch: BuildingBatch, sign: BuildingSign): boolean {
  if (!b.architecture || b.architecture === 'apartment') return false;
  const { x, z, width: w, depth: d, height: h } = b;
  const wallW = w - 1.2, wallD = d - 1.2;
  const box = (color: string, dx: number, y: number, dz: number, width: number, height: number, depth: number, shadow = true) =>
    batch('box', color, x + dx, y, z + dz, width, height, depth, 0, shadow);
  const frontSign = (text: string, y: number, width = Math.min(wallW - .4, 12), bg = STONE, fg = DARK, dz = wallD / 2 + .075, height = .85) =>
    sign(text.toUpperCase(), width, height, bg, fg, x, y, z + dz);
  const windowFront = (dx: number, y: number, dz: number, width: number, height: number, side = 1, tint = GLASS) => {
    box(STONE, dx, y, dz, width + .22, height + .22, .12, false);
    box(tint, dx, y, dz + side * .075, width, height, .045, false);
    box(FRAME, dx, y, dz + side * .105, .075, height, .035, false);
    box(FRAME, dx, y - height * .1, dz + side * .108, width, .065, .035, false);
  };
  const windowSide = (dx: number, y: number, dz: number, width: number, height: number, side = 1) => {
    box(STONE, dx, y, dz, .12, height + .22, width + .22, false);
    box(GLASS, dx + side * .075, y, dz, .045, height, width, false);
    box(FRAME, dx + side * .105, y, dz, .035, height, .075, false);
  };
  const gable = (dx: number, eave: number, dz: number, width: number, depth: number, rise: number, roof: string, end: string) => {
    const angle = Math.atan2(rise, width / 2);
    for (const side of [-1, 1]) {
      batch('box', roof, x + dx + side * width / 4, eave + rise / 2, z + dz,
        Math.hypot(width / 2, rise), .15, depth, 0, true, -side * angle);
      // Thin, narrowing courses close both gable ends beneath the pitched panels.
      for (let course = 0; course < 10; course++) {
        box(end, dx, eave + (course + .5) * rise / 10, dz + side * (depth / 2 - .12),
          (width - .18) * (1 - (course + .5) / 10), rise / 10, .16);
      }
    }
    box(roof, dx, eave + rise + .045, dz, .22, .14, depth + .04);
  };
  const roofUnit = (dx: number, roofY: number, dz: number, width: number, depth: number, height: number) => {
    box('#7c9291', dx, roofY + height / 2, dz, width, height, depth);
    box('#c1cbbd', dx, roofY + height - .06, dz, width + .12, .12, depth + .12);
    const radius = Math.min(width, depth) * .29;
    batch('cylinder', '#415d64', x + dx, roofY + height + .035, z + dz, radius, .07, radius, 0, false);
    box('#91aaa7', dx, roofY + height + .08, dz, radius * 1.55, .025, .09, false);
    box('#91aaa7', dx, roofY + height + .082, dz, .09, .025, radius * 1.55, false);
  };

  // A continuous plinth makes the complete non-traversable collider visible.
  box('#c7c8b4', 0, .28, 0, w, .32, d);

  if (b.architecture === 'warehouse') {
    const eave = h * .72;
    box(b.color, 0, (eave + .3) / 2, 0, wallW, eave - .3, wallD);
    box('#afbaad', 0, .73, 0, wallW + .14, .58, wallD + .14);
    gable(0, eave, 0, w - .35, d - .3, h * .24, '#637f82', b.color);
    const bays = Math.max(1, Math.floor(wallW / 4.4));
    const spacing = (wallW - .6) / bays;
    const doorW = Math.min(3.7, spacing - .45), doorH = Math.min(4.3, eave * .62);
    for (const side of [-1, 1]) {
      const face = side * (wallD / 2 + .04);
      for (let i = 0; i < bays; i++) {
        const dx = (i - (bays - 1) / 2) * spacing;
        box(STONE, dx, .46 + doorH / 2, face, doorW + .28, doorH + .15, .15);
        // Closed corrugated loading doors, with bumpers and high clerestory glazing.
        box('#6e8587', dx, .46 + doorH / 2, face + side * .1, doorW, doorH, .06, false);
        for (let y = .8; y < doorH + .3; y += .43) box('#a6b5ad', dx, y, face + side * .14, doorW - .1, .045, .03, false);
        box(DARK, dx, .62, face + side * .16, doorW + .12, .22, .19);
        box('#dabc66', dx - doorW / 2 - .17, .82, face + side * .21, .12, .75, .12);
        box('#dabc66', dx + doorW / 2 + .17, .82, face + side * .21, .12, .75, .12);
      }
      for (let p = -wallD / 2 + 1.5; p < wallD / 2 - 1; p += 3.8) {
        windowSide(side * (wallW / 2 + .02), eave - 1.35, p, 2.5, .85, side);
        box('#c3ceba', side * (wallW / 2 + .12), (eave + .3) / 2, p + 1.45, .18, eave - .3, .22);
      }
    }
    frontSign(b.label || 'PORTSIDE FREIGHT', eave - .72, Math.min(wallW - .5, 11.5), '#edf0d7', '#42676e');
    return true;
  }

  if (b.architecture === 'office') {
    const podium = 3.8;
    box(STONE, 0, (podium + .3) / 2, 0, wallW, podium - .3, wallD);
    const tower = (bottom: number, top: number, width: number, depth: number) => {
      box('#648d95', 0, (bottom + top) / 2, 0, width, top - bottom, depth);
      for (const side of [-1, 1]) {
        for (let dx = -width / 2 + .25; dx <= width / 2 - .1; dx += 2.35) {
          box('#b5cac0', dx, (bottom + top) / 2, side * (depth / 2 + .025), .095, top - bottom, .075, false);
        }
        for (let dz = -depth / 2 + .25; dz <= depth / 2 - .1; dz += 2.35) {
          box('#b5cac0', side * (width / 2 + .025), (bottom + top) / 2, dz, .075, top - bottom, .095, false);
        }
      }
      for (let y = bottom + .3; y < top - .1; y += 3.1) {
        box(b.color, 0, y, 0, width + .18, .22, depth + .18);
        for (const side of [-1, 1]) {
          for (let dx = -width / 2 + 1.4; dx < width / 2 - .6; dx += 4.7) {
            const paneH = Math.min(2.3, top - y - .3);
            if (paneH > .25) box('#7fa3a9', dx, y + .2 + paneH / 2, side * (depth / 2 + .008), 1.5, paneH, .025, false);
          }
        }
      }
      box(STONE, 0, top - .12, 0, width + .3, .24, depth + .3);
    };
    tower(podium, h * .7, w - 2, d - 2);
    tower(h * .7, h - 1.5, (w - 2) * .73, (d - 2) * .73);
    roofUnit(0, h - 1.48, 0, Math.min(3.2, wallW * .32), Math.min(3.6, wallD * .35), 1.25);
    for (const side of [-1, 1]) {
      for (let dx = -wallW / 2 + 1.6; dx < wallW / 2 - 1; dx += 3.2) windowFront(dx, 1.9, side * (wallD / 2 + .025), 2.15, 2.65, side);
      for (let dz = -wallD / 2 + 1.6; dz < wallD / 2 - 1; dz += 3.2) windowSide(side * (wallW / 2 + .025), 1.9, dz, 2.15, 2.65, side);
    }
    box('#527d80', 0, 3.45, wallD / 2 + .17, Math.min(6.5, wallW - .2), .19, .7);
    frontSign(b.label || 'HARBOR OFFICES', 3.82, Math.min(wallW - .5, 9), STONE, DARK, wallD / 2 + .18, .52);
    return true;
  }

  if (b.architecture === 'townhouse') {
    const eave = h * .68, rise = h * .25;
    const count = Math.max(1, Math.floor(wallW / 4.8));
    const unit = wallW / count;
    box(b.color, 0, (eave + .3) / 2, 0, wallW, eave - .3, wallD);
    for (let i = 0; i < count; i++) {
      const dx = (i - (count - 1) / 2) * unit;
      const paint = i % 3 === 1 ? '#e4c8a2' : i % 3 === 2 ? '#a8bab0' : b.color;
      for (const side of [-1, 1]) {
        const face = side * (wallD / 2 + .035);
        box(paint, dx, (eave + .3) / 2, face, unit - .035, eave - .3, .1);
        box(STONE, dx, eave * .51, face + side * .06, unit, .14, .11);
        windowFront(dx + unit * .22, eave * .27, face + side * .025, Math.min(1.15, unit * .23), eave * .27, side);
        for (const offset of [-.23, .23]) {
          const px = dx + unit * offset, windowW = Math.min(1.1, unit * .22);
          windowFront(px, eave * .75, face + side * .025, windowW, eave * .25, side);
          for (const shutter of [-1, 1]) box('#5c8580', px + shutter * (windowW / 2 + .22), eave * .75, face + side * .1, .23, eave * .27, .075, false);
        }
        // Framed, closed doors sit against the solid house wall.
        box(STONE, dx - unit * .23, 1.48, face + side * .04, 1.32, 2.12, .13);
        box('#456d71', dx - unit * .23, 1.44, face + side * .13, 1.08, 1.98, .07, false);
        box('#b7cec2', dx - unit * .23, 1.93, face + side * .17, .65, .55, .03, false);
        box('#cbb480', dx - unit * .23 + .33, 1.35, face + side * .18, .07, .16, .045, false);
        box(STONE, dx - unit * .23, .42, face + side * .15, 1.5, .16, .49);
      }
      gable(dx, eave, 0, unit + .15, d - .28, rise, i % 2 ? '#ad705c' : '#697f7e', paint);
      const chimneyBottom = eave + rise * .42;
      box('#c29279', dx + unit * .23, (chimneyBottom + h - .22) / 2, -wallD * .22, .48, h - .22 - chimneyBottom, .58);
      box(STONE, dx + unit * .23, h - .15, -wallD * .22, .67, .16, .76);
    }
    for (const side of [-1, 1]) {
      for (let dz = -wallD / 2 + 2; dz < wallD / 2 - 1.5; dz += 3.8) windowSide(side * (wallW / 2 + .03), eave * .75, dz, 1.25, eave * .25, side);
    }
    return true;
  }

  if (b.architecture === 'supermarket') {
    const roof = h * .74;
    box('#e6d7b7', 0, (roof + .3) / 2, 0, wallW, roof - .3, wallD);
    box('#75958d', 0, .82, 0, wallW + .1, .72, wallD + .1);
    box('#3e8175', 0, roof - .55, 0, wallW + .19, 1, wallD + .19);
    box(STONE, 0, roof + .03, 0, w - .35, .24, d - .35);
    box('#aab4a3', 0, roof + .18, 0, wallW - .2, .1, wallD - .2);
    const panes = Math.max(2, Math.floor(wallW / 2.8));
    const spacing = (wallW - .8) / panes;
    for (const side of [-1, 1]) {
      for (let i = 0; i < panes; i++) {
        windowFront((i - (panes - 1) / 2) * spacing, 1.9, side * (wallD / 2 + .04), spacing - .22, 2.45, side, '#608781');
      }
      box('#d3bc78', 0, 3.17, side * (wallD / 2 + .2), wallW + .2, .16, .66);
      for (const dx of [-1.6, 1.6]) box('#d8b663', dx, .89, side * (wallD / 2 + .36), .16, .88, .16);
      for (let dz = -wallD / 2 + 2; dz < wallD / 2 - 1.5; dz += 4.5) {
        windowSide(side * (wallW / 2 + .03), 2.24, dz, 2.7, 1.6, side);
      }
    }
    const unitHeight = Math.max(.55, h - roof - .46);
    for (const side of [-1, 1]) roofUnit(side * wallW * .22, roof + .23, -wallD * .13, Math.min(2.6, wallW * .23), Math.min(3, wallD * .3), unitHeight);
    frontSign(b.label || 'PORTSIDE MARKET', roof - .56, Math.min(wallW - .5, 12.5), '#3e8175', '#f1e7cc', wallD / 2 + .135, .75);
    sign('FRESH  /  DAILY', Math.min(wallD - 1, 6.5), .6, '#3e8175', '#f1e7cc', x - wallW / 2 - .135, roof - .56, z, -Math.PI / 2);
    return true;
  }

  if (b.architecture === 'civic') {
    const bodyH = h * .46, bodyD = d - 1.8;
    box('#e5d4b2', 0, (bodyH + .3) / 2, -.15, wallW, bodyH - .3, bodyD);
    box(STONE, 0, bodyH - .05, -.15, wallW + .3, .3, bodyD + .35);
    const face = bodyD / 2 - .15;
    for (let step = 0; step < 3; step++) box(STONE, 0, .2 + step * .12, d / 2 - .64 - step * .1, wallW * .86 - step * .2, .16, 1.28 - step * .2);
    box('#c9bda1', 0, .59, face + .23, wallW * .86, .25, .82);
    const columns = wallW > 14 ? 6 : 4;
    for (let i = 0; i < columns; i++) {
      const dx = (i / (columns - 1) - .5) * wallW * .78;
      batch('cylinder', STONE, x + dx, (bodyH + .55) / 2, z + face + .38, .21, bodyH - .55, .21);
      box('#f1e7ce', dx, .83, face + .38, .6, .3, .57);
      box('#f1e7ce', dx, bodyH - .15, face + .38, .64, .3, .58);
    }
    gable(0, bodyH + .12, face + .22, wallW + .35, 1, h * .1, '#7d9188', STONE);
    box(STONE, 0, 2.02, face + .045, 2.05, 3.07, .15);
    box('#52787a', 0, 1.95, face + .14, 1.75, 2.91, .05, false);
    box('#c6c7a3', 0, 1.94, face + .18, .075, 2.88, .03, false);
    for (const side of [-1, 1]) {
      windowFront(side * wallW * .3, bodyH * .48, face + .045, 1.3, bodyH * .47);
      for (let dz = -bodyD / 2 + 1.8; dz < bodyD / 2 - 1.2; dz += 3.5) windowSide(side * (wallW / 2 + .03), bodyH * .51, dz - .15, 1.4, bodyH * .46, side);
      windowFront(side * wallW * .28, bodyH * .5, -bodyD / 2 - .2, 1.5, bodyH * .46, -1);
    }
    const nameplateWidth = Math.min(wallW * .73, 10);
    box(STONE, 0, bodyH - .82, face + .64, nameplateWidth + .12, .75, .09);
    frontSign(b.label || 'CITY HALL', bodyH - .82, nameplateWidth, STONE, DARK, face + .7, .67);
    const towerW = Math.min(4.2, wallW * .38), towerD = Math.min(4.2, bodyD * .42);
    const towerBase = bodyH + .1, towerTop = h * .87, towerZ = -d * .12;
    box('#e7dfc6', 0, (towerBase + towerTop) / 2, towerZ, towerW, towerTop - towerBase, towerD);
    for (const y of [towerBase + .15, h * .65, towerTop - .12]) box(STONE, 0, y, towerZ, towerW + .35, .25, towerD + .35);
    const clockY = h * .765;
    batch('cylinder', DARK, x, clockY, z + towerZ + towerD / 2 + .045, .73, .085, .73, 0, false, 0, Math.PI / 2);
    batch('cylinder', '#f2eacb', x, clockY, z + towerZ + towerD / 2 + .105, .62, .05, .62, 0, false, 0, Math.PI / 2);
    box(DARK, 0, clockY + .18, towerZ + towerD / 2 + .143, .075, .42, .035, false);
    box(DARK, .15, clockY, towerZ + towerD / 2 + .145, .36, .075, .035, false);
    batch('cone', '#63877e', x, (towerTop + h - .05) / 2, z + towerZ, towerW * .69, h - .05 - towerTop, towerD * .69);
    return true;
  }

  return false;
}
