import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PlanController } from '../editor/2d/planController';
import { editors } from '../editor/registry';
import { addFloor, setBaseLocked, createVariant } from '../state/actions';
import { setActiveFloor, useDocument } from '../state/documentStore';
import { setUi, useUi } from '../state/uiStore';
import { Icon } from './Icon';

const View3D = lazy(() => import('./View3D'));

export function Stage() {
  const mode = useUi((s) => s.viewMode);
  const ratio = useUi((s) => s.splitRatio);
  const [mounted3D, setMounted3D] = useState(mode !== '2d');
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== '2d') setMounted3D(true);
  }, [mode]);

  const planBasis = mode === '2d' ? '100%' : mode === '3d' ? '0%' : `${ratio * 100}%`;
  const sceneBasis = mode === '3d' ? '100%' : mode === '2d' ? '0%' : `${(1 - ratio) * 100}%`;

  const startSplitDrag = (e: React.PointerEvent) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setUi({ splitRatio: Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="stage" ref={stageRef}>
      <div
        className={`view-pane${mode === '3d' ? ' hidden' : ''}`}
        style={{ flexBasis: planBasis, flexGrow: 0, flexShrink: 0 }}
        onPointerEnter={() => (editors.focused = 'plan')}
        onPointerDown={() => (editors.focused = 'plan')}
      >
        <PlanView />
        {mode === 'split' && <span className="view-badge">Plan</span>}
      </div>
      {mode === 'split' && <div className="split-handle" onPointerDown={startSplitDrag} />}
      <div
        className={`view-pane${mode === '2d' ? ' hidden' : ''}`}
        style={{ flexBasis: sceneBasis, flexGrow: 0, flexShrink: 0 }}
        onPointerEnter={() => (editors.focused = 'scene')}
        onPointerDown={() => (editors.focused = 'scene')}
      >
        {mounted3D && (
          <Suspense fallback={<Loading3D />}>
            <View3D />
          </Suspense>
        )}
        {mode === 'split' && <span className="view-badge">3D</span>}
      </div>
      <LockedBanner />
    </div>
  );
}

function Loading3D() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      <div className="processing">
        <span className="spinner" /> Building 3D model…
      </div>
    </div>
  );
}

function PlanView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoom = useUi((s) => s.zoomPercent);
  const showDims = useUi((s) => s.showDimensions);
  const showFurniture = useUi((s) => s.showFurniture);
  const showGrid = useUi((s) => s.showGrid);
  const ghost = useUi((s) => s.showBaseGhost);
  const isOption = useDocument((s) => !!s.doc && s.variantId !== s.doc.baseVariantId);
  const empty = useDocument((s) => {
    const f = s.doc?.variants[s.variantId]?.floors[s.floorId];
    return !f || Object.keys(f.walls).length === 0;
  });
  useEffect(() => {
    const c = new PlanController(canvasRef.current!);
    return () => c.dispose();
  }, []);
  return (
    <>
      <canvas ref={canvasRef} tabIndex={0} data-testid="plan-canvas" aria-label="Floor plan editor" />
      <div className="float-bar" style={{ top: 12, left: 12 }}>
        <FloorMenu />
        <div className="divider-v" />
        <button className={`icon-btn${showDims ? ' active' : ''}`} onClick={() => setUi({ showDimensions: !showDims })} data-tip="Dimensions" data-tip-pos="bottom">
          <Icon name="ruler" size={16} />
        </button>
        <button className={`icon-btn${showFurniture ? ' active' : ''}`} onClick={() => setUi({ showFurniture: !showFurniture })} data-tip="Furniture" data-tip-pos="bottom">
          <Icon name="sofa" size={16} />
        </button>
        <button className={`icon-btn${showGrid ? ' active' : ''}`} onClick={() => setUi({ showGrid: !showGrid })} data-tip="Grid" data-tip-pos="bottom">
          <Icon name="grid" size={16} />
        </button>
        {isOption && (
          <button className={`icon-btn${ghost ? ' active' : ''}`} onClick={() => setUi({ showBaseGhost: !ghost })} data-tip="Overlay measured plan" data-tip-pos="bottom">
            <Icon name="compare" size={16} />
          </button>
        )}
      </div>
      <div className="float-bar" style={{ bottom: 12, right: 12 }}>
        <button className="icon-btn" onClick={() => editors.plan?.zoomBy(0.8)} data-tip="Zoom out" data-tip-pos="top">
          <Icon name="zoomOut" size={16} />
        </button>
        <span className="zoom-label">{zoom}%</span>
        <button className="icon-btn" onClick={() => editors.plan?.zoomBy(1.25)} data-tip="Zoom in" data-tip-pos="top">
          <Icon name="zoomIn" size={16} />
        </button>
        <button className="icon-btn" onClick={() => editors.plan?.zoomToFit()} data-tip="Zoom to fit (Shift 1)" data-tip-pos="top" data-testid="zoom-fit">
          <Icon name="fit" size={16} />
        </button>
      </div>
      {empty && <EmptyPlanHint />}
    </>
  );
}

function EmptyPlanHint() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
      <div className="empty-state" style={{ pointerEvents: 'auto', background: 'color-mix(in srgb, var(--bg-elev) 80%, transparent)', borderRadius: 16, backdropFilter: 'blur(10px)' }}>
        <div className="art">
          <Icon name="wall" size={26} />
        </div>
        <h4>Start your floor plan</h4>
        <p>
          Press <span className="kbd">R</span> and drag a room, or <span className="kbd">W</span> to draw walls. Type a number while drawing for an exact length.
        </p>
        <div className="row">
          <button className="btn sm primary" onClick={() => setUi({ tool: 'room' })}>
            <Icon name="room" size={14} /> Draw a room
          </button>
          <button className="btn sm outline" onClick={() => setUi({ screen: 'import' })}>
            <Icon name="image" size={14} /> Import sketches
          </button>
        </div>
      </div>
    </div>
  );
}

function LockedBanner() {
  const locked = useDocument((s) => !!s.doc && s.doc.baseLocked && s.variantId === s.doc.baseVariantId);
  if (!locked) return null;
  return (
    <div className="float-bar" style={{ top: 12, left: '50%', transform: 'translateX(-50%)', padding: '4px 4px 4px 12px', gap: 10 }}>
      <Icon name="lock" size={14} />
      <span style={{ fontSize: 12 }}>The measured plan is protected.</span>
      <button className="btn sm primary" onClick={() => createVariant()}>
        Try changes in a new option
      </button>
      <button className="btn sm" onClick={() => setBaseLocked(false)}>
        Unlock
      </button>
    </div>
  );
}

function FloorMenu() {
  const floors = useDocument((s) => s.doc?.variants[s.variantId]?.floors);
  const order = useDocument((s) => s.doc?.variants[s.variantId]?.floorOrder);
  const active = useDocument((s) => s.floorId);
  const [open, setOpen] = useState(false);
  if (!floors || !order) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(!open)} data-testid="floor-menu">
        <Icon name="layers" size={14} />
        {floors[active]?.name}
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 69 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ position: 'absolute', top: 34, left: 0 }}>
            {[...order].reverse().map((id) => (
              <button
                key={id}
                onClick={() => {
                  setActiveFloor(id);
                  setUi({ selection: [] });
                  setOpen(false);
                }}
              >
                {floors[id].name}
                {id === active && <span className="sc">●</span>}
              </button>
            ))}
            <div className="sep" />
            <button
              onClick={() => {
                addFloor();
                setOpen(false);
              }}
            >
              <Icon name="plus" size={14} /> Add a floor
            </button>
          </div>
        </>
      )}
    </div>
  );
}
