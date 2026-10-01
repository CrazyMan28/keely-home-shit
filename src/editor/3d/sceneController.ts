import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CATALOG_BY_ID } from '../../assets/catalog';
import { derivePlan, type PlanDerived } from '../../geometry/derive';
import { normalizeRotation, snapItemToWall } from '../../geometry/items/items';
import { formatAngle, formatLength, formatSignedLength } from '../../geometry/measurement/format';
import { bounds, pointInPolygon } from '../../geometry/primitives/polygon';
import { closestPointOnSegment } from '../../geometry/primitives/segment';
import { dot, norm, perp, sub, type Vec2 } from '../../geometry/primitives/vec';
import { moveWallPerpendicular } from '../../geometry/walls/wallOps';
import { wallSpans } from '../../geometry/walls/wallPieces';
import { FloorEditor } from '../../model/floorEditor';
import { isHighlighted, isVisibleInView, type RenovationView } from '../../model/renovation';
import type { ElementStatus, Floor, Id, Item } from '../../model/types';
import { report } from '../../state/actions';
import {
  beginTransaction,
  cancelTransaction,
  commitTransaction,
  documentStore,
  editFloor,
  getActiveFloor,
  isActiveVariantLocked,
} from '../../state/documentStore';
import { select, setHover, setUi, ui, uiStore } from '../../state/uiStore';
import { contextMenuFor } from '../contextMenus';
import { buildCeiling, buildFloor, buildItem, buildJunction, buildOpening, buildWall, disposeObject, M, placeItem, type StatusVariant } from './builders';
import { highlighted, materialFor } from './materials3d';
import { editors, type SceneEditorApi } from '../registry';

export type CameraPreset = 'perspective' | 'top' | 'front' | 'back' | 'left' | 'right';
export type GizmoMode = 'move' | 'rotate';

interface Rec {
  sig: string;
  obj: THREE.Object3D;
}

type Drag3D =
  | { kind: 'pending'; id: Id; elementKind: string; startClient: Vec2; startPoint: THREE.Vector3; planeY: number }
  | { kind: 'item'; id: Id; floor: Floor; start: Vec2; planeY: number }
  | { kind: 'wall'; id: Id; floor: Floor; start: Vec2; normal: Vec2; planeY: number; offset: number }
  | { kind: 'awaitExact'; apply: (mm: number) => void };

const EYE_HEIGHT = 1.6;

export class SceneController implements SceneEditorApi {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  private controls: OrbitControls;
  private gizmo: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private gizmoTarget = new THREE.Object3D();
  private gizmoTx: { floor: Floor; itemId: Id } | null = null;
  gizmoMode: GizmoMode = 'move';
  private root = new THREE.Group();
  private groups = {
    walls: new THREE.Group(),
    openings: new THREE.Group(),
    floors: new THREE.Group(),
    ceilings: new THREE.Group(),
    items: new THREE.Group(),
    junctions: new THREE.Group(),
  };
  private recs = new Map<string, Rec>();
  private junctionSig = '';
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private container: HTMLElement;
  private overlay: HTMLElement;
  private raf = 0;
  private dirty = true;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; dur: number } | null = null;
  private drag: Drag3D | null = null;
  private walk = { on: false, yaw: 0, pitch: 0, keys: new Set<string>(), last: 0, looking: null as Vec2 | null };
  private unsubs: Array<() => void> = [];
  private resizeObs: ResizeObserver;
  private lastFloor: Floor | null = null;
  private lastView: RenovationView | null = null;
  private lastMaterials: unknown = null;
  private hoverPending: PointerEvent | null = null;
  private derivedCache: PlanDerived | null = null;
  private framed = false;
  private walkCollision: Vec2[][] = [];

  constructor(container: HTMLElement, overlay: HTMLElement) {
    this.container = container;
    this.overlay = overlay;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.style.display = 'block';
    r.domElement.style.touchAction = 'none';
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);
    this.renderer = r;

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.persp.position.set(12, 11, 14);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    this.camera = this.persp;

    this.hemi = new THREE.HemisphereLight('#f4f6ff', '#b8ad9c', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#dfe3d6', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.03;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    for (const g of Object.values(this.groups)) this.root.add(g);
    this.groups.ceilings.visible = false;
    this.scene.add(this.root);

    this.controls = new OrbitControls(this.persp, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 200;
    this.controls.addEventListener('change', () => this.requestRender());

    this.gizmo = new TransformControls(this.persp, r.domElement);
    this.gizmo.setSize(0.8);
    this.gizmoHelper = this.gizmo.getHelper();
    this.scene.add(this.gizmoHelper, this.gizmoTarget);
    this.gizmo.addEventListener('change', () => this.requestRender());
    this.gizmo.addEventListener('dragging-changed', (e) => this.onGizmoDragging(Boolean((e as unknown as { value: boolean }).value)));
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());

    const el = r.domElement;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.unsubs.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    on('pointermove', (e) => this.onPointerMove(e));
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointerleave', () => setHover(null));
    on('dblclick', (e) => this.onDoubleClick(e));
    on('contextmenu', (e) => this.onContextMenu(e));
    const kd = (e: KeyboardEvent) => this.onWalkKey(e, true);
    const ku = (e: KeyboardEvent) => this.onWalkKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.unsubs.push(() => window.removeEventListener('keydown', kd), () => window.removeEventListener('keyup', ku));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.unsubs.push(
      documentStore.subscribe((s, p) => {
        if (s.doc !== p.doc || s.floorId !== p.floorId || s.variantId !== p.variantId) this.sync();
        if (s.doc?.id !== p.doc?.id || s.floorId !== p.floorId) this.framed = false;
      }),
      uiStore.subscribe((s, p) => {
        if (s.renovationView !== p.renovationView || s.showFurniture !== p.showFurniture) this.sync();
        if (s.selection !== p.selection || s.hover !== p.hover) this.applyHighlights();
        if (s.selection !== p.selection) this.updateGizmo();
        if (s.theme !== p.theme) requestAnimationFrame(() => this.applyTheme());
        if (s.focusRequest !== p.focusRequest && s.focusRequest) this.focusOn(s.focusRequest.ids);
        if (s.cameraPreset !== p.cameraPreset && s.cameraPreset) {
          this.setPreset(s.cameraPreset as CameraPreset);
          setUi({ cameraPreset: null });
        }
        if (s.walkMode !== p.walkMode) this.setWalk(s.walkMode);
      }),
    );
    this.applyTheme();
    this.sync();
    editors.scene = this;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    for (const u of this.unsubs) u();
    this.gizmo.dispose();
    this.controls.dispose();
    for (const rec of this.recs.values()) disposeObject(rec.obj);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (editors.scene === this) editors.scene = null;
  }

  // ── sync from canonical model ─────────────────────────────────────────
  private statusVariant(status: ElementStatus, view: RenovationView): StatusVariant {
    if (status === 'demolish' && isHighlighted(status, view)) return 'demolish';
    if (status === 'new' && view === 'combined') return 'new';
    return 'normal';
  }

  sync(): void {
    const floor = getActiveFloor();
    const doc = documentStore.getState().doc;
    if (!floor || !doc) return;
    const view = ui().renovationView;
    if (floor === this.lastFloor && view === this.lastView && doc.materials === this.lastMaterials && this.lastShowFurniture === ui().showFurniture) return;
    this.lastFloor = floor;
    this.lastView = view;
    this.lastMaterials = doc.materials;
    this.lastShowFurniture = ui().showFurniture;
    const derived = derivePlan(floor, view);
    this.derivedCache = derived;
    const mats = doc.materials;
    const seen = new Set<string>();
    const upsert = (key: string, sig: string, group: THREE.Group, build: () => THREE.Object3D, place?: (o: THREE.Object3D) => void) => {
      seen.add(key);
      let rec = this.recs.get(key);
      if (!rec || rec.sig !== sig) {
        if (rec) {
          group.remove(rec.obj);
          disposeObject(rec.obj);
        }
        const obj = build();
        obj.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.userData.baseMaterial = (o as THREE.Mesh).material;
        });
        rec = { sig, obj };
        this.recs.set(key, rec);
        group.add(obj);
      }
      place?.(rec.obj);
    };
    const r1 = (v: number) => Math.round(v * 10) / 10;

    const openingsByWall = new Map<Id, typeof floor.openings[string][]>();
    for (const o of Object.values(floor.openings)) {
      if (o.hidden || !isVisibleInView(o.status, view)) continue;
      const list = openingsByWall.get(o.wallId) ?? [];
      list.push(o);
      openingsByWall.set(o.wallId, list);
    }

    // Walls + openings
    const collision: Vec2[][] = [];
    for (const fp of derived.geometry.footprints.values()) {
      const w = floor.walls[fp.wallId];
      const ops = openingsByWall.get(w.id) ?? [];
      const variant = this.statusVariant(w.status, view);
      // Baseboards go on faces that look into a room (not onto the outside of an exterior wall).
      const faceInRoom = (sign: number) => {
        const mid = { x: (fp.a.x + fp.b.x) / 2 + fp.normal.x * sign * (w.thickness / 2 + 100), y: (fp.a.y + fp.b.y) / 2 + fp.normal.y * sign * (w.thickness / 2 + 100) };
        return derived.rooms.some((r) => pointInPolygon(mid, r.interiorPolygon));
      };
      const trim = { left: faceInRoom(1), right: faceInRoom(-1) };
      const sig = [fp.polygon.map((p) => `${r1(p.x)},${r1(p.y)}`).join(';'), w.height, w.materialId, variant, trim.left, trim.right, ops.map((o) => `${r1(o.offset)}|${r1(o.width)}|${r1(o.height)}|${r1(o.sill)}|${o.type}`).join(',')].join('#');
      upsert(`wall:${w.id}`, sig, this.groups.walls, () => buildWall(w, fp, ops, mats, variant, trim));
      for (const o of ops) {
        const ov = this.statusVariant(o.status, view);
        const osig = [r1(o.offset), r1(o.width), r1(o.height), r1(o.sill), o.type, JSON.stringify(o.door ?? o.window ?? {}), r1(fp.a.x), r1(fp.a.y), fp.dir.x.toFixed(6), fp.dir.y.toFixed(6), w.thickness, ov, o.materialId].join('|');
        upsert(`opening:${o.id}`, osig, this.groups.openings, () => buildOpening(o, fp, w.thickness, mats, ov));
      }
      if (w.status !== 'demolish' || view === 'existing')
        for (const span of wallSpans(fp, ops)) if (!span.opening || span.opening.sill > 300) collision.push(span.polygon);
    }
    this.walkCollision = collision;

    // Junction hubs (merged; rebuilt only when any hub changes)
    const jsig = derived.geometry.junctions.map((j) => j.polygon.map((p) => `${r1(p.x)},${r1(p.y)}`).join(';')).join('|') + JSON.stringify(Object.values(floor.walls).map((w) => [w.height, w.materialId]).slice(0, 400));
    if (jsig !== this.junctionSig) {
      this.junctionSig = jsig;
      for (const c of [...this.groups.junctions.children]) {
        this.groups.junctions.remove(c);
        disposeObject(c);
      }
      for (const j of derived.geometry.junctions) {
        const walls = Object.values(floor.walls).filter((w) => (w.a === j.nodeId || w.b === j.nodeId) && derived.geometry.footprints.has(w.id));
        if (!walls.length) continue;
        const h = Math.min(...walls.map((w) => w.height));
        const m = buildJunction(j.polygon, h, materialFor(mats[walls[0].materialId], this.statusVariant(walls[0].status, view)));
        if (m) {
          m.userData.elementId = walls[0].id;
          m.userData.elementKind = 'wall';
          m.userData.baseMaterial = m.material;
          this.groups.junctions.add(m);
        }
      }
    }

    // Floors & ceilings
    for (const r of derived.rooms) {
      const poly = r.interiorPolygon;
      const psig = poly.map((p) => `${r1(p.x)},${r1(p.y)}`).join(';');
      upsert(`floor:${r.room.id}`, `${psig}#${r.room.floorMaterialId}`, this.groups.floors, () => buildFloor(poly, materialFor(mats[r.room.floorMaterialId]), r.room.id));
      const walls = r.wallIds.map((id) => floor.walls[id]).filter(Boolean);
      const ch = r.room.ceilingHeight ?? (walls.length ? Math.min(...walls.map((w) => w.height)) : floor.defaultWallHeight);
      upsert(`ceiling:${r.room.id}`, `${psig}#${ch}`, this.groups.ceilings, () => buildCeiling(poly, ch, r.room.id));
    }

    // Items (transform updates never rebuild geometry)
    if (ui().showFurniture) {
      for (const it of Object.values(floor.items)) {
        if (it.hidden || !isVisibleInView(it.status, view)) continue;
        const v = this.statusVariant(it.status, view);
        const sig = [it.catalogId, r1(it.width), r1(it.depth), r1(it.height), it.materialId, v].join('|');
        upsert(`item:${it.id}`, sig, this.groups.items, () => buildItem(it, mats, v), (o) => placeItem(o, it));
      }
    }

    for (const [key, rec] of this.recs) {
      if (!seen.has(key)) {
        rec.obj.parent?.remove(rec.obj);
        disposeObject(rec.obj);
        this.recs.delete(key);
      }
    }

    this.fitLights(derived);
    if (!this.framed && derived.geometry.footprints.size) {
      this.framed = true;
      this.setPreset('perspective', false);
    }
    this.applyHighlights();
    this.updateGizmo();
    this.requestRender();
  }
  private lastShowFurniture = true;

  private houseBounds(): { center: THREE.Vector3; radius: number; box: ReturnType<typeof bounds> } {
    const d = this.derivedCache;
    const pts: Vec2[] = [];
    if (d) for (const fp of d.geometry.footprints.values()) pts.push(...fp.polygon);
    const f = getActiveFloor();
    if (f) for (const it of Object.values(f.items)) pts.push({ x: it.x, y: it.y });
    const box = pts.length ? bounds(pts) : { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
    const center = new THREE.Vector3(((box.minX + box.maxX) / 2) * M, 1.0, ((box.minY + box.maxY) / 2) * M);
    const radius = Math.max(3, (Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2) * M);
    return { center, radius, box };
  }

  private fitLights(_d: PlanDerived): void {
    const { center, radius } = this.houseBounds();
    this.sun.position.set(center.x + radius * 0.8, radius * 2.2 + 6, center.z + radius * 1.2);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    const s = radius * 1.4 + 2;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 0.5;
    cam.far = radius * 6 + 30;
    cam.updateProjectionMatrix();
  }

  private applyTheme(): void {
    const cs = getComputedStyle(document.documentElement);
    const dark = cs.getPropertyValue('color-scheme').trim() === 'dark';
    const bg = new THREE.Color(dark ? '#16181d' : '#eef0f3');
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 60, 180);
    (this.ground.material as THREE.MeshStandardMaterial).color.set(dark ? '#2b2f36' : '#cdd1c9');
    this.hemi.intensity = dark ? 0.9 : 1.1;
    this.requestRender();
  }

  private applyHighlights(): void {
    const sel = new Set(ui().selection);
    const hover = ui().hover;
    for (const g of Object.values(this.groups)) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !o.userData.baseMaterial) return;
        const id = o.userData.elementId as string | undefined;
        const base = o.userData.baseMaterial as THREE.Material | THREE.Material[];
        const want = id && sel.has(id) ? highlighted(base, 'select') : id && hover === id ? highlighted(base, 'hover') : base;
        const same = Array.isArray(want) && Array.isArray(m.material) ? want.every((x, i) => x === (m.material as THREE.Material[])[i]) : m.material === want;
        if (!same) m.material = want;
      });
    }
    this.requestRender();
  }

  // ── gizmo (items) ─────────────────────────────────────────────────────
  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.updateGizmo();
  }

  private updateGizmo(): void {
    const sel = ui().selection;
    const f = getActiveFloor();
    const it = sel.length === 1 && f ? f.items[sel[0]] : undefined;
    if (!it || it.locked || this.walk.on || isActiveVariantLocked()) {
      this.gizmo.detach();
      this.requestRender();
      return;
    }
    if (this.gizmoTx) return;
    placeItem(this.gizmoTarget, it);
    this.gizmoTarget.position.y = (it.elevation + it.height) * M + 0.02;
    this.gizmo.attach(this.gizmoTarget);
    this.gizmo.setMode(this.gizmoMode === 'move' ? 'translate' : 'rotate');
    this.gizmo.showX = this.gizmoMode === 'move';
    this.gizmo.showZ = this.gizmoMode === 'move';
    this.gizmo.showY = this.gizmoMode === 'rotate';
    this.gizmo.camera = this.camera;
    this.requestRender();
  }

  private onGizmoDragging(dragging: boolean): void {
    this.controls.enabled = !dragging && !this.walk.on;
    const f = getActiveFloor();
    const id = ui().selection[0];
    if (dragging && f && f.items[id]) {
      beginTransaction(this.gizmoMode === 'move' ? 'Move item' : 'Rotate item');
      this.gizmoTx = { floor: f, itemId: id };
    } else if (!dragging && this.gizmoTx) {
      commitTransaction();
      this.gizmoTx = null;
      this.setReadout(null);
      this.updateGizmo();
    }
  }

  private onGizmoChange(): void {
    const tx = this.gizmoTx;
    if (!tx) return;
    const it = tx.floor.items[tx.itemId];
    const units = documentStore.getState().doc!.settings.units;
    if (this.gizmoMode === 'move') {
      const x = this.gizmoTarget.position.x / M;
      const y = this.gizmoTarget.position.z / M;
      editFloor('Move item', () => {
        const ed = new FloorEditor(tx.floor);
        ed.patchItem(it.id, { x, y });
        return ed.floor;
      }, { transient: true, base: tx.floor });
      this.setReadout(`${formatLength(Math.hypot(x - it.x, y - it.y), units)}`);
    } else {
      let deg = (-this.gizmoTarget.rotation.y * 180) / Math.PI;
      deg = Math.round(deg / 15) * 15;
      const rotation = normalizeRotation(deg);
      editFloor('Rotate item', () => {
        const ed = new FloorEditor(tx.floor);
        ed.patchItem(it.id, { rotation });
        return ed.floor;
      }, { transient: true, base: tx.floor });
      this.setReadout(formatAngle(rotation, 0));
    }
  }

  // ── picking & direct manipulation ─────────────────────────────────────
  private ndc(e: MouseEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: MouseEvent): { id: Id; kind: string; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const targets = [this.groups.walls, this.groups.openings, this.groups.items, this.groups.junctions, this.groups.floors];
    if (this.walk.on) targets.push(this.groups.ceilings);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      const id = h.object.userData.elementId as string | undefined;
      if (id && h.object.userData.elementKind !== 'ceiling') return { id, kind: h.object.userData.elementKind, point: h.point };
    }
    return null;
  }

  private rayToPlane(e: MouseEvent, y: number): Vec2 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    return { x: p.x / M, y: p.z / M };
  }

  private onPointerDown(e: PointerEvent): void {
    setUi({ contextMenu: null });
    this.renderer.domElement.focus({ preventScroll: true });
    if (this.walk.on) {
      this.walk.looking = { x: e.clientX, y: e.clientY };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || (this.gizmo.dragging || (this.gizmo as unknown as { axis: string | null }).axis)) return;
    const hit = this.pick(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    if (!hit || hit.kind === 'room') {
      this.pendingRoom = hit?.id ?? null;
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) select([hit.id], 'toggle');
    else if (!ui().selection.includes(hit.id)) select([hit.id]);
    const f = getActiveFloor();
    const draggable = (hit.kind === 'item' && f?.items[hit.id] && !f.items[hit.id].locked) || (hit.kind === 'wall' && f?.walls[hit.id] && !f.walls[hit.id].locked && !f.walls[hit.id].locks.position);
    if (draggable && !additive) {
      this.controls.enabled = false;
      this.drag = { kind: 'pending', id: hit.id, elementKind: hit.kind, startClient: { x: e.clientX, y: e.clientY }, startPoint: hit.point, planeY: hit.kind === 'item' ? 0 : hit.point.y };
      this.renderer.domElement.setPointerCapture(e.pointerId);
    }
  }
  private downAt: Vec2 | null = null;
  private pendingRoom: Id | null = null;

  private onPointerMove(e: PointerEvent): void {
    if (this.walk.on && this.walk.looking) {
      const dx = e.clientX - this.walk.looking.x;
      const dy = e.clientY - this.walk.looking.y;
      this.walk.looking = { x: e.clientX, y: e.clientY };
      this.walk.yaw -= dx * 0.0035;
      this.walk.pitch = Math.max(-1.3, Math.min(1.3, this.walk.pitch - dy * 0.0035));
      this.applyWalkCamera();
      return;
    }
    const d = this.drag;
    if (d?.kind === 'pending') {
      if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < 4) return;
      if (isActiveVariantLocked()) {
        report({ ok: false, reason: 'base-locked', violations: [] });
        this.endDrag(false);
        return;
      }
      const f = getActiveFloor()!;
      const start = { x: d.startPoint.x / M, y: d.startPoint.z / M };
      if (d.elementKind === 'item') {
        beginTransaction('Move item');
        const p = this.rayToPlane(e, 0) ?? start;
        this.drag = { kind: 'item', id: d.id, floor: f, start: p, planeY: 0 };
      } else {
        const w = f.walls[d.id];
        const n = perp(norm(sub(f.nodes[w.b], f.nodes[w.a])));
        beginTransaction('Move wall');
        this.drag = { kind: 'wall', id: d.id, floor: f, start, normal: n, planeY: d.planeY, offset: 0 };
      }
    }
    const dd = this.drag;
    if (dd?.kind === 'item') {
      const p = this.rayToPlane(e, dd.planeY);
      if (!p) return;
      const it = dd.floor.items[dd.id];
      let target = { x: it.x + (p.x - dd.start.x), y: it.y + (p.y - dd.start.y) };
      let rotation = it.rotation;
      const entry = CATALOG_BY_ID[it.catalogId];
      if (entry?.wallAligned && !e.altKey && this.derivedCache) {
        const s = snapItemToWall(it, target, dd.floor, this.derivedCache.geometry, it.depth / 2 + 250);
        if (s) {
          target = { x: s.x, y: s.y };
          rotation = s.rotation;
        }
      }
      const step = documentStore.getState().doc!.settings.units.system === 'imperial' ? 12.7 : 5;
      if (rotation === it.rotation && !e.altKey) target = { x: Math.round(target.x / step) * step, y: Math.round(target.y / step) * step };
      editFloor('Move item', () => {
        const ed = new FloorEditor(dd.floor);
        ed.patchItem(dd.id, { x: target.x, y: target.y, rotation });
        return ed.floor;
      }, { transient: true, base: dd.floor });
      this.setReadout(`${formatLength(Math.hypot(target.x - it.x, target.y - it.y), documentStore.getState().doc!.settings.units)}`, e);
      return;
    }
    if (dd?.kind === 'wall') {
      const p = this.rayToPlane(e, dd.planeY);
      if (!p) return;
      const units = documentStore.getState().doc!.settings.units;
      const step = e.altKey ? 0 : units.system === 'imperial' ? 12.7 : 5;
      let off = dot(sub(p, dd.start), dd.normal);
      if (step) off = Math.round(off / step) * step;
      dd.offset = off;
      editFloor('Move wall', () => moveWallPerpendicular(dd.floor, dd.id, off), { transient: true, base: dd.floor });
      this.setReadout(`Moving wall ${formatSignedLength(off, units)} · type for exact`, e);
      return;
    }
    // Hover (throttled to a frame)
    if (!this.hoverPending) {
      this.hoverPending = e;
      requestAnimationFrame(() => {
        const ev = this.hoverPending;
        this.hoverPending = null;
        if (!ev || this.drag) return;
        const hit = this.pick(ev);
        setHover(hit && hit.kind !== 'room' ? hit.id : null);
        this.renderer.domElement.style.cursor = hit && hit.kind !== 'room' ? 'pointer' : 'grab';
      });
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.walk.on) {
      this.walk.looking = null;
      return;
    }
    const d = this.drag;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (d?.kind === 'item' || d?.kind === 'wall') {
      commitTransaction();
      this.endDrag(true);
      return;
    }
    if (d?.kind === 'pending') this.endDrag(true);
    if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 4 && e.button === 0 && !d) {
      // Click on empty space / room floor.
      if (this.pendingRoom) select([this.pendingRoom]);
      else if (!e.shiftKey) select([]);
    }
    this.downAt = null;
    this.pendingRoom = null;
  }

  private endDrag(keep: boolean): void {
    if (!keep) cancelTransaction();
    this.drag = null;
    this.controls.enabled = !this.walk.on;
    this.setReadout(null);
  }

  private onDoubleClick(e: MouseEvent): void {
    const hit = this.pick(e);
    if (hit) this.focusOn([hit.id]);
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const hit = this.pick(e);
    const id = hit && hit.kind !== 'room' ? hit.id : (hit?.id ?? null);
    if (id && !ui().selection.includes(id)) select([id]);
    const world = hit ? { x: hit.point.x / M, y: hit.point.z / M } : null;
    const items = contextMenuFor(id, world, '3d');
    if (items.length) setUi({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  }

  /** Keyboard from the global router while the 3D view is active. */
  handleKey(e: KeyboardEvent): boolean {
    const d = this.drag;
    if (d && (d.kind === 'wall' || d.kind === 'item') && /^[0-9.]$/.test(e.key)) {
      if (d.kind === 'wall') {
        const sign = d.offset < 0 ? -1 : 1;
        const floor = d.floor;
        const id = d.id;
        this.drag = { kind: 'awaitExact', apply: (mm) => editFloor('Move wall', () => moveWallPerpendicular(floor, id, sign * mm), { transient: true, base: floor }) };
        const r = this.renderer.domElement.getBoundingClientRect();
        setUi({ dimensionEdit: { target: { kind: 'moveOffset' }, x: r.left + r.width / 2, y: r.top + r.height / 2, current: Math.abs(d.offset), anchor: 'start', mode: 'connected', initialText: e.key } });
        return true;
      }
    }
    if (e.key === 'Escape') {
      if (this.walk.on) {
        setUi({ walkMode: false });
        return true;
      }
      if (this.drag) {
        this.endDrag(false);
        return true;
      }
    }
    if (this.walk.on && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].includes(e.key.toLowerCase())) return true;
    if (!this.walk.on && (e.key === 'g' || e.key === 'G')) {
      this.setGizmoMode(this.gizmoMode === 'move' ? 'rotate' : 'move');
      return true;
    }
    return false;
  }

  submitToolValue(mm: number): void {
    const d = this.drag;
    if (d?.kind === 'awaitExact') {
      d.apply(mm);
      commitTransaction();
      this.endDrag(true);
    }
  }

  private setReadout(text: string | null, e?: MouseEvent): void {
    const el = this.overlay;
    if (!text) {
      el.style.opacity = '0';
      return;
    }
    el.textContent = text;
    el.style.opacity = '1';
    if (e) {
      const r = this.container.getBoundingClientRect();
      el.style.transform = `translate(${e.clientX - r.left + 16}px, ${e.clientY - r.top + 16}px)`;
    }
  }

  // ── cameras ───────────────────────────────────────────────────────────
  setPreset(preset: CameraPreset, animate = true): void {
    if (this.walk.on) setUi({ walkMode: false });
    const { center, radius } = this.houseBounds();
    const c = center.clone().setY(0.4);
    const d = radius * 2.2 + 3;
    const pos = new THREE.Vector3();
    switch (preset) {
      case 'top':
        pos.set(c.x, d * 1.6, c.z + 0.0001);
        break;
      case 'front':
        pos.set(c.x, radius * 0.5 + 1.5, c.z + d);
        break;
      case 'back':
        pos.set(c.x, radius * 0.5 + 1.5, c.z - d);
        break;
      case 'left':
        pos.set(c.x - d, radius * 0.5 + 1.5, c.z);
        break;
      case 'right':
        pos.set(c.x + d, radius * 0.5 + 1.5, c.z);
        break;
      default:
        pos.set(c.x + d * 0.55, d * 0.75, c.z + d * 0.75);
    }
    if (preset === 'top') {
      this.useOrtho(true);
      const s = radius * 1.25 + 1;
      this.fitOrtho(s);
    } else if (this.camera === this.ortho && preset === 'perspective') this.useOrtho(false);
    if (preset !== 'top' && this.camera === this.ortho) this.fitOrtho(radius * 1.25 + 1);
    this.animateCamera(pos, c, animate ? 700 : 0);
  }

  get isOrtho(): boolean {
    return this.camera === this.ortho;
  }

  useOrtho(on: boolean): void {
    const from = this.camera;
    const to = on ? this.ortho : this.persp;
    if (from === to) return;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.controls.object = to;
    this.gizmo.camera = to;
    if (on) this.fitOrtho(this.houseBounds().radius * 1.25 + 1);
    this.controls.maxPolarAngle = on ? Math.PI / 2 : Math.PI * 0.495;
    this.resize();
    this.controls.update();
    this.requestRender();
  }

  private fitOrtho(half: number): void {
    const r = this.container.getBoundingClientRect();
    const aspect = r.width / Math.max(1, r.height);
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
  }

  private animateCamera(pos: THREE.Vector3, target: THREE.Vector3, dur: number): void {
    if (dur <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.tween = { from: this.camera.position.clone(), to: pos, tFrom: this.controls.target.clone(), tTo: target, start: performance.now(), dur };
    this.requestRender();
  }

  focusOn(ids: Id[]): void {
    const box = new THREE.Box3();
    for (const id of ids)
      for (const prefix of ['wall', 'item', 'opening', 'floor']) {
        const rec = this.recs.get(`${prefix}:${id}`);
        if (rec) box.expandByObject(rec.obj);
      }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.max(2.5, size * 1.6);
    this.animateCamera(c.clone().add(dir.multiplyScalar(dist)), c, 650);
  }

  // ── walk mode ─────────────────────────────────────────────────────────
  private setWalk(on: boolean): void {
    if (on === this.walk.on) return;
    this.walk.on = on;
    this.groups.ceilings.visible = on;
    this.controls.enabled = !on;
    this.gizmo.detach();
    if (on) {
      if (this.camera === this.ortho) this.useOrtho(false);
      const d = this.derivedCache;
      const room = d?.rooms.slice().sort((a, b) => b.area - a.area)[0];
      const start = room ? room.labelPoint : { x: this.controls.target.x / M, y: this.controls.target.z / M };
      this.persp.position.set(start.x * M, EYE_HEIGHT, start.y * M);
      this.walk.yaw = 0;
      this.walk.pitch = -0.05;
      this.applyWalkCamera();
      this.walk.last = performance.now();
      setUi({ hint: 'Walk: W A S D or arrows to move · drag to look · Shift to hurry · Esc to exit' });
    } else {
      this.walk.keys.clear();
      setUi({ hint: '' });
      this.setPreset('perspective');
      this.updateGizmo();
    }
    this.requestRender();
  }

  private applyWalkCamera(): void {
    const e = new THREE.Euler(this.walk.pitch, this.walk.yaw, 0, 'YXZ');
    this.persp.quaternion.setFromEuler(e);
    this.requestRender();
  }

  private onWalkKey(e: KeyboardEvent, down: boolean): void {
    if (!this.walk.on) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].includes(k)) {
      if (down) this.walk.keys.add(k);
      else this.walk.keys.delete(k);
      this.walk.last = performance.now();
      this.requestRender();
    }
  }

  private stepWalk(now: number): boolean {
    const keys = this.walk.keys;
    if (!keys.size) return false;
    const dt = Math.min(0.05, (now - this.walk.last) / 1000);
    this.walk.last = now;
    const speed = keys.has('shift') ? 3.2 : 1.5;
    let f = 0;
    let s = 0;
    if (keys.has('w') || keys.has('arrowup')) f += 1;
    if (keys.has('s') || keys.has('arrowdown')) f -= 1;
    if (keys.has('d')) s += 1;
    if (keys.has('a')) s -= 1;
    if (keys.has('arrowleft') || keys.has('q')) this.walk.yaw += dt * 1.8;
    if (keys.has('arrowright') || keys.has('e')) this.walk.yaw -= dt * 1.8;
    const fwd = new THREE.Vector3(-Math.sin(this.walk.yaw), 0, -Math.cos(this.walk.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    const p = this.persp.position;
    // Slide along walls: try each axis independently.
    const tryMove = (dx: number, dz: number) => {
      const nx = p.x + dx;
      const nz = p.z + dz;
      if (!this.collides({ x: nx / M, y: nz / M })) {
        p.x = nx;
        p.z = nz;
      }
    };
    tryMove(move.x, 0);
    tryMove(0, move.z);
    this.applyWalkCamera();
    return true;
  }

  private collides(pt: Vec2): boolean {
    const r = 220;
    for (const poly of this.walkCollision) {
      if (pointInPolygon(pt, poly)) return true;
      for (let i = 0; i < poly.length; i++) if (closestPointOnSegment(pt, poly[i], poly[(i + 1) % poly.length]).distance < r) return true;
    }
    return false;
  }

  // ── loop ──────────────────────────────────────────────────────────────
  requestRender(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    this.raf = 0;
    let active = false;
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.dur);
      const k = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, k);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, k);
      if (t >= 1) this.tween = null;
      active = true;
    }
    if (this.walk.on) active = this.stepWalk(now) || active;
    else if (this.controls.update()) active = true;
    if (this.dirty || active) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
    if (active || this.walk.keys.size) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = `${r.width}px`;
    this.renderer.domElement.style.height = `${r.height}px`;
    this.persp.aspect = r.width / r.height;
    this.persp.updateProjectionMatrix();
    if (this.camera === this.ortho) this.fitOrtho((this.ortho.top - this.ortho.bottom) / 2);
    this.requestRender();
  }

  /** Binary glTF of the building (walls, openings, floors, items). */
  async exportGLB(): Promise<Blob> {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const clone = this.root.clone(true);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.userData.baseMaterial) m.material = o.userData.baseMaterial;
    });
    const result = await exporter.parseAsync(clone, { binary: true });
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  lookupItem(id: Id): Item | undefined {
    return getActiveFloor()?.items[id];
  }
}

