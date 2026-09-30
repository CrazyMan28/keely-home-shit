import { setTool, setUi, useUi, type Tool } from '../state/uiStore';
import { Icon, type IconName } from './Icon';

const TOOLS: Array<{ tool: Tool; icon: IconName; label: string; key: string; xs?: boolean } | 'sep'> = [
  { tool: 'select', icon: 'select', label: 'Select', key: 'V' },
  { tool: 'pan', icon: 'pan', label: 'Pan', key: 'H', xs: true },
  'sep',
  { tool: 'wall', icon: 'wall', label: 'Wall', key: 'W' },
  { tool: 'room', icon: 'room', label: 'Room', key: 'R' },
  { tool: 'door', icon: 'door', label: 'Door', key: 'D' },
  { tool: 'window', icon: 'window', label: 'Window', key: 'N' },
  { tool: 'opening', icon: 'opening', label: 'Opening', key: 'O', xs: true },
  'sep',
  { tool: 'dimension', icon: 'ruler', label: 'Dimension', key: '⇧D', xs: true },
  { tool: 'measure', icon: 'measure', label: 'Measure', key: 'M' },
  { tool: 'text', icon: 'text', label: 'Note', key: 'T', xs: true },
];

export function ToolRail() {
  const tool = useUi((s) => s.tool);
  const panel = useUi((s) => s.rightPanel);
  const open = useUi((s) => s.rightPanelOpen);
  const libOn = tool === 'item' || (open && panel === 'library');
  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map((t, i) =>
        t === 'sep' ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={t.tool}
            className={`icon-btn${tool === t.tool ? ' active' : ''}${t.xs ? ' hide-xs' : ''}`}
            onClick={() => setTool(t.tool)}
            data-tip={`${t.label}  ${t.key}`}
            data-tip-pos="right"
            aria-label={t.label}
            data-testid={`tool-${t.tool}`}
          >
            <Icon name={t.icon} size={19} />
          </button>
        ),
      )}
      <div className="sep" />
      <button className={`icon-btn${libOn ? ' active' : ''}`} onClick={() => setUi({ rightPanel: 'library', rightPanelOpen: true })} data-tip="Furniture & fixtures  F" data-tip-pos="right" data-testid="tool-library">
        <Icon name="sofa" size={19} />
      </button>
      <div className="grow" />
      <button className="icon-btn" onClick={() => setUi({ screen: 'import' })} data-tip="Import measurement sketches" data-tip-pos="right">
        <Icon name="scan" size={19} />
      </button>
      <button className="icon-btn hide-xs" onClick={() => setUi({ dialog: { kind: 'shortcuts' } })} data-tip="Keyboard shortcuts  ?" data-tip-pos="right">
        <Icon name="keyboard" size={19} />
      </button>
    </nav>
  );
}
