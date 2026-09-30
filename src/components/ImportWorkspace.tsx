import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLength } from '../geometry/measurement/format';
import { parseLength } from '../geometry/measurement/parse';
import { bounds, centroid, pointInPolygon } from '../geometry/primitives/polygon';
import { closestPointOnSegment } from '../geometry/primitives/segment';
import { add, dist, dot, norm, sub, type Vec2 } from '../geometry/primitives/vec';
import { ACCEPTED_IMAGES } from '../import/images/images';
import {
  addObservation,
  addSketchFiles,
  applyResolution,
  buildMeasuredPlan,
  confirmObservations,
  deleteGroup,
  deleteObservation,
  importSettings,
  moveEdge,
  removeSketch,
  renameGroup,
  runExtraction,
  setImportSettings,
  setLayout,
  updateObservation,
} from '../import/importActions';
import { PROVIDERS, readApiKey, saveApiKey } from '../import/extraction/provider';
import { defaultLayout, EDGE_TYPES, reconstruct, type ReconIssue, type Reconstruction } from '../import/reconciliation/reconcile';
import { placedPolygon } from '../import/reconciliation/buildPlan';
import { DEFAULT_INTERIOR_THICKNESS } from '../model/factory';
import type { Id, Observation, ObservationStatus, ObservationType, SourceImage } from '../model/types';
import { getRepository } from '../persistence/repository';
import { editFloor, redo, undo, useDocument } from '../state/documentStore';
import { FloorEditor } from '../model/floorEditor';
import { setUi, toast } from '../state/uiStore';
import { LengthInput, TextInput, useUnits } from './common';
import { Icon } from './Icon';

type Units = ReturnType<typeof useUnits>;

const STATUS_CHIP: Record<ObservationStatus, { cls: string; label: string }> = {
  confirmed: { cls: 'success', label: 'Confirmed' },
  likely: { cls: 'info', label: 'Likely' },
  ambiguous: { cls: 'warning', label: 'Ambiguous' },
  conflicting: { cls: 'danger', label: 'Conflicting' },
  missing: { cls: '', label: 'Missing' },
  rejected: { cls: '', label: 'Rejected' },
};

const STATUS_COLOR: Record<string, string> = {
  confirmed: '#3ecf8e',
  likely: '#4fb3ff',
  ambiguous: '#ffb224',
  conflicting: '#ff5f57',
  missing: '#9097a3',
  derived: '#b18cff',
};

function useObjectUrl(blobKey: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let u: string | null = null;
    if (blobKey)
      void getRepository()
        .getBlob(blobKey)
        .then((b) => {
          if (b && live) {
            u = URL.createObjectURL(b);
            setUrl(u);
          }
        });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [blobKey]);
  return url;
}

export default function ImportWorkspace() {
  const doc = useDocument((s) => s.doc);
  const units = useUnits();
  const sources = useMemo(() => Object.values(doc?.sources ?? {}).sort((a, b) => a.addedAt - b.addedAt), [doc?.sources]);
  const observations = useMemo(() => Object.values(doc?.observations ?? {}), [doc?.observations]);
  const recon = useMemo(() => reconstruct(observations, (mm) => formatLength(mm, units)), [observations, units]);
  const layout = useMemo(() => defaultLayout(recon.rooms, doc?.importLayout ?? {}), [recon.rooms, doc?.importLayout]);
  const [imageId, setImageId] = useState<Id | null>(null);
  const [selected, setSelected] = useState<Id | null>(null);
  const activeImage = sources.find((s) => s.id === imageId) ?? sources[0];

  const select = (id: Id | null) => {
    setSelected(id);
    const o = id ? doc?.observations[id] : undefined;
    if (o && o.sourceImageId !== activeImage?.id && doc?.sources[o.sourceImageId]) setImageId(o.sourceImageId);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!doc) return null;
  return (
    <div className="app" style={{ gridTemplateRows: 'var(--topbar-h) 1fr' }}>
      <ImportHeader sourcesCount={sources.length} observations={observations} recon={recon} />
      <div className="import-ws">
        <div className="import-col left">
          <SketchColumn sources={sources} active={activeImage} onPick={setImageId} observations={observations} selected={selected} onSelect={select} groups={recon.rooms.map((r) => r.group)} />
        </div>
        <div style={{ position: 'relative', minWidth: 0, minHeight: 0, background: 'var(--canvas-bg)' }}>
          <ReconCanvas recon={recon} layout={layout} observations={doc.observations} selected={selected} onSelect={select} units={units} />
        </div>
        <div className="import-col right">
          <ReviewPanel recon={recon} observations={observations} selected={selected} onSelect={select} units={units} />
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function ImportHeader({ sourcesCount, observations, recon }: { sourcesCount: number; observations: Observation[]; recon: Reconstruction }) {
  const [provider, setProvider] = useState<string>(readApiKey() ? 'anthropic' : 'manual');
  const [apiKey, setApiKey] = useState(readApiKey());
  const [progress, setProgress] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const likely = observations.filter((o) => o.status === 'likely' && o.valueMm !== undefined);
  const conflicts = recon.issues.filter((i) => i.kind === 'conflict').length;
  const closedRooms = recon.rooms.filter((r) => r.closed).length;

  const read = async () => {
    if (meta.needsApiKey && !apiKey) {
      toast('Paste an Anthropic API key first (it stays on this device).', 'warning');
      return;
    }
    saveApiKey(apiKey);
    abort.current = new AbortController();
    setProgress('Starting…');
    try {
      const n = await runExtraction(provider, apiKey, (_d, _t, msg) => setProgress(msg), abort.current.signal);
      toast(n ? `Found ${n} readings. Review each one before building the plan.` : 'Nothing was read automatically — box the numbers on each sketch to transcribe them.', n ? 'success' : 'info');
    } catch (e) {
      if (!abort.current.signal.aborted) toast(e instanceof Error ? e.message : 'Reading failed', 'error', undefined, 6000);
    } finally {
      setProgress(null);
    }
  };

  const build = () => {
    if (!closedRooms) {
      toast('No room outline closes yet. Add edges with directions for at least one room.', 'warning');
      return;
    }
    if (conflicts && !confirm(`${conflicts} conflict${conflicts === 1 ? ' is' : 's are'} unresolved. Those rooms will be left out until you resolve them. Build anyway?`)) return;
    const res = buildMeasuredPlan();
    if (res) toast(`Measured plan built with ${res.rooms} room${res.rooms === 1 ? '' : 's'}${res.skipped.length ? ` · skipped: ${res.skipped.join(', ')}` : ''}. The measured plan is now locked — create an option to try changes.`, 'success', undefined, 7000);
  };

  return (
    <header className="topbar flex-bar">
      <button className="btn sm" onClick={() => setUi({ screen: 'editor' })} data-testid="import-back">
        <Icon name="arrowLeft" size={15} /> Plan
      </button>
      <div className="divider-v" />
      <b style={{ fontSize: 13 }}>Import measurements</b>
      <span className="chip hide-sm">{sourcesCount} sketches</span>
      <div className="spacer" />
      <select className="input hide-xs" style={{ width: 190 }} value={provider} onChange={(e) => setProvider(e.target.value)} title={meta.description}>
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {meta.needsApiKey && <input className="input hide-sm" type="password" placeholder="Anthropic API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ width: 180 }} autoComplete="off" />}
      {provider !== 'manual' &&
        (progress ? (
          <button className="btn sm outline" onClick={() => abort.current?.abort()}>
            <span className="spinner" /> {progress} · Stop
          </button>
        ) : (
          <button className="btn sm outline" onClick={read} disabled={!sourcesCount} data-testid="read-sketches">
            <Icon name="sparkles" size={15} /> Read sketches
          </button>
        ))}
      {likely.length > 0 && (
        <button className="btn sm hide-sm" onClick={() => confirmObservations(likely.map((o) => o.id))}>
          <Icon name="checkCircle" size={15} /> Confirm {likely.length} likely
        </button>
      )}
      <button className="btn sm primary" onClick={build} data-testid="build-plan">
        <Icon name="hammer" size={15} /> Build measured plan
      </button>
    </header>
  );
}

// ── Sketches ──────────────────────────────────────────────────────────────

function SketchColumn(props: { sources: SourceImage[]; active?: SourceImage; onPick: (id: Id) => void; observations: Observation[]; selected: Id | null; onSelect: (id: Id | null) => void; groups: string[] }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const onFiles = async (files: FileList | File[]) => {
    const ids = await addSketchFiles([...files]);
    if (ids.length) props.onPick(ids[0]);
  };
  return (
    <>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void onFiles(e.dataTransfer.files);
        }}
        data-testid="sketch-dropzone"
      >
        <Icon name="upload" size={20} />
        <div style={{ marginTop: 6, fontWeight: 600 }}>Drop sketch photos here</div>
        <div>or click to choose several at once</div>
        <input ref={input} type="file" accept={ACCEPTED_IMAGES} multiple hidden onChange={(e) => e.target.files && void onFiles(e.target.files)} data-testid="sketch-input" />
      </div>
      {props.sources.length > 0 && (
        <div className="thumbs" style={{ flexDirection: 'row', overflowX: 'auto', paddingBottom: 8 }}>
          {props.sources.map((s, i) => (
            <Thumb key={s.id} s={s} on={props.active?.id === s.id} onClick={() => props.onPick(s.id)} count={props.observations.filter((o) => o.sourceImageId === s.id).length} delay={i} />
          ))}
        </div>
      )}
      {props.active ? (
        <SketchViewer key={props.active.id} source={props.active} {...props} />
      ) : (
        <div className="empty-state">
          <div className="art">
            <Icon name="image" size={26} />
          </div>
          <h4>No sketches yet</h4>
          <p>Add photos or screenshots of your hand-drawn measurements. The written numbers are what count — drawings don’t need to be to scale.</p>
        </div>
      )}
    </>
  );
}

function Thumb({ s, on, onClick, count, delay }: { s: SourceImage; on: boolean; onClick: () => void; count: number; delay: number }) {
  const url = useObjectUrl(s.blobKey);
  return (
    <div className={`sketch-thumb${on ? ' on' : ''}`} onClick={onClick} style={{ minWidth: 110, maxWidth: 110, animationDelay: `${delay * 40}ms` }}>
      {url ? <img src={url} alt={s.name} style={{ height: 76, objectFit: 'cover' }} /> : <div className="skeleton" style={{ height: 76 }} />}
      <div className="cap">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>{s.name}</span>
        <span>{count}</span>
      </div>
    </div>
  );
}

type Mode = 'look' | 'box' | 'calibrate';

function SketchViewer({ source, observations, selected, onSelect, groups }: { source: SourceImage; observations: Observation[]; selected: Id | null; onSelect: (id: Id | null) => void; groups: string[] }) {
  const url = useObjectUrl(source.blobKey);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<Mode>('look');
  const [draft, setDraft] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [form, setForm] = useState<{ box: { x: number; y: number; w: number; h: number } } | null>(null);
  const [calib, setCalib] = useState<Vec2[]>([]);
  const drag = useRef<{ start: Vec2; view: typeof view } | null>(null);
  const units = useUnits();
  const mine = observations.filter((o) => o.sourceImageId === source.id && o.bbox);

  const fit = () => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    const s = Math.min(r.width / source.width, r.height / source.height) * 0.96;
    setView({ s, x: (r.width - source.width * s) / 2, y: (r.height - source.height * s) / 2 });
  };
  useEffect(fit, [source.id, source.width, source.height]);

  // Center on the selected reading's handwriting.
  useEffect(() => {
    const o = selected ? observations.find((x) => x.id === selected) : undefined;
    const r = host.current?.getBoundingClientRect();
    if (!o?.bbox || o.sourceImageId !== source.id || !r) return;
    const s = Math.max(view.s, Math.min(r.width / source.width, r.height / source.height) * 1.6);
    const cx = (o.bbox.x + o.bbox.w / 2) * source.width;
    const cy = (o.bbox.y + o.bbox.h / 2) * source.height;
    setView({ s, x: r.width / 2 - cx * s, y: r.height / 2 - cy * s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toImage = (e: React.PointerEvent | React.WheelEvent): Vec2 => {
    const r = host.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.s, y: (e.clientY - r.top - view.y) / view.s };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: '0 12px 8px', gap: 4, flexWrap: 'wrap' }}>
        <div className="segmented">
          {(
            [
              ['look', 'Look'],
              ['box', 'Box a number'],
              ['calibrate', 'Calibrate'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} style={mode === m ? { background: 'var(--bg-elev)' } : undefined} onClick={() => setMode(m)} data-testid={`sketch-mode-${m}`}>
              {label}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={fit} data-tip="Fit" data-tip-pos="bottom">
          <Icon name="fit" size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            if (confirm(`Remove ${source.name} and its readings?`)) removeSketch(source.id);
          }}
          data-tip="Remove sketch"
          data-tip-pos="bottom"
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
      <div
        ref={host}
        className="sketch-viewer"
        style={{ cursor: mode === 'look' ? 'grab' : 'crosshair' }}
        onWheel={(e) => {
          const p = toImage(e);
          const s = Math.min(8, Math.max(0.05, view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))));
          const r = host.current!.getBoundingClientRect();
          setView({ s, x: e.clientX - r.left - p.x * s, y: e.clientY - r.top - p.y * s });
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const p = toImage(e);
          if (mode === 'box') setDraft({ a: p, b: p });
          else if (mode === 'calibrate') {
            const next = [...calib, p].slice(-2);
            setCalib(next);
          } else drag.current = { start: { x: e.clientX, y: e.clientY }, view };
        }}
        onPointerMove={(e) => {
          if (draft) setDraft({ ...draft, b: toImage(e) });
          else if (drag.current) setView({ ...drag.current.view, x: drag.current.view.x + e.clientX - drag.current.start.x, y: drag.current.view.y + e.clientY - drag.current.start.y });
        }}
        onPointerUp={() => {
          if (draft) {
            const x = Math.min(draft.a.x, draft.b.x) / source.width;
            const y = Math.min(draft.a.y, draft.b.y) / source.height;
            const w = Math.abs(draft.b.x - draft.a.x) / source.width;
            const h = Math.abs(draft.b.y - draft.a.y) / source.height;
            setDraft(null);
            if (w > 0.005 && h > 0.005) setForm({ box: { x, y, w, h } });
          }
          drag.current = null;
        }}
        data-testid="sketch-viewer"
      >
        {url && <img src={url} alt={source.name} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, width: source.width, height: source.height }} />}
        {mine.map((o) => {
          const b = o.bbox!;
          const on = o.id === selected;
          return (
            <div
              key={o.id}
              onPointerDown={(e) => {
                if (mode !== 'look') return;
                e.stopPropagation();
                onSelect(o.id);
              }}
              style={{
                position: 'absolute',
                left: view.x + b.x * source.width * view.s,
                top: view.y + b.y * source.height * view.s,
                width: b.w * source.width * view.s,
                height: b.h * source.height * view.s,
                border: `${on ? 2.5 : 1.5}px solid ${STATUS_COLOR[o.status] ?? '#888'}`,
                background: on ? 'rgba(139,123,255,0.18)' : 'transparent',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'border-width 120ms, background 120ms',
                animation: on ? 'pulse-ring 1.1s var(--ease-out) 2' : undefined,
              }}
            />
          );
        })}
        {draft && (
          <div
            className="sketch-box"
            style={{ left: view.x + Math.min(draft.a.x, draft.b.x) * view.s, top: view.y + Math.min(draft.a.y, draft.b.y) * view.s, width: Math.abs(draft.b.x - draft.a.x) * view.s, height: Math.abs(draft.b.y - draft.a.y) * view.s, animation: 'none' }}
          />
        )}
        {mode === 'calibrate' &&
          calib.map((p, i) => <div key={i} style={{ position: 'absolute', left: view.x + p.x * view.s - 6, top: view.y + p.y * view.s - 6, width: 12, height: 12, borderRadius: 6, background: 'var(--canvas-snap)', boxShadow: '0 0 0 3px rgba(0,0,0,.3)' }} />)}
        {mode === 'calibrate' && (
          <CalibrateBar
            points={calib}
            units={units}
            onDone={(mmPerPx) => {
              editFloor(
                'Place sketch under plan',
                (f) => {
                  const ed = new FloorEditor(f);
                  ed.setFloorProps({ underlay: { sourceId: source.id, x: 0, y: 0, scale: mmPerPx, rotation: 0, opacity: 0.35, visible: true } });
                  return ed.floor;
                },
                { force: true },
              );
              setCalib([]);
              setMode('look');
              toast('Sketch placed under the plan at true scale. Adjust it in Properties when nothing is selected.', 'success');
            }}
          />
        )}
        {form && <AnnotateForm box={form.box} source={source} groups={groups} onClose={() => setForm(null)} onCreated={(id) => onSelect(id)} />}
      </div>
    </div>
  );
}

function CalibrateBar({ points, units, onDone }: { points: Vec2[]; units: Units; onDone: (mmPerPx: number) => void }) {
  const [text, setText] = useState('');
  const px = points.length === 2 ? dist(points[0], points[1]) : 0;
  return (
    <div className="float-bar" style={{ left: 10, right: 10, bottom: 10, padding: 8, flexWrap: 'wrap', gap: 8 }} onPointerDown={(e) => e.stopPropagation()}>
      {points.length < 2 ? (
        <span style={{ fontSize: 12 }}>Click two points on the sketch whose real distance you know (e.g. the ends of a measured wall).</span>
      ) : (
        <>
          <span style={{ fontSize: 12 }}>Real distance:</span>
          <input className="input" style={{ width: 120 }} placeholder={`e.g. 15'2"`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
          <button
            className="btn sm primary"
            onClick={() => {
              const r = parseLength(text, { system: units.system, metricUnit: units.metricUnit });
              if (!r.ok || px < 2) toast('Enter a distance like 15\'2"', 'warning');
              else onDone(r.mm / px);
            }}
          >
            Place under plan
          </button>
        </>
      )}
    </div>
  );
}

const TYPE_OPTIONS: Array<[ObservationType, string]> = [
  ['wall_length', 'Wall length'],
  ['door', 'Door width'],
  ['window', 'Window width'],
  ['opening_width', 'Opening width'],
  ['offset', 'Offset / distance'],
  ['ceiling_height', 'Ceiling height'],
  ['fixture', 'Counter / fixture'],
  ['note', 'Note'],
];

function AnnotateForm({ box, source, groups, onClose, onCreated }: { box: { x: number; y: number; w: number; h: number }; source: SourceImage; groups: string[]; onClose: () => void; onCreated: (id: Id) => void }) {
  const units = useUnits();
  const [type, setType] = useState<ObservationType>('wall_length');
  const [text, setText] = useState('');
  const [group, setGroup] = useState(groups[0] ?? 'Room 1');
  const [newGroup, setNewGroup] = useState(groups.length === 0);
  const [dir, setDir] = useState<'N' | 'E' | 'S' | 'W'>('E');
  const [edgeIndex, setEdgeIndex] = useState(0);
  const obs = useDocument((s) => s.doc?.observations);
  const edgesInGroup = Object.values(obs ?? {}).filter((o) => o.group === group && EDGE_TYPES.includes(o.type)).length;
  const save = () => {
    const r = text.trim() ? parseLength(text, { system: units.system, metricUnit: units.metricUnit }) : null;
    if (type !== 'note' && type !== 'fixture' && (!r || !r.ok)) {
      toast('Type the number as written, e.g. 15\'2"', 'warning');
      return;
    }
    const isEdge = type === 'wall_length';
    const id = addObservation({
      type,
      sourceImageId: source.id,
      originalText: text.trim(),
      valueMm: r && r.ok ? r.mm : undefined,
      alternatives: [],
      confidence: 1,
      bbox: box,
      interpretation: 'Entered by hand',
      status: 'confirmed',
      group: type === 'note' ? undefined : group,
      direction: isEdge ? dir : undefined,
      sequence: isEdge ? edgesInGroup : undefined,
      edgeIndex: type === 'door' || type === 'window' || type === 'opening_width' ? edgeIndex : undefined,
      provider: 'manual',
    });
    onCreated(id);
    onClose();
  };
  return (
    <div className="popover" style={{ position: 'absolute', left: 12, top: 12, padding: 12, width: 260, zIndex: 5 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-testid="annotate-form">
      <div className="label" style={{ color: 'var(--text)', fontSize: 12, marginBottom: 8 }}>
        What is this?
      </div>
      <div className="field">
        <select className="input" value={type} onChange={(e) => setType(e.target.value as ObservationType)}>
          {TYPE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>As written</label>
        <input className="input" autoFocus value={text} placeholder={`15'2"`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} data-testid="annotate-value" />
      </div>
      {type !== 'note' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Room</label>
          {newGroup ? (
            <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} data-testid="annotate-room" />
          ) : (
            <select
              className="input"
              value={group}
              onChange={(e) => {
                if (e.target.value === '__new') {
                  setNewGroup(true);
                  setGroup(`Room ${groups.length + 1}`);
                } else setGroup(e.target.value);
              }}
            >
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
              <option value="__new">+ New room…</option>
            </select>
          )}
        </div>
      )}
      {type === 'wall_length' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Wall runs (walking the room clockwise, up = north)</label>
          <div className="segmented" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {(['N', 'E', 'S', 'W'] as const).map((d) => (
              <button key={d} className={dir === d ? 'on' : ''} style={dir === d ? { background: 'var(--bg-elev)' } : undefined} onClick={() => setDir(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
      {(type === 'door' || type === 'window' || type === 'opening_width') && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>On which wall of the room</label>
          <select className="input" value={edgeIndex} onChange={(e) => setEdgeIndex(Number(e.target.value))}>
            {Array.from({ length: Math.max(1, edgesInGroup) }, (_, i) => (
              <option key={i} value={i}>
                Edge {i + 1}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn sm" onClick={onClose}>
          Cancel
        </button>
        <button className="btn sm primary" onClick={save} data-testid="annotate-save">
          Add
        </button>
      </div>
    </div>
  );
}

// ── Reconstruction canvas ────────────────────────────────────────────────

function ReconCanvas({ recon, layout, observations, selected, onSelect, units }: { recon: Reconstruction; layout: Record<string, { x: number; y: number }>; observations: Record<Id, Observation>; selected: Id | null; onSelect: (id: Id | null) => void; units: Units }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState({ s: 0.05, x: 60, y: 60 });
  const [dragLayout, setDragLayout] = useState<{ group: string; pos: Vec2 } | null>(null);
  const drag = useRef<{ kind: 'pan' | 'room'; start: Vec2; vp: typeof vp; group?: string; origin?: Vec2 } | null>(null);
  const fitted = useRef(0);
  const effLayout = dragLayout ? { ...layout, [dragLayout.group]: dragLayout.pos } : layout;

  // Fit to content when the set of rooms changes.
  useEffect(() => {
    const c = canvas.current;
    if (!c || recon.rooms.length === fitted.current) return;
    fitted.current = recon.rooms.length;
    const pts = recon.rooms.flatMap((r) => placedPolygon(r, layout));
    if (!pts.length) return;
    const b = bounds(pts);
    const w = c.clientWidth;
    const h = c.clientHeight;
    const s = Math.min((w - 120) / Math.max(b.maxX - b.minX, 1000), (h - 120) / Math.max(b.maxY - b.minY, 1000));
    setVp({ s, x: w / 2 - ((b.minX + b.maxX) / 2) * s, y: h / 2 - ((b.minY + b.maxY) / 2) * s });
  }, [recon.rooms, layout]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const col = (v: string) => cs.getPropertyValue(v).trim();
    ctx.fillStyle = col('--canvas-bg');
    ctx.fillRect(0, 0, w, h);
    const S = (p: Vec2) => ({ x: p.x * vp.s + vp.x, y: p.y * vp.s + vp.y });
    const font = col('--font-ui');
    for (const room of recon.rooms) {
      const o = effLayout[room.group] ?? { x: 0, y: 0 };
      const poly = room.edges.map((e) => S(add(e.start, o)));
      if (poly.length >= 3) {
        ctx.beginPath();
        poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = room.closed ? col('--canvas-room-hover') : 'rgba(255,95,87,0.05)';
        ctx.fill();
      }
      for (const e of room.edges) {
        const a = S(add(e.start, o));
        const b = S(add(e.end, o));
        const ob = observations[e.obsId];
        const on = e.obsId === selected;
        const color = e.source === 'derived' || e.source === 'provisional' || e.source === 'absorbed' ? STATUS_COLOR.derived : STATUS_COLOR[ob?.status ?? 'likely'];
        ctx.strokeStyle = color;
        ctx.lineWidth = on ? 6 : 3.5;
        ctx.setLineDash(e.source === 'measured' ? [] : [7, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = norm(sub(b, a));
        const n = { x: -d.y, y: d.x };
        const text = `${ob?.originalText || '—'}${e.source !== 'measured' ? ` → ${formatLength(e.length, units)}` : ''}`;
        ctx.font = `600 11px ${font}`;
        const tw = ctx.measureText(text).width + 10;
        const lp = { x: m.x - n.x * 14, y: m.y - n.y * 14 };
        ctx.fillStyle = on ? col('--accent') : col('--canvas-label-bg');
        ctx.beginPath();
        ctx.rect(lp.x - tw / 2, lp.y - 9, tw, 18);
        ctx.fill();
        ctx.fillStyle = on ? '#fff' : color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lp.x, lp.y + 0.5);
      }
      if (!room.closed && room.edges.length >= 2) {
        const last = S(add(room.edges[room.edges.length - 1].end, o));
        const first = S(add(room.edges[0].start, o));
        ctx.strokeStyle = STATUS_COLOR.conflicting;
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(first.x, first.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = STATUS_COLOR.conflicting;
        ctx.beginPath();
        ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 11px ${font}`;
        ctx.fillText(`gap ${formatLength(dist(room.edges[room.edges.length - 1].end, room.edges[0].start), units)}`, (last.x + first.x) / 2, (last.y + first.y) / 2 - 12);
      }
      if (room.edges.length) {
        const c2 = S(add(centroid(room.edges.map((e) => e.start)), o));
        ctx.fillStyle = col('--canvas-ink');
        ctx.font = `650 13px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText(room.group, c2.x, c2.y);
        ctx.font = `500 11px ${font}`;
        ctx.fillStyle = room.closed ? STATUS_COLOR.confirmed : STATUS_COLOR.conflicting;
        ctx.fillText(room.closed ? 'closes ✓' : 'doesn’t close', c2.x, c2.y + 16);
      }
    }
    if (!recon.rooms.length) {
      ctx.fillStyle = col('--text-muted');
      ctx.font = `500 13px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText('Room outlines appear here as measurements are added.', w / 2, h / 2);
    }
  });

  const hitEdge = (p: Vec2): Id | null => {
    for (const room of recon.rooms) {
      const o = effLayout[room.group] ?? { x: 0, y: 0 };
      for (const e of room.edges) if (closestPointOnSegment(p, add(e.start, o), add(e.end, o)).distance < 10 / vp.s) return e.obsId;
    }
    return null;
  };
  const hitRoom = (p: Vec2): string | null => {
    for (const room of recon.rooms) if (room.edges.length >= 3 && pointInPolygon(p, placedPolygon(room, effLayout))) return room.group;
    return null;
  };
  const toWorld = (e: React.PointerEvent | React.WheelEvent): Vec2 => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - vp.x) / vp.s, y: (e.clientY - r.top - vp.y) / vp.s };
  };

  /** Snap a dragged room so its edges sit exactly one interior wall from a neighbour's. */
  const snapRoom = (group: string, pos: Vec2): Vec2 => {
    const room = recon.rooms.find((r) => r.group === group);
    if (!room) return pos;
    const tol = 14 / vp.s;
    let best: { d: number; delta: Vec2 } | null = null;
    for (const other of recon.rooms) {
      if (other.group === group) continue;
      const oo = effLayout[other.group] ?? { x: 0, y: 0 };
      for (const e of room.edges) {
        const a = add(e.start, pos);
        for (const f of other.edges) {
          if (dot(e.dir, f.dir) > -0.999) continue;
          const c = add(f.start, oo);
          const n = { x: -f.dir.y, y: f.dir.x };
          const gap = dot(sub(a, c), n);
          const want = gap >= 0 ? DEFAULT_INTERIOR_THICKNESS : -DEFAULT_INTERIOR_THICKNESS;
          const d = Math.abs(gap - want);
          if (d < tol && (!best || d < best.d)) best = { d, delta: { x: n.x * (want - gap), y: n.y * (want - gap) } };
        }
      }
    }
    let out = best ? add(pos, best.delta) : pos;
    // Align corners along the other axis.
    let bestAlign: { d: number; delta: Vec2 } | null = null;
    for (const other of recon.rooms) {
      if (other.group === group) continue;
      const oo = effLayout[other.group] ?? { x: 0, y: 0 };
      for (const e of room.edges)
        for (const f of other.edges) {
          const a = add(e.start, out);
          const c = add(f.start, oo);
          for (const axis of ['x', 'y'] as const) {
            const d = Math.abs(a[axis] - c[axis]);
            if (d < tol && d > 0.01 && (!bestAlign || d < bestAlign.d)) bestAlign = { d, delta: axis === 'x' ? { x: c.x - a.x, y: 0 } : { x: 0, y: c.y - a.y } };
          }
        }
    }
    if (bestAlign && best) {
      // Only align along the edge direction so the wall gap stays exact.
      const perpToGap = Math.abs(best.delta.x) > Math.abs(best.delta.y) ? { x: 0, y: bestAlign.delta.y } : { x: bestAlign.delta.x, y: 0 };
      out = add(out, perpToGap);
    } else if (bestAlign) out = add(out, bestAlign.delta);
    return out;
  };

  return (
    <>
      <canvas
        ref={canvas}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: dragLayout ? 'grabbing' : 'default' }}
        onWheel={(e) => {
          const p = toWorld(e);
          const s = Math.min(1, Math.max(0.005, vp.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))));
          const r = canvas.current!.getBoundingClientRect();
          setVp({ s, x: e.clientX - r.left - p.x * s, y: e.clientY - r.top - p.y * s });
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const p = toWorld(e);
          const edge = hitEdge(p);
          if (edge) {
            onSelect(edge);
            return;
          }
          const group = hitRoom(p);
          if (group) drag.current = { kind: 'room', start: p, vp, group, origin: layout[group] ?? { x: 0, y: 0 } };
          else drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (d.kind === 'pan') setVp({ ...d.vp, x: d.vp.x + e.clientX - d.start.x, y: d.vp.y + e.clientY - d.start.y });
          else {
            const p = toWorld(e);
            setDragLayout({ group: d.group!, pos: snapRoom(d.group!, add(d.origin!, sub(p, d.start))) });
          }
        }}
        onPointerUp={() => {
          if (dragLayout) setLayout(dragLayout.group, dragLayout.pos);
          setDragLayout(null);
          drag.current = null;
        }}
        data-testid="recon-canvas"
      />
      <div className="float-bar" style={{ left: 12, bottom: 12, fontSize: 11.5, padding: '6px 10px', gap: 12, flexWrap: 'wrap' }}>
        {(
          [
            ['confirmed', 'Confirmed'],
            ['likely', 'Likely'],
            ['ambiguous', 'Ambiguous'],
            ['conflicting', 'Conflict'],
            ['derived', 'Derived / adjusted'],
          ] as const
        ).map(([k, l]) => (
          <span key={k} className="row" style={{ gap: 5 }}>
            <span className="dot" style={{ background: STATUS_COLOR[k] }} />
            {l}
          </span>
        ))}
        <span className="muted">Drag rooms together — they snap one wall apart.</span>
      </div>
    </>
  );
}

// ── Review panel ──────────────────────────────────────────────────────────

function ReviewPanel({ recon, observations, selected, onSelect, units }: { recon: Reconstruction; observations: Observation[]; selected: Id | null; onSelect: (id: Id | null) => void; units: Units }) {
  const [tab, setTab] = useState<'readings' | 'issues'>('readings');
  const doc = useDocument((s) => s.doc);
  const settings = importSettings(doc);
  const actionable = recon.issues.filter((i) => i.severity !== 'info');
  const groups = useMemo(() => {
    const names = [...new Set(observations.map((o) => o.group ?? ''))];
    return names.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [observations]);
  const counts = {
    confirmed: observations.filter((o) => o.status === 'confirmed' || o.approximate).length,
    ambiguous: observations.filter((o) => (o.status === 'ambiguous' || o.status === 'likely') && !o.approximate).length,
    conflicts: recon.issues.filter((i) => i.kind === 'conflict').length,
    missing: observations.filter((o) => o.status === 'missing').length,
  };
  const addRoom = () => {
    const name = `Room ${groups.filter(Boolean).length + 1}`;
    (['E', 'S', 'W', 'N'] as const).forEach((d, i) =>
      addObservation({ type: 'wall_length', sourceImageId: '', originalText: '', valueMm: undefined, alternatives: [], confidence: 1, interpretation: 'Typed by hand', status: 'missing', group: name, direction: d, sequence: i, provider: 'manual' }),
    );
  };
  return (
    <>
      <div className="issue-summary" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {(
          [
            ['Confirmed', counts.confirmed, 'var(--success)'],
            ['To review', counts.ambiguous, 'var(--warning)'],
            ['Conflicts', counts.conflicts, 'var(--danger)'],
            ['Missing', counts.missing, 'var(--text-muted)'],
          ] as const
        ).map(([l, n, c]) => (
          <div className="stat" key={l} style={{ padding: 8 }}>
            <div className="n" style={{ fontSize: 17, color: n ? c : undefined }}>
              {n}
            </div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
      <div className="panel-tabs" style={{ paddingTop: 0 }}>
        <button className={tab === 'readings' ? 'on' : ''} onClick={() => setTab('readings')}>
          Measurements
        </button>
        <button className={tab === 'issues' ? 'on' : ''} onClick={() => setTab('issues')} data-testid="import-issues-tab">
          Issues {actionable.length > 0 && <span className="badge">{actionable.length}</span>}
        </button>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {tab === 'readings' ? (
          <>
            {groups.map((g) => (
              <GroupBlock key={g || '_'} group={g} observations={observations.filter((o) => (o.group ?? '') === g)} selected={selected} onSelect={onSelect} units={units} closed={recon.rooms.find((r) => r.group === g)?.closed} />
            ))}
            <div style={{ padding: 12 }}>
              <button className="btn sm outline" onClick={addRoom} data-testid="add-room-manual">
                <Icon name="plus" size={14} /> Add a room by typing its walls
              </button>
            </div>
          </>
        ) : (
          <IssueList issues={recon.issues} onSelect={onSelect} />
        )}
      </div>
      <div className="section" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, gap: 4 }}>
        <label className="check">
          <input type="checkbox" checked={settings.interiorMeasurements} onChange={(e) => setImportSettings({ interiorMeasurements: e.target.checked })} />
          Measured inside, wall to wall (typical)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.lockMeasured} onChange={(e) => setImportSettings({ lockMeasured: e.target.checked })} />
          Lock confirmed lengths in the plan
        </label>
      </div>
    </>
  );
}

function GroupBlock({ group, observations, selected, onSelect, units, closed }: { group: string; observations: Observation[]; selected: Id | null; onSelect: (id: Id | null) => void; units: Units; closed?: boolean }) {
  const edges = observations.filter((o) => EDGE_TYPES.includes(o.type)).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const other = observations.filter((o) => !EDGE_TYPES.includes(o.type));
  const addEdge = () =>
    onSelect(
      addObservation({ type: 'wall_length', sourceImageId: '', originalText: '', valueMm: undefined, alternatives: [], confidence: 1, interpretation: 'Typed by hand', status: 'missing', group, direction: 'E', sequence: edges.length, provider: 'manual' }),
    );
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="row" style={{ padding: '10px 14px 4px', gap: 6 }}>
        {group ? (
          <div style={{ flex: 1 }}>
            <TextInput value={group} onCommit={(v) => renameGroup(group, v)} />
          </div>
        ) : (
          <b style={{ flex: 1, fontSize: 12 }}>Notes & unassigned</b>
        )}
        {group && closed !== undefined && <span className={`chip ${closed ? 'success' : 'danger'}`}>{closed ? 'closes' : 'open'}</span>}
        {group && (
          <>
            <button className="icon-btn" onClick={addEdge} data-tip="Add wall" data-tip-pos="left">
              <Icon name="plus" size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                if (confirm(`Delete all readings for ${group}?`)) deleteGroup(group);
              }}
              data-tip="Delete room"
              data-tip-pos="left"
            >
              <Icon name="trash" size={14} />
            </button>
          </>
        )}
      </div>
      {edges.map((o, i) => (
        <ObsRow key={o.id} o={o} index={i} selected={selected === o.id} onSelect={onSelect} units={units} />
      ))}
      {other.map((o) => (
        <ObsRow key={o.id} o={o} selected={selected === o.id} onSelect={onSelect} units={units} />
      ))}
    </div>
  );
}

function ObsRow({ o, index, selected, onSelect, units }: { o: Observation; index?: number; selected: boolean; onSelect: (id: Id | null) => void; units: Units }) {
  const chip = o.approximate ? { cls: 'accent', label: 'Approximate' } : STATUS_CHIP[o.status];
  const isEdge = EDGE_TYPES.includes(o.type);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <div ref={ref} className={`obs${selected ? ' on' : ''}`} onClick={() => onSelect(o.id)} data-testid="obs-row">
      <div className="top">
        {isEdge && (
          <span className="muted tnum" style={{ width: 16 }}>
            {(index ?? 0) + 1}
          </span>
        )}
        <span className={`chip ${chip.cls}`}>{chip.label}</span>
        {isEdge ? (
          <select className="input" style={{ width: 58, height: 24 }} value={typeof o.direction === 'string' ? o.direction : ''} onClick={(e) => e.stopPropagation()} onChange={(e) => updateObservation(o.id, { direction: e.target.value as 'N' | 'E' | 'S' | 'W' }, 'Change direction')}>
            <option value="">?</option>
            {['N', 'E', 'S', 'W'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {TYPE_OPTIONS.find(([t]) => t === o.type)?.[1] ?? o.type}
          </span>
        )}
        <div style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
          {o.type !== 'note' && <LengthInput value={o.valueMm ?? 0} placeholder="—" onCommit={(mm) => updateObservation(o.id, { valueMm: mm, status: 'confirmed', confidence: 1, originalText: o.originalText || formatLength(mm, units) }, 'Correct measurement')} />}
        </div>
        {o.status !== 'confirmed' && o.valueMm !== undefined && (
          <button
            className="icon-btn"
            style={{ color: 'var(--success)' }}
            onClick={(e) => {
              e.stopPropagation();
              confirmObservations([o.id]);
            }}
            data-tip="Confirm"
            data-tip-pos="left"
            data-testid="obs-confirm"
          >
            <Icon name="checkCircle" size={16} />
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <span className="orig">{o.originalText ? `“${o.originalText}”` : 'not written'}</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {Math.round(o.confidence * 100)}% · {o.provider === 'manual' ? 'typed' : 'AI'}
        </span>
        <div className="conf-bar" style={{ flex: 1 }}>
          <i style={{ width: `${o.confidence * 100}%`, background: o.confidence > 0.85 ? 'var(--success)' : o.confidence > 0.6 ? 'var(--warning)' : 'var(--danger)' }} />
        </div>
      </div>
      {o.alternatives.length > 1 && o.status !== 'confirmed' && (
        <div className="alt-row">
          <span className="muted" style={{ fontSize: 11 }}>
            Possible readings:
          </span>
          {o.alternatives.map((a, i) => (
            <button
              key={i}
              className="chip accent"
              onClick={(e) => {
                e.stopPropagation();
                updateObservation(o.id, { valueMm: a.valueMm, originalText: a.text, status: 'confirmed', confidence: 1 }, 'Choose reading');
              }}
            >
              {a.text} · {Math.round(a.confidence * 100)}%
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
          {isEdge && (
            <>
              <button className="btn sm" onClick={() => moveEdge(o.id, -1)}>
                ↑ Earlier
              </button>
              <button className="btn sm" onClick={() => moveEdge(o.id, 1)}>
                ↓ Later
              </button>
              <button className="btn sm" onClick={() => updateObservation(o.id, { approximate: !o.approximate }, o.approximate ? 'Mark exact' : 'Mark approximate')}>
                {o.approximate ? 'Mark exact' : 'Mark approximate'}
              </button>
            </>
          )}
          <button className="btn sm" onClick={() => updateObservation(o.id, { status: 'rejected' }, 'Reject reading')}>
            Ignore
          </button>
          <button className="btn sm danger" onClick={() => deleteObservation(o.id)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function IssueList({ issues, onSelect }: { issues: ReconIssue[]; onSelect: (id: Id | null) => void }) {
  if (!issues.length)
    return (
      <div className="empty-state">
        <div className="art">
          <Icon name="checkCircle" size={26} />
        </div>
        <h4>Everything adds up</h4>
        <p>All room outlines close and no readings conflict.</p>
      </div>
    );
  return (
    <>
      {issues.map((i) => (
        <div key={i.id} className="issue" style={{ flexDirection: 'column', gap: 6, cursor: 'default' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="ico" style={{ color: i.severity === 'error' ? 'var(--danger)' : i.severity === 'warning' ? 'var(--warning)' : 'var(--info)' }}>
              <Icon name={i.severity === 'info' ? 'info' : 'alert'} size={15} />
            </span>
            <span>
              <div className="t" style={{ fontWeight: 600 }}>
                {i.title}
              </div>
              <div className="s">{i.detail}</div>
            </span>
          </div>
          {i.options.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 4, paddingLeft: 24 }}>
              {i.options.map((opt, k) => (
                <button
                  key={k}
                  className={`btn sm ${k === 0 && i.kind === 'conflict' ? 'outline' : ''}`}
                  onClick={() => {
                    if (opt.action.kind === 'focus') onSelect(opt.action.obsIds[0] ?? null);
                    else applyResolution(opt.action);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
