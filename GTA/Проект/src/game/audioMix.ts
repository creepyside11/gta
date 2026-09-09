import { clamp } from './collision';
import { driveEfficiency } from './damage';
import type { Vehicle } from './types';

/** Physical speed is m/s. Gear bands produce rev drops instead of a single rising beep. */
export function engineMix(car?: Vehicle) {
  if (!car) return { rpm: 0, gear: 0, firingHz: 30, load: 0, engine: 0, road: 0, skid: 0, rattle: 0 };
  const speed = Math.abs(car.speed), truck = car.model === 'truck';
  const gear = car.speed < -.3 ? -1 : Math.min(5, 1 + Math.floor(speed / 6.5));
  const ratios = [0, 3.3, 2.1, 1.5, 1.15, .94];
  const load = clamp(Math.abs(car.throttle ?? speed / 29), 0, 1);
  const rpm = clamp(780 + speed * (gear < 0 ? 3.2 : ratios[gear]) * (truck ? 100 : 150) + load * 450, 780, truck ? 3500 : 6200);
  const damaged = 1 - (car.damage?.engine ?? 1);
  const alive = driveEfficiency(car) > 0;
  return { rpm, gear, firingHz: rpm / 60 * (truck ? 3 : 2), load,
    engine: alive ? .045 + .035 * load : 0, road: clamp(speed / 29, 0, 1) * .028,
    skid: speed > 3 ? clamp((car.braking ? speed / 18 : 0) + Math.abs(car.steer) * speed / 13 - .45, 0, 1) * .075 : 0,
    rattle: alive ? damaged * .028 : 0 };
}
export function spatialMix(dx: number, dz: number, listenerYaw: number) {
  const distance = Math.hypot(dx, dz);
  return { volume: 1 / (1 + (distance / 22) ** 2),
    pan: clamp((dx * Math.cos(listenerYaw) - dz * Math.sin(listenerYaw)) / Math.max(5, distance), -1, 1) };
}
