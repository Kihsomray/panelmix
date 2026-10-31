/**
 * Magnetic variation from a precomputed WMM-2025 grid (see scripts/build-navdata.mjs).
 * East variation is positive: magnetic = true - variation.
 */

export interface MagvarGrid {
  readonly v: 1;
  readonly model: string;
  readonly date: string;
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
  readonly step: number;
  readonly values: readonly number[];
}

export class MagneticModel {
  private readonly cols: number;
  private readonly rows: number;

  constructor(private readonly grid: MagvarGrid) {
    this.cols = Math.round((grid.east - grid.west) / grid.step) + 1;
    this.rows = Math.round((grid.north - grid.south) / grid.step) + 1;
    if (grid.values.length !== this.cols * this.rows) throw new Error('Magnetic grid size mismatch');
  }

  /** Variation in degrees at a point, bilinear between grid nodes; edges are held outside the grid. */
  variation(lat: number, lon: number): number {
    const g = this.grid;
    const fy = Math.min(Math.max((lat - g.south) / g.step, 0), this.rows - 1);
    const fx = Math.min(Math.max((lon - g.west) / g.step, 0), this.cols - 1);
    const x0 = Math.min(Math.floor(fx), this.cols - 2);
    const y0 = Math.min(Math.floor(fy), this.rows - 2);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x: number, y: number) => g.values[y * this.cols + x]!;
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /** Converts a true course or heading to magnetic at a point. */
  toMagnetic(trueDeg: number, lat: number, lon: number): number {
    const m = trueDeg - this.variation(lat, lon);
    return ((m % 360) + 360) % 360;
  }

  toTrue(magDeg: number, lat: number, lon: number): number {
    const t = magDeg + this.variation(lat, lon);
    return ((t % 360) + 360) % 360;
  }
}
