import type { Vec2 } from '../primitives/vec';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Uniform-grid spatial hash for hit testing. Insert ids with bounding boxes,
 * then query a point/box to get candidate ids. Rebuilt when geometry changes
 * (cheap for house-scale data), queried on every pointer move.
 */
export class SpatialGrid<T extends string = string> {
  private cells = new Map<string, T[]>();
  private readonly cellSize: number;

  constructor(cellSize = 1000) {
    this.cellSize = cellSize;
  }

  private key(ix: number, iy: number) {
    return `${ix},${iy}`;
  }

  insert(id: T, box: Box): void {
    const c = this.cellSize;
    for (let ix = Math.floor(box.minX / c); ix <= Math.floor(box.maxX / c); ix++) {
      for (let iy = Math.floor(box.minY / c); iy <= Math.floor(box.maxY / c); iy++) {
        const k = this.key(ix, iy);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  query(p: Vec2, radius = 0): Set<T> {
    return this.queryBox({ minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius });
  }

  queryBox(box: Box): Set<T> {
    const out = new Set<T>();
    const c = this.cellSize;
    for (let ix = Math.floor(box.minX / c); ix <= Math.floor(box.maxX / c); ix++) {
      for (let iy = Math.floor(box.minY / c); iy <= Math.floor(box.maxY / c); iy++) {
        const list = this.cells.get(this.key(ix, iy));
        if (list) for (const id of list) out.add(id);
      }
    }
    return out;
  }
}

export function boxOf(points: readonly Vec2[], pad = 0): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
