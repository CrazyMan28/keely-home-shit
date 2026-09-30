import type { Vec2 } from '../../geometry/primitives/vec';

/**
 * 2D view transform. screen = world * scale + pan. `scale` is CSS pixels per
 * millimeter. Supports smooth animated transitions (zoom-to-fit, focus).
 */
export class Viewport {
  scale = 0.08;
  panX = 0;
  panY = 0;
  width = 1;
  height = 1;
  private anim: { from: [number, number, number]; to: [number, number, number]; start: number; dur: number } | null = null;

  static readonly MIN_SCALE = 0.004;
  static readonly MAX_SCALE = 4;

  toScreen(p: Vec2): Vec2 {
    return { x: p.x * this.scale + this.panX, y: p.y * this.scale + this.panY };
  }

  toWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.panX) / this.scale, y: (p.y - this.panY) / this.scale };
  }

  /** World distance for a screen distance in px. */
  px(n: number): number {
    return n / this.scale;
  }

  zoomAt(screen: Vec2, factor: number): void {
    this.anim = null;
    const next = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, this.scale * factor));
    const w = this.toWorld(screen);
    this.scale = next;
    this.panX = screen.x - w.x * next;
    this.panY = screen.y - w.y * next;
  }

  panBy(dx: number, dy: number): void {
    this.anim = null;
    this.panX += dx;
    this.panY += dy;
  }

  /** Target transform that fits a world box with padding (px). */
  fitTarget(box: { minX: number; minY: number; maxX: number; maxY: number }, padding = 80): [number, number, number] {
    const w = Math.max(box.maxX - box.minX, 500);
    const h = Math.max(box.maxY - box.minY, 500);
    const s = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h)));
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return [s, this.width / 2 - cx * s, this.height / 2 - cy * s];
  }

  animateTo(target: [number, number, number], duration = 420): void {
    if (duration <= 0 || prefersReducedMotion()) {
      [this.scale, this.panX, this.panY] = target;
      this.anim = null;
      return;
    }
    this.anim = { from: [this.scale, this.panX, this.panY], to: target, start: performance.now(), dur: duration };
  }

  /** Advances any running animation. Returns true while animating. */
  tick(now: number): boolean {
    if (!this.anim) return false;
    const t = Math.min(1, (now - this.anim.start) / this.anim.dur);
    const e = 1 - Math.pow(1 - t, 3);
    const [s0, x0, y0] = this.anim.from;
    const [s1, x1, y1] = this.anim.to;
    // Interpolate scale logarithmically and keep the screen center path smooth.
    const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * e);
    const cw0 = { x: (this.width / 2 - x0) / s0, y: (this.height / 2 - y0) / s0 };
    const cw1 = { x: (this.width / 2 - x1) / s1, y: (this.height / 2 - y1) / s1 };
    const cx = cw0.x + (cw1.x - cw0.x) * e;
    const cy = cw0.y + (cw1.y - cw0.y) * e;
    this.scale = s;
    this.panX = this.width / 2 - cx * s;
    this.panY = this.height / 2 - cy * s;
    if (t >= 1) this.anim = null;
    return true;
  }

  get animating(): boolean {
    return this.anim !== null;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
