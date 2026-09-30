import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLength, formatLengthForInput } from '../geometry/measurement/format';
import { parseLength } from '../geometry/measurement/parse';
import type { ResizeAnchor, ResizeMode } from '../geometry/walls/wallOps';
import { editors } from '../editor/registry';
import { setItemDistance, setWallLength, updateOpening } from '../state/actions';
import { getActiveFloor, useDocument } from '../state/documentStore';
import { setUi, useUi, type DimensionEditState } from '../state/uiStore';
import { useUnits } from './common';

const MODE_LABEL: Record<ResizeMode, { label: string; tip: string }> = {
  connected: { label: 'Move connected walls', tip: 'Walls attached to the moving end travel with it, keeping their angles' },
  stretch: { label: 'Stretch whole plan', tip: 'Everything beyond the moving end shifts, like inserting a strip' },
  endpoint: { label: 'Only this wall', tip: 'Just this wall’s endpoint moves; neighbors bend to follow' },
};

export function DimensionPopover() {
  const edit = useUi((s) => s.dimensionEdit);
  if (!edit) return null;
  return <DimensionPopoverInner key={`${JSON.stringify(edit.target)}-${edit.x}-${edit.y}`} edit={edit} />;
}

function DimensionPopoverInner({ edit }: { edit: DimensionEditState }) {
  const units = useUnits();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(edit.initialText ?? (edit.current ? formatLengthForInput(edit.current, units) : ''));
  const [anchor, setAnchor] = useState<ResizeAnchor>(edit.anchor);
  const [mode, setMode] = useState<ResizeMode>(edit.mode);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: edit.x, y: edit.y });
  const floor = useDocument((s) => s.doc?.variants[s.variantId]?.floors[s.floorId]);
  const t = edit.target;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (edit.initialText) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, [edit.initialText]);

  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(Math.max(8, edit.x - r.width / 2), window.innerWidth - r.width - 8);
    const y = edit.y + 18 + r.height > window.innerHeight - 8 ? edit.y - r.height - 14 : edit.y + 18;
    setPos({ x, y });
  }, [edit.x, edit.y]);

  const anchorLabels = useMemo(() => {
    if (t.kind !== 'wallLength' || !floor) return { start: 'Start', end: 'End' };
    const w = floor.walls[t.wallId];
    if (!w) return { start: 'Start', end: 'End' };
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return a.x <= b.x ? { start: 'Left', end: 'Right' } : { start: 'Right', end: 'Left' };
    return a.y <= b.y ? { start: 'Top', end: 'Bottom' } : { start: 'Bottom', end: 'Top' };
  }, [t, floor]);

  const close = () => setUi({ dimensionEdit: null });

  const submit = () => {
    const isRoomSize = t.kind === 'drawLength' && /[x×*]|by/i.test(text);
    const r = parseLength(isRoomSize ? '1' : text, { system: units.system, metricUnit: units.metricUnit });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const mm = r.mm;
    let ok = true;
    switch (t.kind) {
      case 'wallLength': {
        const target = mm - (t.extra ?? 0);
        if (target <= 0) {
          setError('Too short');
          return;
        }
        ok = setWallLength(t.wallId, target, { anchor, mode, face: t.reference === 'face' ? t.side : undefined });
        break;
      }
      case 'itemDistance':
        ok = setItemDistance(t.itemId, t.side, mm);
        break;
      case 'openingOffset': {
        const f = getActiveFloor();
        const o = f?.openings[t.openingId];
        if (!f || !o) break;
        const w = f.walls[o.wallId];
        const L = Math.hypot(f.nodes[w.b].x - f.nodes[w.a].x, f.nodes[w.b].y - f.nodes[w.a].y);
        // Current displayed value may be face-based; shift by the same delta.
        const delta = mm - edit.current;
        const offset = t.from === 'start' ? o.offset + delta : o.offset - delta;
        if (offset < -0.5 || offset + o.width > L + 0.5) {
          setError('That would push it past the end of the wall');
          return;
        }
        ok = updateOpening(o.id, { offset }, 'Set opening position');
        break;
      }
      case 'openingWidth':
        ok = updateOpening(t.openingId, { width: mm }, 'Set opening width');
        break;
      case 'drawLength':
      case 'moveOffset':
        if (editors.focused === 'scene' && editors.scene) editors.scene.submitToolValue(mm);
        else editors.plan?.submitToolValue(mm, text);
        break;
      default:
        break;
    }
    if (ok) close();
  };

  const title =
    t.kind === 'wallLength'
      ? t.reference === 'face'
        ? 'Interior wall length'
        : 'Wall length'
      : t.kind === 'itemDistance'
        ? 'Distance to wall'
        : t.kind === 'openingOffset'
          ? 'Distance from corner'
          : t.kind === 'openingWidth'
            ? 'Opening width'
            : t.kind === 'moveOffset'
              ? 'Move exactly'
              : t.kind === 'drawLength'
                ? 'Exact length'
                : 'Dimension';

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onPointerDown={close} />
      <div className="popover dim-pop" ref={ref} style={{ left: pos.x, top: pos.y }} data-testid="dimension-popover" onKeyDown={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="label" style={{ fontSize: 12, color: 'var(--text)' }}>
            {title}
          </span>
          {edit.current > 0 && <span className="chip mono">{formatLength(edit.current, units)}</span>}
        </div>
        <input
          ref={inputRef}
          className={`input big${error ? ' invalid' : ''}`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          data-testid="dimension-input"
          placeholder={t.kind === 'drawLength' ? `e.g. 12' 6" or 12' x 10'` : `e.g. 15' 8"`}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') close();
          }}
        />
        {error && <div className="err">{error}</div>}
        {t.kind === 'wallLength' && (
          <>
            <div className="meta">
              <span>Keep fixed</span>
              <span>{t.reference === 'face' ? 'measured face to face' : 'centerline'}</span>
            </div>
            <div className="segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
              <AnchorThumb anchor={anchor} />
              {(['start', 'center', 'end'] as ResizeAnchor[]).map((a) => (
                <button key={a} className={anchor === a ? 'on' : ''} onClick={() => setAnchor(a)} data-testid={`anchor-${a}`}>
                  {a === 'center' ? 'Center' : anchorLabels[a]}
                </button>
              ))}
            </div>
            <select className="input" style={{ marginTop: 8 }} value={mode} onChange={(e) => setMode(e.target.value as ResizeMode)} title={MODE_LABEL[mode].tip}>
              {(Object.keys(MODE_LABEL) as ResizeMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m].label}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <button className="btn sm" onClick={close}>
            Cancel
          </button>
          <button className="btn sm primary" onClick={submit} data-testid="dimension-apply">
            Apply <span className="kbd" style={{ background: 'rgba(255,255,255,0.2)', color: 'inherit', boxShadow: 'none' }}>↵</span>
          </button>
        </div>
      </div>
    </>
  );
}

function AnchorThumb({ anchor }: { anchor: ResizeAnchor }) {
  const idx = anchor === 'start' ? 0 : anchor === 'center' ? 1 : 2;
  return <span className="thumb" style={{ left: `calc(2px + ${idx} * (100% - 4px) / 3)`, width: 'calc((100% - 4px) / 3)' }} />;
}
