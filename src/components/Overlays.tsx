import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { download, exportProjectFile } from '../app/projectActions';
import { SHORTCUTS } from '../app/shortcuts';
import { editors } from '../editor/registry';
import { exportGlb, exportSvg, measurementReport, printPlan } from '../export/exporters';
import { derivePlan } from '../geometry/derive';
import { formatArea, formatLength } from '../geometry/measurement/format';
import { safeFileName } from '../persistence/fileFormat';
import type { Id, ProjectDoc } from '../model/types';
import { updateSettings } from '../state/actions';
import { getActiveFloor, getDoc, setActiveVariant, useDocument } from '../state/documentStore';
import { setTheme, setUi, toast, useUi } from '../state/uiStore';
import { Switch } from './common';
import { Icon, type IconName } from './Icon';

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);
  if (!menu) return null;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 69 }} onPointerDown={() => setUi({ contextMenu: null })} onContextMenu={(e) => e.preventDefault()} />
      <div className="menu" ref={ref} style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y }} role="menu" data-testid="context-menu">
        {menu.items.map((it, i) =>
          it.separator ? (
            <div key={i} className="sep" />
          ) : (
            <button
              key={i}
              className={it.danger ? 'danger' : ''}
              disabled={it.disabled}
              role="menuitem"
              onClick={() => {
                setUi({ contextMenu: null });
                it.run?.();
              }}
            >
              {it.label}
              {it.shortcut && <span className="sc">{it.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="ico">
            <Icon name={t.tone === 'success' ? 'checkCircle' : t.tone === 'info' ? 'info' : 'alert'} size={16} />
          </span>
          <span>{t.message}</span>
          {t.action && (
            <button
              className="btn sm primary"
              onClick={() => {
                t.action!.run();
                setUi({ toasts: [] });
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Dialog({ title, children, footer, width }: { title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && setUi({ dialog: null })}>
      <div className="dialog" role="dialog" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={() => setUi({ dialog: null })} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'export':
      return <ExportDialog />;
    case 'shortcuts':
      return (
        <Dialog title="Keyboard shortcuts" width={620}>
          <div className="shortcuts">
            {SHORTCUTS.map(([label, keys]) => (
              <div className="r" key={label}>
                <span>{label}</span>
                <span className="kbd">{keys}</span>
              </div>
            ))}
          </div>
        </Dialog>
      );
    case 'settings':
      return <SettingsDialog />;
    case 'compare':
      return <CompareDialog />;
    default:
      return null;
  }
}

function ExportRow({ icon, title, desc, onClick, testId }: { icon: IconName; title: string; desc: string; onClick: () => void; testId?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="issue"
      style={{ borderRadius: 10, border: 'none', boxShadow: '0 0 0 1px var(--border) inset', marginBottom: 8 }}
      data-testid={testId}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch (e) {
          console.error(e);
          toast('Export failed', 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="ico" style={{ color: 'var(--accent)' }}>
        {busy ? <span className="spinner" /> : <Icon name={icon} size={18} />}
      </span>
      <span>
        <div className="t" style={{ fontWeight: 600 }}>
          {title}
        </div>
        <div className="s">{desc}</div>
      </span>
    </button>
  );
}

function ExportDialog() {
  const view = useUi((s) => s.renovationView);
  const ctx = () => {
    const doc = getDoc()!;
    const floor = getActiveFloor()!;
    return { doc, floor, base: `${safeFileName(doc.name)}-${safeFileName(doc.variants[Object.keys(doc.variants).find((k) => doc.variants[k].floors[floor.id] === floor) ?? doc.baseVariantId]?.name ?? 'plan')}` };
  };
  return (
    <Dialog title="Export">
      <ExportRow icon="file" title="Project file (.json)" desc="Everything, including sketches and all options. Re-open it on any device." onClick={exportProjectFile} testId="export-json" />
      <ExportRow
        icon="image"
        title="Floor plan image (.png)"
        desc="High-resolution plan with dimensions, as shown."
        onClick={async () => {
          const blob = await editors.plan?.exportPng(2);
          if (blob) download(blob, `${ctx().base}.png`);
        }}
      />
      <ExportRow
        icon="plan"
        title="Floor plan vector (.svg)"
        desc="Scalable drawing for contractors or further editing."
        onClick={() => {
          const { doc, floor, base } = ctx();
          download(new Blob([exportSvg(doc, floor, view)], { type: 'image/svg+xml' }), `${base}.svg`);
        }}
      />
      <ExportRow
        icon="download"
        title="Print / PDF"
        desc="Opens a print-ready page — choose “Save as PDF”."
        onClick={() => {
          const { doc, floor } = ctx();
          printPlan(doc, floor, view);
        }}
      />
      <ExportRow
        icon="cube"
        title="3D model (.glb)"
        desc="Open in Apple Quick Look, Blender, SketchUp and more."
        onClick={async () => {
          const { doc, floor, base } = ctx();
          download(await exportGlb(doc, floor, view === 'combined' ? 'proposed' : view), `${base}.glb`);
        }}
      />
      <ExportRow
        icon="ruler"
        title="Measurement report (.html)"
        desc="Rooms, areas, every wall, door and window — printable."
        onClick={() => {
          const { doc, floor, base } = ctx();
          download(new Blob([measurementReport(doc, floor)], { type: 'text/html' }), `${base}-report.html`);
        }}
      />
    </Dialog>
  );
}

function SettingsDialog() {
  const settings = useDocument((s) => s.doc?.settings);
  const theme = useUi((s) => s.theme);
  const snap = useUi((s) => s.snap);
  const strict = useUi((s) => s.strictMode);
  if (!settings) return null;
  const u = settings.units;
  return (
    <Dialog title="Settings">
      <div className="section" style={{ padding: '4px 0 14px' }}>
        <div className="section-title">Units</div>
        <div className="grid2">
          <div className="field">
            <label>System</label>
            <select className="input" value={u.system} onChange={(e) => updateSettings({ units: { ...u, system: e.target.value as 'imperial' | 'metric' } }, 'Change units')}>
              <option value="imperial">Feet & inches</option>
              <option value="metric">Metric</option>
            </select>
          </div>
          <div className="field">
            <label>Imperial precision</label>
            <select className="input" value={u.imperialPrecision} onChange={(e) => updateSettings({ units: { ...u, imperialPrecision: Number(e.target.value) as 1 | 2 | 4 | 8 | 16 } }, 'Change precision')}>
              {[1, 2, 4, 8, 16].map((p) => (
                <option key={p} value={p}>
                  {p === 1 ? '1"' : `1/${p}"`}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Metric unit</label>
            <select className="input" value={u.metricUnit} onChange={(e) => updateSettings({ units: { ...u, metricUnit: e.target.value as 'mm' | 'cm' | 'm' } }, 'Change metric unit')}>
              <option value="mm">Millimeters</option>
              <option value="cm">Centimeters</option>
              <option value="m">Meters</option>
            </select>
          </div>
          <div className="field">
            <label>Wall dimensions</label>
            <select className="input" value={settings.dimensionReference} onChange={(e) => updateSettings({ dimensionReference: e.target.value as 'centerline' | 'interior' }, 'Change dimension reference')}>
              <option value="centerline">Centerline</option>
              <option value="interior">Inside rooms</option>
            </select>
          </div>
        </div>
      </div>
      <div className="section" style={{ padding: '14px 0' }}>
        <div className="section-title">Appearance</div>
        <select className="input" value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'system')}>
          <option value="system">Match system</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
      <div className="section" style={{ padding: '14px 0', borderBottom: 0 }}>
        <div className="section-title">Snapping & placement</div>
        {(
          [
            ['endpoint', 'Corners & endpoints'],
            ['midpoint', 'Midpoints'],
            ['intersection', 'Intersections'],
            ['wall', 'Walls & faces'],
            ['angle', 'Angles (0°/45°/90° and existing walls)'],
            ['alignment', 'Alignment guides'],
            ['grid', 'Grid'],
          ] as const
        ).map(([k, label]) => (
          <Switch key={k} on={snap[k]} onChange={(v) => setUi({ snap: { ...snap, [k]: v } })} label={label} />
        ))}
        <Switch on={strict} onChange={(v) => setUi({ strictMode: v })} label="Strict mode (warn on collisions)" />
      </div>
    </Dialog>
  );
}

function CompareDialog() {
  const doc = useDocument((s) => s.doc);
  const active = useDocument((s) => s.variantId);
  const [a, setA] = useState<Id>(doc?.baseVariantId ?? '');
  const [b, setB] = useState<Id>(active);
  const units = doc?.settings.units;
  const diff = useMemo(() => (doc ? compareVariants(doc, a, b) : null), [doc, a, b]);
  useEffect(() => {
    if (doc && a === b && doc.variantOrder.length > 1) setB(doc.variantOrder.find((v) => v !== a)!);
  }, [a, b, doc]);
  if (!doc || !diff || !units) return null;
  const sel = (v: Id, set: (id: Id) => void) => (
    <select className="input" value={v} onChange={(e) => set(e.target.value)}>
      {doc.variantOrder.map((id) => (
        <option key={id} value={id}>
          {doc.variants[id].name}
        </option>
      ))}
    </select>
  );
  const delta = diff.areaB - diff.areaA;
  return (
    <Dialog
      title="Compare options"
      width={620}
      footer={
        <>
          <button
            className="btn outline"
            onClick={() => {
              setActiveVariant(b);
              setUi({ showBaseGhost: true, dialog: null, viewMode: '2d' });
            }}
          >
            Overlay measured plan on “{doc.variants[b].name}”
          </button>
          <button className="btn primary" onClick={() => setUi({ dialog: null })}>
            Done
          </button>
        </>
      }
    >
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>From</label>
          {sel(a, setA)}
        </div>
        <div className="field">
          <label>To</label>
          {sel(b, setB)}
        </div>
      </div>
      <div className="issue-summary" style={{ padding: 0, marginBottom: 14 }}>
        <div className="stat">
          <div className="n">{formatArea(diff.areaB, units)}</div>
          <div className="l">
            Total room area ({delta >= 0 ? '+' : '−'}
            {formatArea(Math.abs(delta), units)})
          </div>
        </div>
        <div className="stat">
          <div className="n">{diff.changes.length}</div>
          <div className="l">Differences</div>
        </div>
      </div>
      {diff.rooms.length > 0 && (
        <>
          <div className="section-title" style={{ margin: '6px 0' }}>
            Rooms
          </div>
          {diff.rooms.map((r) => (
            <div key={r.name} className="row between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{r.name}</span>
              <span className="tnum muted">
                {r.a !== null ? formatArea(r.a, units) : '—'} → {r.b !== null ? formatArea(r.b, units) : '—'}
              </span>
            </div>
          ))}
        </>
      )}
      <div className="section-title" style={{ margin: '14px 0 6px' }}>
        Changes
      </div>
      {diff.changes.length === 0 && <span className="muted">These options are identical.</span>}
      {diff.changes.slice(0, 80).map((c, i) => (
        <div key={i} className="row" style={{ padding: '4px 0', fontSize: 12.5 }}>
          <span className={`chip ${c.kind === 'added' ? 'info' : c.kind === 'removed' ? 'danger' : 'warning'}`}>{c.kind}</span>
          <span>{c.label}</span>
          {c.detail && <span className="muted">{c.detail.replace(/\{(\d+(?:\.\d+)?)\}/g, (_, n) => formatLength(Number(n), units))}</span>}
        </div>
      ))}
    </Dialog>
  );
}

interface Change {
  kind: 'added' | 'removed' | 'changed';
  label: string;
  detail?: string;
}

/** Element-level diff: ids are shared between the base and its options. */
export function compareVariants(doc: ProjectDoc, aId: Id, bId: Id) {
  const va = doc.variants[aId];
  const vb = doc.variants[bId];
  const fa = va.floors[va.floorOrder[0]];
  const fb = vb.floors[vb.floorOrder[0]];
  const changes: Change[] = [];
  const live = <T extends { status: string }>(x: T | undefined) => !!x && x.status !== 'demolish';
  const len = (f: typeof fa, id: Id) => {
    const w = f.walls[id];
    return Math.hypot(f.nodes[w.b].x - f.nodes[w.a].x, f.nodes[w.b].y - f.nodes[w.a].y);
  };
  for (const id of new Set([...Object.keys(fa.walls), ...Object.keys(fb.walls)])) {
    const A = live(fa.walls[id]);
    const B = live(fb.walls[id]);
    if (A && !B) changes.push({ kind: 'removed', label: 'Wall', detail: `{${len(fa, id)}}` });
    else if (!A && B) changes.push({ kind: 'added', label: 'Wall', detail: `{${len(fb, id)}}` });
    else if (A && B && Math.abs(len(fa, id) - len(fb, id)) > 1) changes.push({ kind: 'changed', label: 'Wall length', detail: `{${len(fa, id)}} → {${len(fb, id)}}` });
  }
  for (const id of new Set([...Object.keys(fa.openings), ...Object.keys(fb.openings)])) {
    const A = live(fa.openings[id]);
    const B = live(fb.openings[id]);
    const o = fb.openings[id] ?? fa.openings[id];
    const name = o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Opening';
    if (A && !B) changes.push({ kind: 'removed', label: name, detail: `{${o.width}} wide` });
    else if (!A && B) changes.push({ kind: 'added', label: name, detail: `{${o.width}} wide` });
    else if (A && B && (fa.openings[id].width !== fb.openings[id].width || Math.abs(fa.openings[id].offset - fb.openings[id].offset) > 1 || fa.openings[id].wallId !== fb.openings[id].wallId))
      changes.push({ kind: 'changed', label: name, detail: 'moved or resized' });
  }
  for (const id of new Set([...Object.keys(fa.items), ...Object.keys(fb.items)])) {
    const A = live(fa.items[id]);
    const B = live(fb.items[id]);
    const it = fb.items[id] ?? fa.items[id];
    if (A && !B) changes.push({ kind: 'removed', label: it.name ?? 'Item' });
    else if (!A && B) changes.push({ kind: 'added', label: it.name ?? 'Item' });
    else if (A && B && (Math.hypot(fa.items[id].x - fb.items[id].x, fa.items[id].y - fb.items[id].y) > 1 || fa.items[id].rotation !== fb.items[id].rotation)) changes.push({ kind: 'changed', label: it.name ?? 'Item', detail: 'moved' });
  }
  const ra = derivePlan(fa, 'proposed').rooms;
  const rb = derivePlan(fb, 'proposed').rooms;
  const names = new Set([...ra.map((r) => r.room.name), ...rb.map((r) => r.room.name)]);
  const rooms = [...names].map((name) => ({ name, a: ra.find((r) => r.room.name === name)?.area ?? null, b: rb.find((r) => r.room.name === name)?.area ?? null })).filter((r) => r.a === null || r.b === null || Math.abs(r.a - r.b) > 1000);
  return { changes, rooms, areaA: ra.reduce((s, r) => s + r.area, 0), areaB: rb.reduce((s, r) => s + r.area, 0) };
}

