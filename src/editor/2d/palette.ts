/**
 * Canvas colors, read from CSS custom properties so the plan follows the
 * app theme. Re-read whenever the theme changes.
 */
export interface PlanPalette {
  bg: string;
  grid: string;
  gridMajor: string;
  wall: string;
  wallNew: string;
  wallNewFill: string;
  wallDemo: string;
  wallDemoFill: string;
  roomFill: string;
  roomFillHover: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  dim: string;
  labelBg: string;
  furniture: string;
  furnitureStroke: string;
  glass: string;
  snap: string;
  guide: string;
  warning: string;
  danger: string;
  font: string;
}

export function readPalette(el: Element = document.documentElement): PlanPalette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--canvas-bg', '#101114'),
    grid: v('--canvas-grid', 'rgba(255,255,255,0.04)'),
    gridMajor: v('--canvas-grid-major', 'rgba(255,255,255,0.08)'),
    wall: v('--canvas-wall', '#d9dce3'),
    wallNew: v('--canvas-wall-new', '#4fb3ff'),
    wallNewFill: v('--canvas-wall-new-fill', 'rgba(79,179,255,0.55)'),
    wallDemo: v('--canvas-wall-demo', '#ff5f57'),
    wallDemoFill: v('--canvas-wall-demo-fill', 'rgba(255,95,87,0.12)'),
    roomFill: v('--canvas-room', 'rgba(255,255,255,0.025)'),
    roomFillHover: v('--canvas-room-hover', 'rgba(255,255,255,0.05)'),
    ink: v('--canvas-ink', '#e8eaef'),
    inkMuted: v('--canvas-ink-muted', '#9aa0ab'),
    inkFaint: v('--canvas-ink-faint', 'rgba(255,255,255,0.25)'),
    accent: v('--accent', '#7c6cff'),
    accentSoft: v('--accent-soft', 'rgba(124,108,255,0.18)'),
    accentInk: v('--accent-ink', '#ffffff'),
    dim: v('--canvas-dim', '#aab0bb'),
    labelBg: v('--canvas-label-bg', 'rgba(16,17,20,0.88)'),
    furniture: v('--canvas-furniture', 'rgba(255,255,255,0.06)'),
    furnitureStroke: v('--canvas-furniture-stroke', 'rgba(232,234,239,0.55)'),
    glass: v('--canvas-glass', '#7fc8ff'),
    snap: v('--canvas-snap', '#ffb224'),
    guide: v('--canvas-guide', 'rgba(255,178,36,0.55)'),
    warning: v('--warning', '#ffb224'),
    danger: v('--danger', '#ff5f57'),
    font: v('--font-ui', 'Inter, system-ui, -apple-system, sans-serif'),
  };
}
