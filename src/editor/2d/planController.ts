import { derivePlan, type PlanDerived } from '../../geometry/derive';
import { formatLength } from '../../geometry/measurement/format';
import { bounds } from '../../geometry/primitives/polygon';
import type { Vec2 } from '../../geometry/primitives/vec';
import { snapPoint, type SnapResult } from '../../geometry/snapping/snap';
import { itemFootprint } from '../../geometry/items/items';
import type { Floor, Id } from '../../model/types';
import { getRepository } from '../../persistence/repository';
import { documentStore, getActiveFloor } from '../../state/documentStore';
import { setUi, ui, uiStore, type DimensionTarget, type Tool } from '../../state/uiStore';
import { contextMenuFor } from '../contextMenus';
import { hitTest, type Hit, type HitContext } from './hitTest';
import { readPalette, type PlanPalette } from './palette';
import { renderPlan, type LabelHit, type RoomLabelHit, type ToolOverlay } from './renderer';
import { DimensionTool, ItemTool, MeasureTool, OpeningTool, RoomTool, TextTool, WallTool } from './tools/drawTools';
import { SelectTool, setLastClient } from './tools/selectTool';
import type { SnapRequest, Tool2D, ToolEvent, ToolHost } from './tools/types';
import { Viewport } from './viewport';
import { editors, type PlanEditorApi } from '../registry';

/**
 * Imperative 2D editor. React mounts it once; it subscribes directly to the
 * stores and redraws on requestAnimationFrame only when something changed,
 * so pointer movement never re-renders React components.
 */
export class PlanController implements ToolHost, PlanEditorApi {
  readonly vp = new Viewport();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private palette: PlanPalette;
  private overlay: ToolOverlay = {};
  private labels: LabelHit[] = [];
  private roomLabels: RoomLabelHit[] = [];
  private hoverLabel: string | null = null;
  private dirty = true;
  private raf = 0;
  private tools: Record<string, Tool2D>;
  private tool: Tool2D;
  private unsubs: Array<() => void> = [];
  private panning: { last: Vec2; pointerId: number } | null = null;
  private spaceDown = false;
  private touches = new Map<number, Vec2>();
  private pinch: { dist: number; mid: Vec2 } | null = null;
  private underlayImg: { key: string; img: HTMLImageElement } | null = null;
  private fittedFloor: Id | null = null;
  private lastStatus = 0;
  private resizeObs: ResizeObserver;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.palette = readPalette();
    this.tools = {
      select: new SelectTool(this),
      wall: new WallTool(this),
      room: new RoomTool(this),
      door: new OpeningTool(this, 'door'),
      window: new OpeningTool(this, 'window'),
      opening: new OpeningTool(this, 'opening'),
      item: new ItemTool(this),
      dimension: new DimensionTool(this),
      measure: new MeasureTool(this),
      text: new TextTool(this),
    };
    this.tool = this.tools.select;

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.unsubs.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e));
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', (e) => this.onPointerUp(e));
    on('pointerleave', () => {
      if (!this.panning) {
        setUi({ cursor: null, hover: null });
      }
    });
    on('dblclick', (e) => this.tool.doubleClick?.(this.toolEvent(e)));
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('contextmenu', (e) => this.onContextMenu(e));
    // Safari trackpad pinch
    on('gesturestart' as keyof HTMLElementEventMap, (e) => e.preventDefault());
    on('gesturechange' as keyof HTMLElementEventMap, (e) => e.preventDefault());

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.setCursor(this.tool.cursor);
      }
    };
    window.addEventListener('keyup', onKeyUp);
    this.unsubs.push(() => window.removeEventListener('keyup', onKeyUp));

    this.unsubs.push(
      documentStore.subscribe((s, p) => {
        if (s.doc !== p.doc || s.floorId !== p.floorId || s.variantId !== p.variantId) this.requestRender();
        if (s.floorId !== p.floorId || s.doc?.id !== p.doc?.id) this.fittedFloor = null;
      }),
      uiStore.subscribe((s, p) => {
        if (s.tool !== p.tool || s.placingCatalogId !== p.placingCatalogId) this.switchTool(s.tool);
        if (s.theme !== p.theme) requestAnimationFrame(() => this.refreshPalette());
        if (
          s.selection !== p.selection ||
          s.hover !== p.hover ||
          s.renovationView !== p.renovationView ||
          s.showDimensions !== p.showDimensions ||
          s.showGrid !== p.showGrid ||
          s.showRoomLabels !== p.showRoomLabels ||
          s.showFurniture !== p.showFurniture ||
          s.showBaseGhost !== p.showBaseGhost ||
          s.dimensionEdit !== p.dimensionEdit
        )
          this.requestRender();
        if (s.focusRequest !== p.focusRequest && s.focusRequest) this.focusOn(s.focusRequest.ids);
      }),
    );
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => this.refreshPalette();
    mq.addEventListener('change', onScheme);
    this.unsubs.push(() => mq.removeEventListener('change', onScheme));
    editors.plan = this;
    this.switchTool(ui().tool);
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.tool.deactivate?.();
    for (const u of this.unsubs) u();
    if (editors.plan === this) editors.plan = null;
  }

  // ── ToolHost ───────────────────────────────────────────────────────────
  floor(): Floor {
    return getActiveFloor()!;
  }
  derived(): PlanDerived {
    return derivePlan(this.floor(), ui().renovationView);
  }
  units() {
    return documentStore.getState().doc!.settings.units;
  }
  roundStep(): number {
    return this.units().system === 'imperial' ? 12.7 : 5;
  }
  snap(e: ToolEvent, req: SnapRequest = {}): SnapResult {
    const s = ui();
    const floor = this.floor();
    const enabled = s.snapEnabled && !e.alt;
    return snapPoint(e.world, {
      floor,
      geometry: this.derived().geometry,
      radius: this.vp.px(12),
      gridSize: s.showGrid ? (documentStore.getState().doc?.settings.gridSize ?? 152.4) : 0,
      options: enabled ? s.snap : { ...s.snap, endpoint: false, midpoint: false, intersection: false, wall: false, angle: false, alignment: false, grid: false },
      from: req.from,
      excludeNodes: new Set(req.excludeNodes ?? []),
      excludeWalls: new Set(req.excludeWalls ?? []),
      lengthStep: req.lengthStep && enabled ? this.roundStep() : undefined,
    });
  }
  hitContext(): HitContext {
    const s = ui();
    return {
      floor: this.floor(),
      derived: this.derived(),
      vp: this.vp,
      selection: new Set(s.selection),
      labels: this.labels,
      roomLabels: this.roomLabels,
      view: s.renovationView,
      showFurniture: s.showFurniture,
    };
  }
  hit(e: ToolEvent, opts?: { labels?: boolean; handles?: boolean }): Hit | null {
    return hitTest(e.world, e.screen, this.hitContext(), opts);
  }
  setOverlay(o: ToolOverlay): void {
    this.overlay = o;
    this.requestRender();
  }
  setCursor(c: string): void {
    const cursor = this.spaceDown || this.panning ? (this.panning ? 'grabbing' : 'grab') : c;
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }
  setHint(text: string): void {
    if (ui().hint !== text) setUi({ hint: text });
  }
  setHoverLabel(key: string | null): void {
    if (this.hoverLabel !== key) {
      this.hoverLabel = key;
      this.requestRender();
    }
  }
  requestRender(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  openValueInput(target: DimensionTarget, client: Vec2, current: number, initialText?: string): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = client.x < rect.left || client.x > rect.right ? rect.left + client.x : client.x;
    const y = client.y < rect.top || client.y > rect.bottom ? rect.top + client.y : client.y;
    setUi({ dimensionEdit: { target, x, y, current, anchor: 'start', mode: 'connected', initialText } });
  }
  closeValueInput(): void {
    if (ui().dimensionEdit) setUi({ dimensionEdit: null });
  }

  /** Called by the dimension popover for tool-owned values (draw length, exact move). */
  submitToolValue(mm: number, text: string): void {
    this.tool.submitValue?.(mm, text);
  }

  // ── tools ─────────────────────────────────────────────────────────────
  private switchTool(t: Tool): void {
    const next = this.tools[t] ?? this.tools.select;
    if (next !== this.tool) {
      this.tool.deactivate?.();
      this.tool = next;
    }
    this.overlay = {};
    this.setHint('');
    this.tool.activate?.();
    this.setCursor(this.tool.cursor);
    this.requestRender();
  }

  /** Keyboard routing from the global shortcut handler. Returns true if consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Space' && !e.repeat) {
      this.spaceDown = true;
      this.setCursor('grab');
      return true;
    }
    if (e.key === 'Escape') {
      if (this.tool.cancel()) return true;
      if (ui().tool !== 'select') {
        setUi({ tool: 'select', placingCatalogId: null });
        return true;
      }
      return false;
    }
    return this.tool.keyDown?.(e) ?? false;
  }

  // ── input ─────────────────────────────────────────────────────────────
  private toolEvent(e: PointerEvent | MouseEvent): ToolEvent {
    const r = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return {
      world: this.vp.toWorld(screen),
      screen,
      client: { x: e.clientX, y: e.clientY },
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      button: e.button,
      pointerType: (e as PointerEvent).pointerType ?? 'mouse',
    };
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    setUi({ contextMenu: null });
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.tool.cancel();
        const [a, b] = [...this.touches.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
    }
    if (e.button === 1 || (e.button === 0 && (this.spaceDown || ui().tool === 'pan'))) {
      this.panning = { last: { x: e.clientX, y: e.clientY }, pointerId: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
      this.setCursor('grabbing');
      e.preventDefault();
      return;
    }
    if (e.button === 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.tool.pointerDown(this.toolEvent(e));
  }

  private onPointerMove(e: PointerEvent): void {
    setLastClient({ x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const r = this.canvas.getBoundingClientRect();
        this.vp.panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
        this.vp.zoomAt({ x: mid.x - r.left, y: mid.y - r.top }, d / this.pinch.dist);
        this.pinch = { dist: d, mid };
        this.afterViewChange();
        return;
      }
    }
    if (this.panning) {
      this.vp.panBy(e.clientX - this.panning.last.x, e.clientY - this.panning.last.y);
      this.panning.last = { x: e.clientX, y: e.clientY };
      this.afterViewChange();
      return;
    }
    const te = this.toolEvent(e);
    this.tool.pointerMove(te);
    const now = performance.now();
    if (now - this.lastStatus > 50) {
      this.lastStatus = now;
      setUi({ cursor: te.world });
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
    }
    if (this.panning && this.panning.pointerId === e.pointerId) {
      this.panning = null;
      this.setCursor(this.spaceDown ? 'grab' : this.tool.cursor);
      return;
    }
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (e.type === 'pointercancel') {
      this.tool.cancel();
      return;
    }
    this.tool.pointerUp(this.toolEvent(e));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    // Trackpad pinch (ctrlKey) and mouse wheels zoom; two-finger scroll pans (Figma-style).
    const isMouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || isMouseWheel) {
      const k = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.012 : 0.0022;
      this.vp.zoomAt(p, Math.exp(-e.deltaY * k));
    } else {
      this.vp.panBy(-e.deltaX, -e.deltaY);
    }
    this.afterViewChange();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const te = this.toolEvent(e);
    if (this.tool.cancel() && ui().tool !== 'select') return;
    const hit = this.hit(te, { labels: false, handles: false });
    const id = hit?.kind === 'element' ? hit.id : hit?.kind === 'roomLabel' ? hit.roomId : null;
    if (id && !ui().selection.includes(id)) setUi({ selection: [id] });
    const items = contextMenuFor(id, te.world, 'plan');
    if (items.length) setUi({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  }

  private afterViewChange(): void {
    setUi({ zoomPercent: Math.round((this.vp.scale / 0.08) * 100), dimensionEdit: null });
    this.requestRender();
  }

  // ── view ──────────────────────────────────────────────────────────────
  private resize(): void {
    const parent = this.canvas.parentElement!;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const cx = this.vp.width / 2;
    const cy = this.vp.height / 2;
    this.vp.width = w;
    this.vp.height = h;
    // Keep the view centered on the same world point when the panel resizes.
    if (cx > 1) this.vp.panBy(w / 2 - cx, h / 2 - cy);
    this.requestRender();
  }

  private refreshPalette(): void {
    this.palette = readPalette();
    this.requestRender();
  }

  contentBounds(ids?: Id[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const f = getActiveFloor();
    if (!f) return null;
    const pts: Vec2[] = [];
    const want = ids ? new Set(ids) : null;
    for (const w of Object.values(f.walls)) {
      if (want && !want.has(w.id)) continue;
      pts.push(f.nodes[w.a], f.nodes[w.b]);
    }
    for (const it of Object.values(f.items)) if (!want || want.has(it.id)) pts.push(...itemFootprint(it));
    for (const o of Object.values(f.openings)) {
      if (want?.has(o.id)) {
        const w = f.walls[o.wallId];
        pts.push(f.nodes[w.a], f.nodes[w.b]);
      }
    }
    for (const r of Object.values(f.rooms)) if (want?.has(r.id)) pts.push(r.anchor);
    return pts.length ? bounds(pts) : null;
  }

  zoomToFit(animate = true): void {
    const b = this.contentBounds();
    const target = b ? this.vp.fitTarget(b, 90) : this.vp.fitTarget({ minX: -3000, minY: -3000, maxX: 9000, maxY: 7000 });
    this.vp.animateTo(target, animate ? 480 : 0);
    this.afterViewChange();
  }

  zoomBy(factor: number): void {
    const target: [number, number, number] = [this.vp.scale * factor, 0, 0];
    const c = { x: this.vp.width / 2, y: this.vp.height / 2 };
    const w = this.vp.toWorld(c);
    target[0] = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, target[0]));
    target[1] = c.x - w.x * target[0];
    target[2] = c.y - w.y * target[0];
    this.vp.animateTo(target, 220);
    this.afterViewChange();
  }

  focusOn(ids: Id[]): void {
    const b = this.contentBounds(ids);
    if (!b) return;
    const pad = 1500;
    this.vp.animateTo(this.vp.fitTarget({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, 60), 520);
    this.afterViewChange();
  }

  private loadUnderlay(floor: Floor): { image: CanvasImageSource; underlay: NonNullable<Floor['underlay']> } | null {
    const u = floor.underlay;
    if (!u) return null;
    const src = documentStore.getState().doc?.sources[u.sourceId];
    if (!src) return null;
    if (this.underlayImg?.key !== src.blobKey) {
      const key = src.blobKey;
      this.underlayImg = { key, img: new Image() };
      const holder = this.underlayImg;
      void getRepository()
        .getBlob(key)
        .then((blob) => {
          if (!blob || this.underlayImg !== holder) return;
          holder.img.onload = () => this.requestRender();
          holder.img.src = URL.createObjectURL(blob);
        });
    }
    return this.underlayImg.img.complete && this.underlayImg.img.naturalWidth ? { image: this.underlayImg.img, underlay: u } : null;
  }

  private frame(now: number): void {
    this.raf = 0;
    const animating = this.vp.tick(now);
    if (animating) setUi({ zoomPercent: Math.round((this.vp.scale / 0.08) * 100) });
    if (!this.dirty && !animating) return;
    this.dirty = false;
    const st = documentStore.getState();
    const floor = getActiveFloor();
    if (!floor || !st.doc) return;
    if (this.fittedFloor !== floor.id && this.vp.width > 1) {
      this.fittedFloor = floor.id;
      const b = this.contentBounds();
      this.vp.animateTo(b ? this.vp.fitTarget(b, 90) : this.vp.fitTarget({ minX: -3000, minY: -3000, maxX: 9000, maxY: 7000 }), 0);
      setUi({ zoomPercent: Math.round((this.vp.scale / 0.08) * 100) });
    }
    const s = ui();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    let ghost: PlanDerived | null = null;
    if (s.showBaseGhost && st.variantId !== st.doc.baseVariantId) {
      const baseFloor = st.doc.variants[st.doc.baseVariantId].floors[floor.id];
      if (baseFloor) ghost = derivePlan(baseFloor, 'existing');
    }
    const editing = s.dimensionEdit;
    const out = renderPlan({
      ctx,
      vp: this.vp,
      derived: derivePlan(floor, s.renovationView),
      floor,
      palette: this.palette,
      units: st.doc.settings.units,
      dimensionReference: st.doc.settings.dimensionReference,
      view: s.renovationView,
      selection: new Set(s.selection),
      hover: s.hover,
      hoverLabel: this.hoverLabel,
      editingLabel: editing ? labelKeyFor(editing.target) : null,
      showDimensions: s.showDimensions,
      showGrid: s.showGrid,
      showRoomLabels: s.showRoomLabels,
      showFurniture: s.showFurniture,
      gridSize: st.doc.settings.gridSize,
      overlay: this.overlay,
      underlay: this.loadUnderlay(floor),
      ghost,
      time: now,
    });
    this.labels = out.labels;
    this.roomLabels = out.roomLabels;
    if (this.vp.animating) this.requestRender();
  }

  /** Small PNG of the current plan for the project gallery. */
  thumbnail(w = 360, h = 240): string | undefined {
    const floor = getActiveFloor();
    const doc = documentStore.getState().doc;
    if (!floor || !doc) return undefined;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const vp = new Viewport();
    vp.width = w;
    vp.height = h;
    const b = this.contentBounds();
    if (!b) return undefined;
    [vp.scale, vp.panX, vp.panY] = vp.fitTarget(b, 18);
    renderPlan({
      ctx,
      vp,
      derived: derivePlan(floor, 'proposed'),
      floor,
      palette: this.palette,
      units: doc.settings.units,
      dimensionReference: doc.settings.dimensionReference,
      view: 'proposed',
      selection: new Set(),
      hover: null,
      hoverLabel: null,
      editingLabel: null,
      showDimensions: false,
      showGrid: false,
      showRoomLabels: false,
      showFurniture: true,
      gridSize: doc.settings.gridSize,
      overlay: {},
      time: 0,
    });
    return c.toDataURL('image/png');
  }

  /** Full-resolution PNG export of the plan with dimensions. */
  exportPng(scale = 2): Promise<Blob | null> {
    const floor = getActiveFloor();
    const doc = documentStore.getState().doc;
    const b = this.contentBounds();
    if (!floor || !doc || !b) return Promise.resolve(null);
    const pxPerMm = 0.12 * scale;
    const pad = 160 * scale;
    const w = Math.ceil((b.maxX - b.minX) * pxPerMm + pad * 2);
    const h = Math.ceil((b.maxY - b.minY) * pxPerMm + pad * 2);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const vp = new Viewport();
    vp.width = w;
    vp.height = h;
    vp.scale = pxPerMm;
    vp.panX = pad - b.minX * pxPerMm;
    vp.panY = pad - b.minY * pxPerMm;
    renderPlan({
      ctx,
      vp,
      derived: derivePlan(floor, ui().renovationView),
      floor,
      palette: this.palette,
      units: doc.settings.units,
      dimensionReference: doc.settings.dimensionReference,
      view: ui().renovationView,
      selection: new Set(),
      hover: null,
      hoverLabel: null,
      editingLabel: null,
      showDimensions: true,
      showGrid: false,
      showRoomLabels: true,
      showFurniture: ui().showFurniture,
      gridSize: doc.settings.gridSize,
      overlay: {},
      time: 0,
    });
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  formatCursor(p: Vec2): string {
    const u = this.units();
    return `${formatLength(p.x, u)}, ${formatLength(p.y, u)}`;
  }
}

function labelKeyFor(t: DimensionTarget): string | null {
  switch (t.kind) {
    case 'wallLength':
      return t.reference === 'centerline' ? `wall-${t.wallId}` : null;
    case 'itemDistance':
      return `itd-${t.itemId}-${t.side}`;
    case 'openingOffset':
      return `op-${t.openingId}-${t.from}`;
    case 'openingWidth':
      return `op-${t.openingId}-width`;
    default:
      return null;
  }
}

