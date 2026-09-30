import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { formatLength, formatLengthForInput } from '../geometry/measurement/format';
import { parseAngle, parseLength } from '../geometry/measurement/parse';
import type { UnitSettings } from '../geometry/measurement/units';
import { useDocument } from '../state/documentStore';
import { DEFAULT_UNIT_SETTINGS } from '../geometry/measurement/units';

export function useUnits(): UnitSettings {
  return useDocument((s) => s.doc?.settings.units ?? DEFAULT_UNIT_SETTINGS);
}

/** Segmented control with an animated sliding thumb. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size,
  testId,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; tip?: string }>;
  onChange: (v: T) => void;
  size?: 'sm';
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(value)}"]`);
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="segmented" ref={ref} role="tablist" data-testid={testId} style={size === 'sm' ? { transform: 'scale(0.95)' } : undefined}>
      {thumb && <span className="thumb" style={{ left: thumb.left, width: thumb.width }} />}
      {options.map((o) => (
        <button key={o.value} data-v={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} data-tip={o.tip} data-tip-pos="bottom">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Exact length input. Shows the formatted value; accepts anything the
 * measurement parser understands (15'2", 5' 10 1/2", 1778 mm, 12' + 3"…).
 * Commits on Enter/blur; Escape reverts; ↑/↓ nudge by 1" (Shift: 1').
 */
export function LengthInput({
  value,
  onCommit,
  min = 0,
  allowNegative = false,
  disabled,
  focusKey,
  placeholder,
  testId,
}: {
  value: number;
  onCommit: (mm: number) => void;
  min?: number;
  allowNegative?: boolean;
  disabled?: boolean;
  focusKey?: string;
  placeholder?: string;
  testId?: string;
}) {
  const units = useUnits();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const display = formatLength(value, units);
  const commit = () => {
    if (text === null) return;
    const r = parseLength(text, { system: units.system, metricUnit: units.metricUnit, allowNegative });
    if (!r.ok || (!allowNegative && r.mm < min)) {
      setError(true);
      return;
    }
    setText(null);
    setError(false);
    if (Math.abs(r.mm - value) > 1e-6) onCommit(r.mm);
  };
  const step = (dir: number, big: boolean) => {
    const inc = units.system === 'imperial' ? (big ? 304.8 : 25.4) : big ? 100 : 10;
    const next = Math.max(allowNegative ? -Infinity : min, value + dir * inc);
    onCommit(next);
    setText(null);
  };
  return (
    <input
      className={`input${error ? ' invalid' : ''}`}
      value={text ?? display}
      disabled={disabled}
      placeholder={placeholder}
      data-focus={focusKey}
      data-testid={testId}
      spellCheck={false}
      autoComplete="off"
      inputMode="text"
      onFocus={(e) => {
        setText(formatLengthForInput(value, units).replace(/ mm$/, ' mm'));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => {
        setText(e.target.value);
        setError(false);
      }}
      onBlur={() => {
        commit();
        setText(null);
        setError(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(null);
          setError(false);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
        }
      }}
    />
  );
}

export function AngleInput({ value, onCommit, disabled }: { value: number; onCommit: (deg: number) => void; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const display = `${+value.toFixed(2)}°`;
  const commit = () => {
    if (text === null) return;
    const r = parseAngle(text);
    if (!r.ok) {
      setError(true);
      return;
    }
    setText(null);
    if (Math.abs(r.deg - value) > 1e-9) onCommit(r.deg);
  };
  return (
    <input
      className={`input${error ? ' invalid' : ''}`}
      value={text ?? display}
      disabled={disabled}
      onFocus={(e) => {
        setText(String(+value.toFixed(4)));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => {
        setText(e.target.value);
        setError(false);
      }}
      onBlur={() => {
        commit();
        setText(null);
        setError(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          onCommit(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 15 : 1));
        }
      }}
    />
  );
}

export function TextInput({ value, onCommit, focusKey, placeholder }: { value: string; onCommit: (v: string) => void; focusKey?: string; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null && text.trim() && text !== value) onCommit(text.trim());
    setText(null);
  };
  return (
    <input
      className="input"
      value={text ?? value}
      data-focus={focusKey}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="lock-row" onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} />
    </label>
  );
}
