import type { PlanDerived } from '../../../geometry/derive';
import type { UnitSettings } from '../../../geometry/measurement/units';
import type { Vec2 } from '../../../geometry/primitives/vec';
import type { SnapResult } from '../../../geometry/snapping/snap';
import type { Floor, Id } from '../../../model/types';
import type { DimensionTarget } from '../../../state/uiStore';
import type { Hit, HitContext } from '../hitTest';
import type { ToolOverlay } from '../renderer';
import type { Viewport } from '../viewport';

export interface ToolEvent {
  world: Vec2;
  screen: Vec2;
  client: Vec2;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  button: number;
  pointerType: string;
}

export interface SnapRequest {
  from?: Vec2;
  excludeNodes?: Id[];
  excludeWalls?: Id[];
  /** Round free lengths to this step (mm). */
  lengthStep?: boolean;
}

/** What tools can ask of the 2D editor controller. */
export interface ToolHost {
  vp: Viewport;
  floor(): Floor;
  derived(): PlanDerived;
  units(): UnitSettings;
  snap(e: ToolEvent, req?: SnapRequest): SnapResult;
  hit(e: ToolEvent, opts?: { labels?: boolean; handles?: boolean }): Hit | null;
  hitContext(): HitContext;
  setOverlay(o: ToolOverlay): void;
  setCursor(c: string): void;
  setHint(text: string): void;
  requestRender(): void;
  /** Opens the exact-value popover at a screen position. */
  openValueInput(target: DimensionTarget, client: Vec2, current: number, initialText?: string): void;
  closeValueInput(): void;
  /** Length step for eyeballed values (1/2" or 5 mm). */
  roundStep(): number;
}

export interface Tool2D {
  readonly id: string;
  cursor: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown(e: ToolEvent): void;
  pointerMove(e: ToolEvent): void;
  pointerUp(e: ToolEvent): void;
  doubleClick?(e: ToolEvent): void;
  /** Returns true when the key was consumed. */
  keyDown?(e: KeyboardEvent): boolean;
  /** Exact value typed into the popover (drawLength / moveOffset). */
  submitValue?(mm: number, text: string): void;
  cancel(): boolean;
}
