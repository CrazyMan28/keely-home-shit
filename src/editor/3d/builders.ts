import * as THREE from 'three';
import { shapeOf } from '../../assets/catalog';
import type { WallFootprint } from '../../geometry/walls/wallGeometry';
import { wallSpans } from '../../geometry/walls/wallPieces';
import type { Vec2 } from '../../geometry/primitives/vec';
import type { Item, Material, Opening, Wall } from '../../model/types';
import { materialFor, simpleMaterial } from './materials3d';

/**
 * Pure builders: canonical model → Three.js objects.
 * Units: 3D uses meters. Plan (x, y) mm → world (x/1000, z = y/1000); height → +Y.
 */
export const M = 0.001;

type Mats = Record<string, Material>;
export type StatusVariant = 'normal' | 'demolish' | 'new';

function shapeFrom(poly: Vec2[]): THREE.Shape {
  // Shape space (x, -planY): after rotateX(-π/2) this lands at world (x, ·, planY).
  const s = new THREE.Shape();
  poly.forEach((p, i) => (i ? s.lineTo(p.x * M, -p.y * M) : s.moveTo(p.x * M, -p.y * M)));
  s.closePath();
  return s;
}

function extrude(poly: Vec2[], bottom: number, top: number): THREE.BufferGeometry | null {
  const h = (top - bottom) * M;
  if (h <= 1e-5 || poly.length < 3) return null;
  const g = new THREE.ExtrudeGeometry(shapeFrom(poly), { depth: h, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bottom * M, 0);
  return g;
}

function tag<T extends THREE.Object3D>(obj: T, id: string, kind: string): T {
  obj.traverse((o) => {
    o.userData.elementId = id;
    o.userData.elementKind = kind;
  });
  return obj;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cast = true, receive = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Dark "section cut" on wall tops so the dollhouse view reads like an architectural model. */
const CAP_MATERIAL = new THREE.MeshStandardMaterial({ color: '#3b3e46', roughness: 0.9 });

export function buildWall(wall: Wall, fp: WallFootprint, openings: Opening[], mats: Mats, variant: StatusVariant): THREE.Group {
  const g = new THREE.Group();
  const side = materialFor(mats[wall.materialId], variant);
  // ExtrudeGeometry groups: 0 = caps (top/bottom), 1 = sides.
  const mat = variant === 'demolish' ? side : [CAP_MATERIAL, side];
  for (const span of wallSpans(fp, openings)) {
    const pieces: Array<[number, number]> = span.opening
      ? [
          [0, Math.max(0, span.opening.sill)],
          [Math.min(wall.height, span.opening.sill + span.opening.height), wall.height],
        ]
      : [[0, wall.height]];
    for (const [b, t] of pieces) {
      const geo = extrude(span.polygon, b, t);
      if (geo) g.add(mesh(geo, mat, variant !== 'demolish'));
    }
  }
  return tag(g, wall.id, 'wall');
}

export function buildJunction(poly: Vec2[], height: number, mat: THREE.Material): THREE.Mesh | null {
  const both = [CAP_MATERIAL, mat];
  const geo = extrude(poly, 0, height);
  return geo ? mesh(geo, both) : null;
}

export function buildFloor(poly: Vec2[], mat: THREE.Material, id: string): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shapeFrom(poly));
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.006, 0);
  const m = mesh(geo, mat, false, true);
  m.renderOrder = 1;
  return tag(m, id, 'room');
}

export function buildCeiling(poly: Vec2[], height: number, id: string): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shapeFrom(poly));
  geo.rotateX(Math.PI / 2);
  // rotateX(+π/2) mirrors z; flip back so the ceiling sits over the floor.
  geo.scale(1, 1, -1);
  geo.translate(0, height * M, 0);
  const m = mesh(geo, simpleMaterial('#f4f2ee', 0.95), false, true);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return tag(m, id, 'ceiling');
}

/** Door/window frame, leaf and glass placed in the wall opening. */
export function buildOpening(o: Opening, fp: WallFootprint, thickness: number, mats: Mats, variant: StatusVariant): THREE.Group {
  const g = new THREE.Group();
  const t = thickness * M;
  const w = o.width * M;
  const h = o.height * M;
  const sill = o.sill * M;
  const frame = variant === 'demolish' ? materialFor(undefined, 'demolish') : simpleMaterial('#f3f1ec', 0.5);
  const fw = 0.04; // frame member width
  const fd = t + 0.01;
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Local frame: x along the wall (0 → width), z across (+z = wall's left normal), y up.
  if (o.type !== 'opening') {
    box(fw, h, fd, fw / 2, sill + h / 2, 0, frame);
    box(fw, h, fd, w - fw / 2, sill + h / 2, 0, frame);
    box(w, fw, fd, w / 2, sill + h - fw / 2, 0, frame);
  }
  if (o.type === 'window') {
    box(w, fw, fd, w / 2, sill + fw / 2, 0, frame);
    box(w + 0.04, 0.025, t + 0.06, w / 2, sill - 0.012, 0, frame); // sill board
    const glass = variant === 'demolish' ? materialFor(undefined, 'demolish') : simpleMaterial('#a9cfe6', 0.05, 0.1, 0.22);
    const pane = box(w - fw * 2, h - fw * 2, 0.008, w / 2, sill + h / 2, 0, glass);
    pane.castShadow = false;
    if (o.window?.style === 'double-hung' || o.window?.style === 'single-hung') box(w - fw * 2, 0.035, 0.05, w / 2, sill + h / 2, 0, frame);
    if (o.window?.style === 'casement' || o.window?.style === 'sliding') box(0.035, h - fw * 2, 0.05, w / 2, sill + h / 2, 0, frame);
  } else if (o.type === 'door' && o.door) {
    const leafMat = variant === 'demolish' ? materialFor(undefined, 'demolish') : materialFor(mats[o.materialId ?? 'mat-door-white'] ?? mats['mat-door-white'], variant);
    const lt = 0.038;
    const side = o.door.swing === 'left' ? 1 : -1;
    const leaves: Array<{ hingeX: number; dir: 1 | -1; lw: number }> = [];
    const inner = w - fw * 2;
    if (o.door.style === 'double') leaves.push({ hingeX: fw, dir: 1, lw: inner / 2 }, { hingeX: w - fw, dir: -1, lw: inner / 2 });
    else if (o.door.style === 'single' || o.door.style === 'bifold') leaves.push(o.door.hinge === 'start' ? { hingeX: fw, dir: 1, lw: inner } : { hingeX: w - fw, dir: -1, lw: inner });
    for (const leaf of leaves) {
      const pivot = new THREE.Group();
      pivot.position.set(leaf.hingeX, sill, side * (t / 2));
      const open = (70 * Math.PI) / 180;
      pivot.rotation.y = -leaf.dir * side * open;
      const panel = mesh(new THREE.BoxGeometry(leaf.lw, h - fw, lt), leafMat);
      panel.position.set((leaf.dir * leaf.lw) / 2, (h - fw) / 2, side * (lt / 2));
      pivot.add(panel);
      const knob = mesh(new THREE.SphereGeometry(0.028, 16, 12), simpleMaterial('#b9b4a8', 0.3, 0.8));
      knob.position.set(leaf.dir * (leaf.lw - 0.07), 0.95, side * (lt + 0.02));
      pivot.add(knob);
      g.add(pivot);
    }
    if (o.door.style === 'sliding' || o.door.style === 'pocket') {
      const p = box(inner * (o.door.style === 'pocket' ? 0.15 : 0.52), h - fw, lt, fw + inner * 0.26, sill + (h - fw) / 2, t * 0.2, leafMat);
      p.castShadow = true;
      if (o.door.style === 'sliding') box(inner * 0.52, h - fw, lt, w - fw - inner * 0.26, sill + (h - fw) / 2, -t * 0.2, leafMat);
    }
  }
  // Place into the wall.
  const start = { x: fp.a.x + fp.dir.x * o.offset, y: fp.a.y + fp.dir.y * o.offset };
  g.position.set(start.x * M, 0, start.y * M);
  // Local +x → wall dir; local +z → wall left normal (plan perp(dir)).
  g.rotation.y = -Math.atan2(fp.dir.y, fp.dir.x);
  // With rotation.y = -θ, local +z maps to plan (−sinθ, cosθ) = perp(dir) ✓.
  return tag(g, o.id, 'opening');
}

/** Procedural placeholder models (swap for GLB via item.assetRef later). */
export function buildItem(item: Item, mats: Mats, variant: StatusVariant): THREE.Group {
  const g = new THREE.Group();
  const W = item.width * M;
  const D = item.depth * M;
  const H = Math.max(item.height * M, 0.005);
  const base = materialFor(mats[item.materialId ?? ''] ?? undefined, variant);
  const accent = (c: string, r = 0.7, m = 0) => (variant === 'demolish' ? materialFor(undefined, 'demolish') : simpleMaterial(c, r, m));
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material = base) => {
    const m = mesh(new THREE.BoxGeometry(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001)), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const cyl = (r: number, h: number, x: number, y: number, z: number, mat: THREE.Material = base, seg = 24, rTop = r) => {
    const m = mesh(new THREE.CylinderGeometry(rTop, r, h, seg), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const legs = (inset: number, h: number, r: number, mat: THREE.Material) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(r, h, sx * (W / 2 - inset), h / 2, sz * (D / 2 - inset), mat, 10);
  };
  const counterMat = materialFor(mats['mat-counter-quartz'], variant);
  const cabMat = materialFor(mats['mat-cabinet-white'], variant);

  switch (shapeOf(item.catalogId)) {
    case 'bed': {
      box(W, H * 0.45, D, 0, H * 0.225, 0, accent('#6f5846', 0.7));
      box(W * 0.97, H * 0.38, D * 0.95, 0, H * 0.45 + H * 0.19, D * 0.02, accent('#f3f1ec', 0.95));
      box(W * 0.98, H * 0.08, D * 0.62, 0, H * 0.87, D * 0.19, base);
      box(W, Math.max(H * 2.2, 0.9), 0.06, 0, Math.max(H * 1.1, 0.45), -D / 2 + 0.03, accent('#6f5846', 0.7));
      for (const s of [-1, 1]) box(W * 0.4, H * 0.14, D * 0.12, s * W * 0.23, H * 0.92, -D / 2 + D * 0.12, accent('#ffffff', 0.95));
      break;
    }
    case 'sofa': {
      const arm = Math.min(W * 0.12, 0.22);
      box(W, H * 0.42, D, 0, H * 0.21, 0);
      box(W - arm * 2, H * 0.14, D * 0.72, 0, H * 0.49, D * 0.12);
      box(W, H * 0.55, D * 0.22, 0, H * 0.72, -D / 2 + D * 0.11);
      for (const s of [-1, 1]) box(arm, H * 0.66, D, s * (W / 2 - arm / 2), H * 0.33, 0);
      break;
    }
    case 'chair': {
      box(W, 0.04, D, 0, H * 0.48, 0);
      box(W, H * 0.48, 0.04, 0, H * 0.72, -D / 2 + 0.02);
      legs(0.03, H * 0.46, 0.015, base);
      break;
    }
    case 'table':
    case 'desk': {
      box(W, 0.035, D, 0, H - 0.0175, 0);
      legs(0.05, H - 0.035, 0.022, base);
      break;
    }
    case 'roundTable': {
      cyl(W / 2, 0.035, 0, H - 0.0175, 0, base, 40);
      cyl(0.05, H - 0.035, 0, (H - 0.035) / 2, 0);
      cyl(W * 0.22, 0.03, 0, 0.015, 0);
      break;
    }
    case 'shelf': {
      box(W, H, 0.02, 0, H / 2, -D / 2 + 0.01);
      for (const s of [-1, 1]) box(0.02, H, D, s * (W / 2 - 0.01), H / 2, 0);
      const n = Math.max(2, Math.round(H / 0.35));
      for (let i = 0; i <= n; i++) box(W, 0.02, D, 0, (H * i) / n + 0.01 - (i === n ? 0.02 : 0), 0);
      break;
    }
    case 'baseCabinet':
    case 'counter':
    case 'island':
    case 'sink':
    case 'vanity': {
      const top = 0.035;
      const toe = 0.09;
      const isCounterOnly = shapeOf(item.catalogId) === 'counter' || shapeOf(item.catalogId) === 'island';
      box(W - 0.01, toe, D - 0.08, 0, toe / 2, -0.03, accent('#2b2b2e', 0.8));
      box(W, H - top - toe, D - 0.03, 0, toe + (H - top - toe) / 2, -0.015, isCounterOnly ? cabMat : base);
      box(W + 0.01, top, D, 0, H - top / 2, 0, isCounterOnly ? base : counterMat);
      const doors = Math.max(1, Math.round(W / 0.6));
      for (let i = 0; i < doors; i++) {
        const dx = -W / 2 + (W / doors) * (i + 0.5);
        box(W / doors - 0.012, H - top - toe - 0.02, 0.012, dx, toe + (H - top - toe) / 2, D / 2 - 0.02, isCounterOnly ? cabMat : base);
        cyl(0.006, 0.1, dx + (W / doors) * 0.35, H - top - 0.12, D / 2 - 0.005, accent('#9a9a9e', 0.3, 0.8), 8);
      }
      if (shapeOf(item.catalogId) === 'sink' || shapeOf(item.catalogId) === 'vanity') {
        box(W * 0.55, 0.012, D * 0.5, 0, H + 0.001, 0, accent('#8e9398', 0.3, 0.6));
        cyl(0.012, 0.25, 0, H + 0.125, -D * 0.33, accent('#c8cacc', 0.25, 0.9), 12);
      }
      break;
    }
    case 'wallCabinet':
    case 'tallCabinet':
    case 'box': {
      box(W, H, D, 0, H / 2, 0);
      const doors = Math.max(1, Math.round(W / 0.6));
      for (let i = 1; i < doors; i++) box(0.004, H * 0.96, 0.004, -W / 2 + (W / doors) * i, H / 2, D / 2 + 0.002, simpleMaterial('#000000', 1, 0, 0.25));
      break;
    }
    case 'fridge': {
      box(W, H, D, 0, H / 2, 0);
      box(W * 0.98, 0.006, 0.01, 0, H * 0.66, D / 2 + 0.003, accent('#555', 0.5));
      for (const y of [H * 0.82, H * 0.45]) box(0.02, H * 0.25, 0.03, W * 0.38, y, D / 2 + 0.02, accent('#9a9ca0', 0.3, 0.8));
      break;
    }
    case 'range': {
      box(W, H - 0.02, D, 0, (H - 0.02) / 2, 0);
      box(W, 0.02, D, 0, H - 0.01, 0, accent('#1d1d1f', 0.4));
      for (const [x, z] of [
        [-0.22, -0.2],
        [0.22, -0.2],
        [-0.22, 0.18],
        [0.22, 0.18],
      ])
        cyl(0.08, 0.012, x * W, H + 0.006, z * D, accent('#2c2c2e', 0.5), 20);
      box(W, 0.12, 0.05, 0, H + 0.06, -D / 2 + 0.025);
      box(W * 0.8, H * 0.45, 0.01, 0, H * 0.4, D / 2 + 0.005, accent('#222', 0.2, 0.2));
      break;
    }
    case 'dishwasher':
    case 'washer': {
      box(W, H, D, 0, H / 2, 0);
      if (shapeOf(item.catalogId) === 'washer') {
        const door = cyl(W * 0.3, 0.02, 0, H * 0.45, D / 2 + 0.01, accent('#8aa0b0', 0.1, 0.3), 32);
        door.rotation.x = Math.PI / 2;
      } else box(W * 0.9, 0.03, 0.02, 0, H * 0.9, D / 2 + 0.01, accent('#9a9ca0', 0.3, 0.8));
      break;
    }
    case 'toilet': {
      box(W * 0.9, H * 0.55, D * 0.25, 0, H * 0.72, -D / 2 + D * 0.125);
      const bowl = cyl(W * 0.42, H * 0.5, 0, H * 0.25, D * 0.1, base, 28, W * 0.46);
      bowl.scale.z = 1.25;
      box(W * 0.85, 0.02, D * 0.6, 0, H * 0.51, D * 0.1, accent('#f7f7f5', 0.3));
      break;
    }
    case 'shower': {
      box(W, 0.06, D, 0, 0.03, 0, accent('#f2f2ef', 0.4));
      const glass = variant === 'demolish' ? materialFor(undefined, 'demolish') : simpleMaterial('#bfe0f0', 0.05, 0, 0.25);
      box(W, H, 0.01, 0, H / 2, D / 2, glass).castShadow = false;
      box(0.01, H, D, W / 2, H / 2, 0, glass).castShadow = false;
      cyl(0.08, 0.01, 0, H * 0.95, -D / 2 + 0.15, accent('#c8cacc', 0.25, 0.9), 16);
      break;
    }
    case 'bathtub': {
      box(W, H, D, 0, H / 2, 0);
      box(W * 0.86, 0.01, D * 0.72, 0, H + 0.001, 0, accent('#dfe4e8', 0.2));
      break;
    }
    case 'lamp': {
      cyl(W * 0.3, 0.03, 0, 0.015, 0, accent('#2a2a2c', 0.5));
      cyl(0.012, H * 0.8, 0, H * 0.4, 0, accent('#2a2a2c', 0.5), 8);
      cyl(W / 2, H * 0.22, 0, H * 0.87, 0, accent('#efe6d2', 0.9), 24, W * 0.35);
      break;
    }
    case 'plant': {
      cyl(W * 0.28, H * 0.3, 0, H * 0.15, 0, accent('#b57a52', 0.8), 16, W * 0.33);
      const leaves = mesh(new THREE.IcosahedronGeometry(W * 0.48, 1), accent('#4f7d4a', 0.9));
      leaves.position.set(0, H * 0.62, 0);
      leaves.scale.y = 1.2;
      g.add(leaves);
      break;
    }
    case 'rug':
      box(W, Math.max(H, 0.008), D, 0, 0.006, 0).castShadow = false;
      break;
    case 'tv':
      box(W, H, Math.max(D, 0.03), 0, H / 2, 0, accent('#0c0c0e', 0.25, 0.3));
      break;
    case 'column':
      box(W, H, D, 0, H / 2, 0);
      break;
    case 'stairs': {
      const steps = Math.max(3, Math.round(H / 0.18));
      const run = D / steps;
      for (let i = 0; i < steps; i++) {
        const sh = (H * (i + 1)) / steps;
        box(W, sh, run, 0, sh / 2, D / 2 - run * (i + 0.5));
      }
      break;
    }
    default:
      box(W, H, D, 0, H / 2, 0);
  }
  g.position.y = item.elevation * M;
  return tag(g, item.id, 'item');
}

/** Places an item group at its plan transform (cheap; no rebuild). */
export function placeItem(obj: THREE.Object3D, item: Item): void {
  obj.position.set(item.x * M, item.elevation * M, item.y * M);
  obj.rotation.set(0, -(item.rotation * Math.PI) / 180, 0);
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}
