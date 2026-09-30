import { createItem } from '../geometry/items/items';
import { inchesToMm } from '../geometry/measurement/units';
import { createOpening } from '../geometry/openings/openings';
import { addWallChainTo } from '../geometry/walls/wallOps';
import { CATALOG_BY_ID } from '../assets/catalog';
import { createProject, DEFAULT_EXTERIOR_THICKNESS, DEFAULT_INTERIOR_THICKNESS, DEFAULT_WALL_HEIGHT } from '../model/factory';
import { FloorEditor } from '../model/floorEditor';
import { finalizeFloor } from '../model/pipeline';
import type { ProjectDoc } from '../model/types';

const ft = (f: number, i = 0) => inchesToMm(f * 12 + i);

/** A small, realistic sample house for first-time exploration. */
export function createSampleProject(): ProjectDoc {
  const doc = createProject('Sample Bungalow');
  const base = doc.variants[doc.baseVariantId];
  const floor0 = base.floors[base.floorOrder[0]];
  const ed = new FloorEditor(floor0);
  const ext = { thickness: DEFAULT_EXTERIOR_THICKNESS, height: DEFAULT_WALL_HEIGHT, wallType: 'exterior' as const, status: 'existing' as const };
  const int = { thickness: DEFAULT_INTERIOR_THICKNESS, height: DEFAULT_WALL_HEIGHT, wallType: 'interior' as const, status: 'existing' as const };
  // Exterior: 34' x 26' with a 6' x 10' bump-out (non-rectangular).
  addWallChainTo(
    ed,
    [
      { x: 0, y: 0 },
      { x: ft(34), y: 0 },
      { x: ft(34), y: ft(16) },
      { x: ft(40), y: ft(16) },
      { x: ft(40), y: ft(26) },
      { x: 0, y: ft(26) },
    ],
    ext,
    { closed: true },
  );
  // Interior partitions
  addWallChainTo(ed, [{ x: ft(15, 2), y: 0 }, { x: ft(15, 2), y: ft(26) }], int);
  addWallChainTo(ed, [{ x: ft(15, 2), y: ft(12) }, { x: ft(34), y: ft(12) }], int);
  addWallChainTo(ed, [{ x: 0, y: ft(14, 6) }, { x: ft(15, 2), y: ft(14, 6) }], int);
  addWallChainTo(ed, [{ x: ft(24), y: ft(12) }, { x: ft(24), y: ft(26) }], int);

  const f1 = finalizeFloor(floor0, ed.floor).floor;
  const ed2 = new FloorEditor(f1);
  const wallAt = (x: number, y: number) => {
    let best = '';
    let bd = Infinity;
    for (const w of Object.values(f1.walls)) {
      const a = f1.nodes[w.a];
      const b = f1.nodes[w.b];
      const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
      const d = Math.hypot(a.x + (b.x - a.x) * t - x, a.y + (b.y - a.y) * t - y);
      if (d < bd) {
        bd = d;
        best = w.id;
      }
    }
    return best;
  };
  const offsetOn = (wallId: string, x: number, y: number, width: number) => {
    const w = f1.walls[wallId];
    const a = f1.nodes[w.a];
    const b = f1.nodes[w.b];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const t = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / L;
    return Math.max(0, Math.min(L - width, t - width / 2));
  };
  const put = (type: 'door' | 'window' | 'opening', x: number, y: number, extra: Parameters<typeof createOpening>[4] = {}) => {
    const wid = wallAt(x, y);
    const o = createOpening(type, wid, 0, 'existing', extra);
    ed2.putOpening({ ...o, offset: offsetOn(wid, x, y, o.width) });
  };
  put('door', ft(24), ft(26), { width: ft(3), door: { style: 'single', hinge: 'start', swing: 'right' } });
  put('window', ft(7), 0, { width: ft(5) });
  put('window', ft(27), 0, { width: ft(4) });
  put('window', 0, ft(20));
  put('window', ft(40), ft(21), { width: ft(4) });
  put('opening', ft(15, 2), ft(6), { width: ft(4) });
  put('door', ft(8), ft(14, 6), { door: { style: 'single', hinge: 'start', swing: 'left' } });
  put('door', ft(20), ft(12), { width: ft(2, 8), door: { style: 'single', hinge: 'end', swing: 'right' } });
  put('door', ft(24), ft(18), { width: ft(2, 6), door: { style: 'single', hinge: 'start', swing: 'right' } });

  const place = (id: string, x: number, y: number, rot = 0) => ed2.putItem(createItem(CATALOG_BY_ID[id], { x, y }, rot, 'existing'));
  const e = DEFAULT_EXTERIOR_THICKNESS / 2;
  const i = DEFAULT_INTERIOR_THICKNESS / 2;
  // Living room (west, north)
  place('sofa-3', ft(7, 6), ft(14, 6) - i - inchesToMm(18), 180);
  place('coffee-table', ft(7, 6), ft(9, 6));
  place('tv-stand', ft(7, 6), e + inchesToMm(9));
  place('rug-5x8', ft(7, 6), ft(9, 6));
  // Kitchen (east, north)
  const kx = ft(15, 2) + i;
  place('counter', kx + inchesToMm(48) + ft(1), e + inchesToMm(12.75));
  place('range', kx + inchesToMm(30) + ft(9), e + inchesToMm(13));
  place('fridge', ft(34) - e - inchesToMm(18), e + inchesToMm(15));
  place('island', ft(25), ft(7, 8));
  // Bedroom (west, south)
  place('bed-queen', ft(7, 6), ft(26) - e - inchesToMm(40), 180);
  place('nightstand', ft(7, 6) - inchesToMm(42), ft(26) - e - inchesToMm(8), 180);
  place('nightstand', ft(7, 6) + inchesToMm(42), ft(26) - e - inchesToMm(8), 180);
  // Bath (middle, south)
  place('toilet', ft(17), ft(26) - e - inchesToMm(14), 180);
  place('vanity-36', ft(21, 6), ft(26) - e - inchesToMm(10.5), 180);
  place('bathtub', ft(19, 7), ft(12) + i + inchesToMm(15));
  // Den (east bump-out)
  place('desk', ft(37), ft(26) - e - inchesToMm(15), 180);
  place('armchair', ft(29), ft(19), 90);

  const f2 = finalizeFloor(f1, ed2.floor).floor;
  const names: Array<[number, number, string, string]> = [
    [ft(7), ft(7), 'Living Room', 'mat-floor-oak'],
    [ft(25), ft(6), 'Kitchen', 'mat-floor-tile'],
    [ft(7), ft(20), 'Bedroom', 'mat-floor-carpet'],
    [ft(19), ft(19), 'Bathroom', 'mat-floor-slate'],
    [ft(30), ft(20), 'Den', 'mat-floor-walnut'],
  ];
  const ed3 = new FloorEditor(f2);
  for (const r of Object.values(f2.rooms)) {
    let best: (typeof names)[number] | null = null;
    let bd = Infinity;
    for (const n of names) {
      const d = Math.hypot(r.anchor.x - n[0], r.anchor.y - n[1]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best) ed3.patchRoom(r.id, { name: best[2], floorMaterialId: best[3] });
  }
  return {
    ...doc,
    variants: { ...doc.variants, [base.id]: { ...base, floors: { [f2.id]: ed3.floor } } },
  };
}
