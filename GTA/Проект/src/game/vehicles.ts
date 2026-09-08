import type { VehicleModel } from './types';

interface VehicleSpec {
  width: number;
  depth: number;
  wheelRadius: number;
  label: string;
  /** Cab position along local Z, shared by entry and exit placement. */
  entryOffsetZ: number;
}

/** Ground-plane dimensions are shared by the models and their colliders. */
export const VEHICLE_SPECS: Record<VehicleModel, VehicleSpec> = {
  sedan: { width: 2.25, depth: 4.6, wheelRadius: 0.46, label: 'City Cruiser', entryOffsetZ: 0 },
  truck: { width: 2.8, depth: 7.2, wheelRadius: 0.62, label: 'Cargo Truck', entryOffsetZ: 2 },
  pickup: { width: 2.5, depth: 5.8, wheelRadius: 0.54, label: 'Pickup', entryOffsetZ: 0.9 },
  hatchback: { width: 2.1, depth: 3.85, wheelRadius: 0.42, label: 'City Hatchback', entryOffsetZ: 0 },
  sport: { width: 2.3, depth: 4.7, wheelRadius: 0.43, label: 'Sport Coupe', entryOffsetZ: 0 },
};
