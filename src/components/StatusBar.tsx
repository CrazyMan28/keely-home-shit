import { formatLength } from '../geometry/measurement/format';
import { updateSettings } from '../state/actions';
import { useDocument } from '../state/documentStore';
import { setUi, useUi } from '../state/uiStore';
import { useUnits } from './common';
import { Icon } from './Icon';

export function StatusBar() {
  const hint = useUi((s) => s.hint);
  const cursor = useUi((s) => s.cursor);
  const zoom = useUi((s) => s.zoomPercent);
  const selection = useUi((s) => s.selection.length);
  const snapEnabled = useUi((s) => s.snapEnabled);
  const strict = useUi((s) => s.strictMode);
  const violations = useDocument((s) => s.violations);
  const units = useUnits();
  const locked = useDocument((s) => !!s.doc && s.doc.baseLocked && s.variantId === s.doc.baseVariantId);
  const precisionLabel = units.system === 'imperial' ? (units.imperialPrecision === 1 ? '1"' : `1/${units.imperialPrecision}"`) : units.metricUnit;

  return (
    <footer className="statusbar">
      {locked && (
        <span className="chip success">
          <Icon name="lock" size={11} stroke={2} /> Measured plan locked
        </span>
      )}
      <span className="hint" key={hint}>
        {violations.length ? (
          <span className="warn">
            <Icon name="alert" size={12} /> {violations[0].label} can’t be satisfied (off by {violations[0].unit === 'mm' ? formatLength(violations[0].residual, units) : `${violations[0].residual.toFixed(2)}°`})
          </span>
        ) : (
          hint || 'Tip: click any measurement on the plan to type an exact value'
        )}
      </span>
      {selection > 0 && <span className="hide-xs">{selection} selected</span>}
      {cursor && (
        <span className="mono hide-xs" style={{ minWidth: 150, textAlign: 'right' }}>
          {formatLength(cursor.x, units)}, {formatLength(cursor.y, units)}
        </span>
      )}
      <span className="tnum hide-xs">{zoom}%</span>
      <button onClick={() => updateSettings({ units: { ...units, system: units.system === 'imperial' ? 'metric' : 'imperial' } }, 'Change units')} data-tip="Switch units" data-tip-pos="top" data-testid="units-toggle">
        {units.system === 'imperial' ? 'ft-in' : 'metric'} · {precisionLabel}
      </button>
      <button onClick={() => setUi({ snapEnabled: !snapEnabled })} style={{ color: snapEnabled ? 'var(--accent)' : undefined }} data-tip="Snapping (hold Alt to bypass)" data-tip-pos="top">
        <Icon name="magnet" size={13} /> Snap
      </button>
      <button className="hide-xs" onClick={() => setUi({ strictMode: !strict })} style={{ color: strict ? 'var(--warning)' : undefined }} data-tip="Strict mode warns when placements collide" data-tip-pos="top">
        Strict {strict ? 'on' : 'off'}
      </button>
    </footer>
  );
}
