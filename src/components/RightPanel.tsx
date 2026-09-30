import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, CATEGORY_LABELS, type CatalogEntry } from '../assets/catalog';
import { derivePlan } from '../geometry/derive';
import { formatArea, formatLength } from '../geometry/measurement/format';
import type { Id, ItemCategory, Variant } from '../model/types';
import { createVariant, deleteVariant, promoteVariantToBase, renameVariant, setBaseLocked } from '../state/actions';
import { setActiveVariant, travelTo, useDocument } from '../state/documentStore';
import { requestFocus, select, setTool, setUi, useUi, type RightPanel as PanelId } from '../state/uiStore';
import { drawSymbol } from '../editor/2d/symbols';
import { useUnits } from './common';
import { Icon, type IconName } from './Icon';
import { Inspector } from './Inspector';
import { useIssues } from './issues';

const TABS: Array<{ id: PanelId; label: string; icon: IconName }> = [
  { id: 'inspector', label: 'Properties', icon: 'settings' },
  { id: 'library', label: 'Library', icon: 'sofa' },
  { id: 'issues', label: 'Check', icon: 'check' },
  { id: 'variants', label: 'Options', icon: 'layers' },
  { id: 'history', label: 'History', icon: 'history' },
];

export function RightPanel() {
  const open = useUi((s) => s.rightPanelOpen);
  const tab = useUi((s) => s.rightPanel);
  const width = useUi((s) => s.rightPanelWidth);
  const issues = useIssues();
  const warn = issues.filter((i) => i.severity !== 'info').length;

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setUi({ rightPanelWidth: Math.min(560, Math.max(260, startW - (ev.clientX - startX))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className={`panel${open ? '' : ' closed'}`} style={{ width, ['--panel-w' as string]: `${width}px` }} aria-hidden={!open}>
      <div className="panel-resize" onPointerDown={startResize} />
      <div className="panel-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setUi({ rightPanel: t.id })} data-testid={`tab-${t.id}`}>
            {t.label}
            {t.id === 'issues' && warn > 0 && <span className="badge">{warn}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body" key={tab} style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'inspector' && <Inspector />}
        {tab === 'library' && <Library />}
        {tab === 'issues' && <IssuesPanel />}
        {tab === 'variants' && <VariantsPanel />}
        {tab === 'history' && <HistoryPanel />}
      </div>
    </aside>
  );
}

// ── Library ───────────────────────────────────────────────────────────────

function Library() {
  const [cat, setCat] = useState<ItemCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const placing = useUi((s) => s.placingCatalogId);
  const units = useUnits();
  const cats = useMemo(() => [...new Set(CATALOG.map((c) => c.category))], []);
  const list = CATALOG.filter((c) => (cat === 'all' || c.category === cat) && c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="lib-search">
        <input className="input" placeholder="Search beds, sinks, cabinets…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="lib-cats">
        <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>
          All
        </button>
        {cats.map((c) => (
          <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <div className="lib-grid">
          {list.map((c, i) => (
            <button
              key={c.id}
              className={`lib-card${placing === c.id ? ' on' : ''}`}
              style={{ animationDelay: `${Math.min(i, 16) * 18}ms` }}
              onClick={() => setTool('item', c.id)}
              data-testid={`lib-${c.id}`}
            >
              <SymbolPreview entry={c} />
              <span className="name">{c.name}</span>
              <span className="dims">
                {formatLength(c.width, units)} × {formatLength(c.depth, units)}
              </span>
            </button>
          ))}
        </div>
        <p className="muted" style={{ padding: '0 14px 16px', fontSize: 11.5 }}>
          Click an item, then click on the plan to place it. Cabinets, beds and appliances snap against walls. Press R to rotate while placing.
        </p>
      </div>
    </>
  );
}

function SymbolPreview({ entry }: { entry: CatalogEntry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 110;
    const h = c.clientHeight || 64;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const s = Math.min((w - 16) / entry.width, (h - 12) / entry.depth);
    ctx.translate(w / 2, h / 2);
    ctx.lineWidth = 1.1;
    const shape = entry.shape;
    drawSymbol(ctx, shape, entry.width * s, entry.depth * s, cs.getPropertyValue('--canvas-furniture').trim(), cs.getPropertyValue('--canvas-furniture-stroke').trim());
  }, [entry, theme]);
  return <canvas ref={ref} />;
}

// ── Issues / measurement check ────────────────────────────────────────────

function IssuesPanel() {
  const issues = useIssues();
  const obs = useDocument((s) => s.doc?.observations);
  const counts = useMemo(() => {
    const o = Object.values(obs ?? {}).filter((x) => x.status !== 'rejected' && x.valueMm !== undefined);
    return {
      total: o.length,
      confirmed: o.filter((x) => x.status === 'confirmed' || x.approximate).length,
      ambiguous: o.filter((x) => (x.status === 'ambiguous' || x.status === 'likely') && !x.approximate).length,
      conflicts: o.filter((x) => x.status === 'conflicting' && !x.approximate).length,
    };
  }, [obs]);
  const geometry = issues.filter((i) => i.source === 'geometry');
  const unconstrained = issues.filter((i) => i.source === 'unconstrained').length;
  const verified = counts.total > 0 && counts.ambiguous === 0 && counts.conflicts === 0 && unconstrained === 0;
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <div className="issue-summary">
        <div className="stat">
          <div className="n" style={{ color: 'var(--success)' }}>
            {counts.confirmed}
          </div>
          <div className="l">Confirmed measurements</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: counts.ambiguous ? 'var(--warning)' : undefined }}>
            {counts.ambiguous}
          </div>
          <div className="l">Ambiguous</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: counts.conflicts ? 'var(--danger)' : undefined }}>
            {counts.conflicts}
          </div>
          <div className="l">Conflicts</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: unconstrained ? 'var(--warning)' : undefined }}>
            {unconstrained}
          </div>
          <div className="l">Unmeasured walls</div>
        </div>
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        {verified ? (
          <span className="chip success">
            <Icon name="checkCircle" size={12} /> Verified — every dimension is resolved
          </span>
        ) : counts.total > 0 ? (
          <span className="chip warning">Not yet verified — resolve the items below</span>
        ) : (
          <span className="chip">No imported measurements yet</span>
        )}
      </div>
      {issues.length === 0 ? (
        <div className="empty-state">
          <div className="art">
            <Icon name="checkCircle" size={26} />
          </div>
          <h4>Nothing to fix</h4>
          <p>No overlaps, blocked doors, or geometry problems found.</p>
        </div>
      ) : (
        <>
          {[...geometry, ...issues.filter((i) => i.source !== 'geometry')].map((i) => (
            <button
              key={i.id}
              className="issue"
              onClick={() => {
                if (i.ids.length) {
                  select(i.ids.filter((id) => !id.startsWith('obs')));
                  requestFocus(i.ids);
                }
                if (i.openImport) setUi({ screen: 'import' });
              }}
            >
              <span className="ico" style={{ color: i.severity === 'error' ? 'var(--danger)' : i.severity === 'warning' ? 'var(--warning)' : 'var(--info)' }}>
                <Icon name={i.severity === 'info' ? 'info' : 'alert'} size={15} />
              </span>
              <span>
                <div className="t">{i.title}</div>
                {i.detail && <div className="s">{i.detail}</div>}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── Variants ──────────────────────────────────────────────────────────────

function VariantsPanel() {
  const doc = useDocument((s) => s.doc);
  const active = useDocument((s) => s.variantId);
  const units = useUnits();
  const [editing, setEditing] = useState<Id | null>(null);
  if (!doc) return null;
  const area = (v: Variant) => {
    const f = v.floors[v.floorOrder[0]];
    return f ? derivePlan(f, 'proposed').rooms.reduce((s, r) => s + r.area, 0) : 0;
  };
  return (
    <div className="scroll" style={{ height: '100%', paddingTop: 6 }}>
      {doc.variantOrder.map((id, i) => {
        const v = doc.variants[id];
        const isBase = id === doc.baseVariantId;
        const f = v.floors[v.floorOrder[0]];
        const changes = f ? Object.values(f.walls).filter((w) => w.status !== 'existing').length + Object.values(f.items).filter((x) => x.status !== 'existing').length + Object.values(f.openings).filter((x) => x.status !== 'existing').length : 0;
        return (
          <div key={id} className={`variant${active === id ? ' on' : ''}`} style={{ animationDelay: `${i * 40}ms` }} onClick={() => setActiveVariant(id)} data-testid={`variant-${i}`}>
            <div className="vicon" style={{ color: isBase ? 'var(--success)' : 'var(--accent)' }}>
              <Icon name={isBase ? 'target' : 'sparkles'} size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editing === id ? (
                <input
                  className="input"
                  autoFocus
                  defaultValue={v.name}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={(e) => {
                    if (e.target.value.trim()) renameVariant(id, e.target.value.trim());
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="vname" onDoubleClick={() => setEditing(id)}>
                  {v.name}
                </div>
              )}
              <div className="vmeta">
                {isBase ? (doc.baseLocked ? 'Measured · locked' : 'Measured · editable') : `${changes} change${changes === 1 ? '' : 's'}`} · {formatArea(area(v), units)}
              </div>
            </div>
            <div className="row" onClick={(e) => e.stopPropagation()} style={{ gap: 0 }}>
              {isBase ? (
                <button className="icon-btn" onClick={() => setBaseLocked(!doc.baseLocked)} data-tip={doc.baseLocked ? 'Unlock measured plan' : 'Lock measured plan'} data-tip-pos="left">
                  <Icon name={doc.baseLocked ? 'lock' : 'unlock'} size={15} />
                </button>
              ) : (
                <>
                  <button className="icon-btn" onClick={() => setEditing(id)} data-tip="Rename">
                    <Icon name="pencil" size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      if (confirm(`Delete “${v.name}”? You can undo this.`)) deleteVariant(id);
                    }}
                    data-tip="Delete"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </>
              )}
              <button className="icon-btn" onClick={() => createVariant(`${v.name} copy`, id)} data-tip="Duplicate">
                <Icon name="copy" size={15} />
              </button>
            </div>
          </div>
        );
      })}
      <div style={{ padding: '6px 10px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm primary" onClick={() => createVariant(undefined, doc.baseVariantId)} data-testid="create-option">
          <Icon name="plus" size={14} /> New option from measured plan
        </button>
        <button className="btn sm outline" onClick={() => setUi({ dialog: { kind: 'compare' } })}>
          <Icon name="compare" size={14} /> Compare
        </button>
        {active !== doc.baseVariantId && (
          <button
            className="btn sm"
            onClick={() => {
              if (confirm('Replace the measured plan with this option? (Undo is available.)')) promoteVariantToBase(active);
            }}
          >
            Restore into measured plan
          </button>
        )}
      </div>
      <p className="muted" style={{ padding: '0 14px', fontSize: 11.5 }}>
        Options start as copies of the measured plan. Deleting an existing wall in an option marks it for demolition instead of erasing it, so the plan always shows what is torn out and what is new.
      </p>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────

function HistoryPanel() {
  const past = useDocument((s) => s.past);
  const future = useDocument((s) => s.future);
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!past.length && !future.length)
    return (
      <div className="empty-state">
        <div className="art">
          <Icon name="history" size={26} />
        </div>
        <h4>No changes yet</h4>
        <p>Every edit appears here. Click any step to jump back to it.</p>
      </div>
    );
  return (
    <div className="scroll" style={{ height: '100%' }}>
      {[...past].reverse().map((e, i) => (
        <button key={e.id} className={`hist-item${i === 0 ? ' current' : ''}`} onClick={() => travelTo(e.id)}>
          <Icon name="history" size={13} /> {e.label}
          <span className="time">{time(e.time)}</span>
        </button>
      ))}
      <div className="hist-item" style={{ color: 'var(--text-faint)' }}>
        <Icon name="file" size={13} /> Opened project
      </div>
      {future.length > 0 && (
        <>
          <div className="section-title" style={{ padding: '10px 14px 4px' }}>
            Redo
          </div>
          {future.map((e) => (
            <button key={e.id} className="hist-item future" onClick={() => travelTo(e.id)}>
              {e.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
