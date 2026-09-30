/**
 * Lightweight registry of the live editor controllers so UI code can reach
 * them without importing heavy modules (keeps three.js in a lazy chunk).
 */
export interface PlanEditorApi {
  handleKey(e: KeyboardEvent): boolean;
  submitToolValue(mm: number, text: string): void;
  zoomToFit(animate?: boolean): void;
  zoomBy(factor: number): void;
  thumbnail(w?: number, h?: number): string | undefined;
  exportPng(scale?: number): Promise<Blob | null>;
}

export interface SceneEditorApi {
  handleKey(e: KeyboardEvent): boolean;
  submitToolValue(mm: number): void;
  exportGLB(): Promise<Blob>;
  screenshot(): string;
  setGizmoMode(mode: 'move' | 'rotate'): void;
  useOrtho(on: boolean): void;
  readonly isOrtho: boolean;
  gizmoMode: 'move' | 'rotate';
}

export const editors: { plan: PlanEditorApi | null; scene: SceneEditorApi | null; focused: 'plan' | 'scene' } = {
  plan: null,
  scene: null,
  focused: 'plan',
};
