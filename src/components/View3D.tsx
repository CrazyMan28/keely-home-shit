import { useEffect, useRef, useState } from 'react';
import { SceneController, type CameraPreset, type GizmoMode } from '../editor/3d/sceneController';
import { getActiveFloor } from '../state/documentStore';
import { setUi, useUi } from '../state/uiStore';
import { Icon } from './Icon';

const PRESETS: Array<{ id: CameraPreset; label: string }> = [
  { id: 'perspective', label: 'Perspective' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

export default function View3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const ctrl = useRef<SceneController | null>(null);
  const walk = useUi((s) => s.walkMode);
  const selection = useUi((s) => s.selection);
  const [ortho, setOrtho] = useState(false);
  const [gizmo, setGizmo] = useState<GizmoMode>('move');
  const [preset, setPreset] = useState<CameraPreset>('perspective');

  useEffect(() => {
    const c = new SceneController(hostRef.current!, readoutRef.current!);
    ctrl.current = c;
    return () => {
      c.dispose();
      ctrl.current = null;
    };
  }, []);

  const itemSelected = selection.length === 1 && !!getActiveFloor()?.items[selection[0]];

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} data-testid="scene-3d">
      <div
        ref={readoutRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          opacity: 0,
          pointerEvents: 'none',
          padding: '5px 10px',
          borderRadius: 7,
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontWeight: 600,
          fontSize: 12,
          boxShadow: 'var(--shadow-soft)',
          transition: 'opacity 120ms',
          zIndex: 7,
          whiteSpace: 'nowrap',
        }}
      />
      <div className="float-bar" style={{ top: 12, left: 12 }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`btn sm${preset === p.id && !walk ? ' outline' : ''}`}
            onClick={() => {
              setPreset(p.id);
              setUi({ cameraPreset: p.id, walkMode: false });
              if (p.id === 'top') setOrtho(true);
              else if (p.id === 'perspective') setOrtho(false);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="float-bar" style={{ bottom: 12, right: 12 }}>
        <button
          className={`icon-btn${ortho ? ' active' : ''}`}
          onClick={() => {
            ctrl.current?.useOrtho(!ortho);
            setOrtho(!ortho);
          }}
          data-tip={ortho ? 'Orthographic' : 'Perspective'}
          data-tip-pos="top"
        >
          <Icon name="cube" size={16} />
        </button>
        <button className={`icon-btn${walk ? ' active' : ''}`} onClick={() => setUi({ walkMode: !walk })} data-tip="Walk through (WASD)" data-tip-pos="top" data-testid="walk-toggle">
          <Icon name="walk" size={16} />
        </button>
        {itemSelected && !walk && (
          <>
            <div className="divider-v" />
            <button
              className={`icon-btn${gizmo === 'move' ? ' active' : ''}`}
              onClick={() => {
                ctrl.current?.setGizmoMode('move');
                setGizmo('move');
              }}
              data-tip="Move gizmo (G)"
              data-tip-pos="top"
            >
              <Icon name="pan" size={16} />
            </button>
            <button
              className={`icon-btn${gizmo === 'rotate' ? ' active' : ''}`}
              onClick={() => {
                ctrl.current?.setGizmoMode('rotate');
                setGizmo('rotate');
              }}
              data-tip="Rotate gizmo (G)"
              data-tip-pos="top"
            >
              <Icon name="rotate" size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
