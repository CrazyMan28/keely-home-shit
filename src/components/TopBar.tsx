import { useState } from 'react';
import { closeProject } from '../app/projectActions';
import { MOD } from '../app/shortcuts';
import { createVariant, renameProject } from '../state/actions';
import { redo, setActiveVariant, undo, useDocument } from '../state/documentStore';
import { setTheme, setUi, useUi, type ViewMode } from '../state/uiStore';
import type { RenovationView } from '../model/renovation';
import { Segmented, TextInput } from './common';
import { Icon } from './Icon';

export function TopBar() {
  const name = useDocument((s) => s.doc?.name ?? '');
  const canUndo = useDocument((s) => s.past.length > 0);
  const canRedo = useDocument((s) => s.future.length > 0);
  const undoLabel = useDocument((s) => s.past.at(-1)?.label);
  const redoLabel = useDocument((s) => s.future[0]?.label);
  const viewMode = useUi((s) => s.viewMode);
  const renovationView = useUi((s) => s.renovationView);
  const theme = useUi((s) => s.theme);
  const rightOpen = useUi((s) => s.rightPanelOpen);

  return (
    <header className="topbar">
      <div className="tb-left">
        <button className="brand" onClick={() => void closeProject()} data-tip="All projects" data-tip-pos="bottom" data-testid="home-button">
          <span className="brand-mark">
            <Icon name="home" size={15} stroke={2} />
          </span>
        </button>
        <div className="hide-xs">
          <ProjectName name={name} />
        </div>
        <div className="hide-xs">
          <VariantMenu />
        </div>
      </div>
      <div className="tb-center">
        <Segmented<ViewMode>
          testId="view-mode"
          value={viewMode}
          onChange={(v) => setUi({ viewMode: v, walkMode: false })}
          options={[
            { value: '2d', label: '2D', tip: 'Floor plan (1)' },
            { value: 'split', label: 'Split', tip: '2D + 3D side by side (2)' },
            { value: '3d', label: '3D', tip: '3D model (3)' },
          ]}
        />
      </div>
      <div className="tb-right">
        <RenovationMenu value={renovationView} />
        <div className="divider-v hide-sm" />
        <button className="icon-btn" disabled={!canUndo} onClick={() => undo()} data-tip={`Undo ${undoLabel ?? ''} (${MOD}Z)`} data-tip-pos="bottom" data-testid="undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => redo()} data-tip={`Redo ${redoLabel ?? ''} (${MOD}⇧Z)`} data-tip-pos="bottom" data-testid="redo">
          <Icon name="redo" />
        </button>
        <SaveState />
        <div className="divider-v hide-xs" />
        <button className="btn sm hide-sm" onClick={() => setUi({ screen: 'import' })} data-testid="open-import" data-tip="Import measurement sketches" data-tip-pos="bottom">
          <Icon name="image" size={15} /> Import
        </button>
        <button className="btn sm outline hide-xs" onClick={() => setUi({ dialog: { kind: 'export' } })} data-testid="open-export">
          <Icon name="download" size={15} /> Export
        </button>
        <button
          className="icon-btn hide-sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
          data-tip={`Theme: ${theme}`}
          data-tip-pos="bottom"
        >
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
        </button>
        <button className="icon-btn hide-xs" onClick={() => setUi({ dialog: { kind: 'settings' } })} data-tip="Settings" data-tip-pos="bottom">
          <Icon name="settings" />
        </button>
        <button className={`icon-btn${rightOpen ? ' active' : ''}`} onClick={() => setUi({ rightPanelOpen: !rightOpen })} data-tip="Toggle panel" data-tip-pos="bottom">
          <Icon name="panelRight" />
        </button>
      </div>
    </header>
  );
}

const RENO: Record<RenovationView, { label: string; desc: string; color: string }> = {
  existing: { label: 'Existing', desc: 'The house as it is today', color: 'var(--text-muted)' },
  demolition: { label: 'Demolition', desc: 'What gets torn out (red)', color: 'var(--danger)' },
  proposed: { label: 'Proposed', desc: 'The finished result', color: 'var(--info)' },
  combined: { label: 'All changes', desc: 'Existing, demolished and new, color-coded', color: 'var(--accent)' },
};

function RenovationMenu({ value }: { value: RenovationView }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }} className="hide-sm">
      <button className="btn sm" onClick={() => setOpen(!open)} data-tip="Renovation view" data-tip-pos="bottom" data-testid="renovation-menu">
        <span className="dot" style={{ background: RENO[value].color }} />
        {RENO[value].label}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 69 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ top: 34, right: 0, position: 'absolute', minWidth: 260 }}>
            {(Object.keys(RENO) as RenovationView[]).map((k) => (
              <button
                key={k}
                style={{ height: 'auto', padding: '7px 10px', alignItems: 'flex-start' }}
                onClick={() => {
                  setUi({ renovationView: k });
                  setOpen(false);
                }}
              >
                <span className="dot" style={{ background: RENO[k].color, marginTop: 5 }} />
                <span>
                  <div style={{ fontWeight: 600 }}>{RENO[k].label}</div>
                  <div style={{ opacity: 0.7, fontSize: 11.5 }}>{RENO[k].desc}</div>
                </span>
                {k === value && <span className="sc">●</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectName({ name }: { name: string }) {
  return (
    <div style={{ width: 170 }}>
      <TextInput value={name} onCommit={renameProject} />
    </div>
  );
}

function SaveState() {
  const status = useUi((s) => s.saveStatus);
  const label = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved', error: 'Save failed' }[status];
  return (
    <span className={`save-state ${status} hide-xs`} data-testid="save-state">
      <span className="dot" />
      {label}
    </span>
  );
}

function VariantMenu() {
  const variantMap = useDocument((s) => s.doc?.variants);
  const order = useDocument((s) => s.doc?.variantOrder);
  const variants = order && variantMap ? order.map((id) => variantMap[id]).filter(Boolean) : [];
  const activeId = useDocument((s) => s.variantId);
  const baseId = useDocument((s) => s.doc?.baseVariantId);
  const baseLocked = useDocument((s) => s.doc?.baseLocked);
  const [open, setOpen] = useState(false);
  const active = variants.find((v) => v.id === activeId);
  if (!active) return null;
  const isBase = active.id === baseId;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(!open)} data-testid="variant-menu">
        <span className={`chip ${isBase ? 'success' : 'accent'}`} style={{ height: 18 }}>
          {isBase ? (baseLocked ? <Icon name="lock" size={11} stroke={2} /> : <Icon name="target" size={11} stroke={2} />) : <Icon name="sparkles" size={11} stroke={2} />}
          {isBase ? 'Measured' : 'Option'}
        </span>
        <span className="hide-xs">{active.name}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 69 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ top: 42, left: 0, position: 'absolute' }}>
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setActiveVariant(v.id);
                  setUi({ selection: [] });
                  setOpen(false);
                }}
              >
                <Icon name={v.id === baseId ? 'target' : 'sparkles'} size={14} />
                {v.name}
                {v.id === activeId && <span className="sc">●</span>}
              </button>
            ))}
            <div className="sep" />
            <button
              onClick={() => {
                createVariant();
                setOpen(false);
              }}
              data-testid="new-option"
            >
              <Icon name="plus" size={14} /> New design option
            </button>
            <button
              onClick={() => {
                setUi({ rightPanel: 'variants', rightPanelOpen: true });
                setOpen(false);
              }}
            >
              <Icon name="layers" size={14} /> Manage options…
            </button>
            <button
              onClick={() => {
                setUi({ dialog: { kind: 'compare' } });
                setOpen(false);
              }}
            >
              <Icon name="compare" size={14} /> Compare…
            </button>
          </div>
        </>
      )}
    </div>
  );
}
