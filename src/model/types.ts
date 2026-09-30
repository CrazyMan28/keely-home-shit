/**
 * Canonical house document model (schema "house-project", version 1).
 *
 * Rules:
 *  - All lengths are millimeters (number). Angles/rotations are degrees.
 *  - Plan space: +x = east, +y = south (screen-down). Elevation is +z up in
 *    the model and maps to +Y in Three.js.
 *  - Walls are CENTERLINE segments between two shared junction nodes plus a
 *    thickness. Because connected walls share node ids, moving a junction
 *    moves every wall attached to it and connectivity can never drift apart.
 *    Face geometry (mitered outlines) is derived, never stored.
 *  - Openings are parametric: they reference a wall and store their offset
 *    along the wall centerline, so they follow the wall when it changes.
 *  - Rooms store only user metadata (name, finishes). Their polygons are
 *    derived from closed wall loops on every change.
 *  - Nothing here refers to UI state; this is what gets saved/exported.
 */
import type { UnitSettings } from '../geometry/measurement/units';
import type { Vec2 } from '../geometry/primitives/vec';

export type Id = string;

/** Renovation phase of an element. */
export type ElementStatus = 'existing' | 'demolish' | 'new';

export interface ElementBase {
  id: Id;
  status: ElementStatus;
  hidden?: boolean;
  /** Locked elements cannot be selected-and-moved accidentally. */
  locked?: boolean;
  name?: string;
  notes?: string;
}

export interface WallNode {
  id: Id;
  x: number;
  y: number;
  /** Pinned in place for the constraint solver ("lock position"). */
  fixed?: boolean;
}

export type WallType = 'interior' | 'exterior';

export interface WallLocks {
  length: boolean;
  angle: boolean;
  position: boolean;
}

export interface Wall extends ElementBase {
  kind: 'wall';
  a: Id;
  b: Id;
  thickness: number;
  height: number;
  wallType: WallType;
  /** Finish on the left side (as seen walking a → b) and the right side. */
  materialId: Id;
  materialIdRight?: Id;
  locks: WallLocks;
  /** Length fixed by a lock (centerline mm). Set whenever locks.length is enabled. */
  lockedLength?: number;
  /** Direction fixed by a lock (degrees). */
  lockedAngle?: number;
  /** Measurement that produced this wall, if imported. */
  sourceObservationId?: Id;
}

export type OpeningType = 'door' | 'window' | 'opening';
export type DoorStyle = 'single' | 'double' | 'sliding' | 'pocket' | 'bifold';
export type WindowStyle = 'single-hung' | 'double-hung' | 'casement' | 'sliding' | 'fixed' | 'picture';

export interface DoorProps {
  style: DoorStyle;
  /** Which end of the opening (along the wall direction a→b) the hinge is on. */
  hinge: 'start' | 'end';
  /** Which side of the wall (left/right of a→b) the leaf swings into. */
  swing: 'left' | 'right';
}

export interface WindowProps {
  style: WindowStyle;
}

export interface Opening extends ElementBase {
  kind: 'opening';
  type: OpeningType;
  wallId: Id;
  /** Distance along the wall centerline from node `a` to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  /** Sill height for windows; threshold (usually 0) for doors. */
  sill: number;
  door?: DoorProps;
  window?: WindowProps;
  materialId?: Id;
}

export type ItemCategory =
  | 'bed'
  | 'seating'
  | 'table'
  | 'storage'
  | 'cabinet'
  | 'counter'
  | 'appliance'
  | 'bath'
  | 'lighting'
  | 'decor'
  | 'electronics'
  | 'structure';

export interface Item extends ElementBase {
  kind: 'item';
  catalogId: string;
  category: ItemCategory;
  /** Center of the footprint. */
  x: number;
  y: number;
  /** Clockwise rotation (on screen) in degrees. */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  /** Height of the bottom above the floor (e.g. wall cabinets). */
  elevation: number;
  materialId?: Id;
  /** Reference to a GLB/GLTF asset; placeholder geometry is used when absent. */
  assetRef?: string;
  metadata: Record<string, string | number | boolean>;
}

export interface Room {
  id: Id;
  kind: 'room';
  name: string;
  floorMaterialId: Id;
  ceilingHeight?: number;
  /** Label displacement from the room's interior point. */
  labelOffset: Vec2;
  /** Sorted node ids of the boundary loop — used to keep identity across edits. */
  boundaryKey: string;
  /** Last known interior point, used as a fallback identity match. */
  anchor: Vec2;
  hidden?: boolean;
}

export interface Annotation extends ElementBase {
  kind: 'annotation';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export interface DimensionLine extends ElementBase {
  kind: 'dimension';
  a: Vec2;
  b: Vec2;
  /** Perpendicular offset of the dimension line from the measured points. */
  offset: number;
  mode: 'manual' | 'locked';
}

export type ConstraintType =
  | 'fixedLength'
  | 'fixedAngle'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equalLength'
  | 'fixedPosition';

export interface Constraint {
  id: Id;
  kind: 'constraint';
  type: ConstraintType;
  /** Wall ids (or node ids for fixedPosition). */
  refs: Id[];
  value?: number;
  enabled: boolean;
  label?: string;
}

export interface Underlay {
  sourceId: Id;
  /** World position (mm) of the image's top-left corner. */
  x: number;
  y: number;
  /** Millimeters per image pixel. */
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface Floor {
  id: Id;
  name: string;
  elevation: number;
  defaultWallHeight: number;
  defaultWallThickness: number;
  nodes: Record<Id, WallNode>;
  walls: Record<Id, Wall>;
  openings: Record<Id, Opening>;
  items: Record<Id, Item>;
  rooms: Record<Id, Room>;
  annotations: Record<Id, Annotation>;
  dimensions: Record<Id, DimensionLine>;
  constraints: Record<Id, Constraint>;
  underlay?: Underlay;
}

export interface Variant {
  id: Id;
  name: string;
  kind: 'base' | 'option';
  /** Variant this one was copied from (the base plan for options). */
  parentId?: Id;
  createdAt: number;
  updatedAt: number;
  floors: Record<Id, Floor>;
  floorOrder: Id[];
  notes?: string;
}

export type MaterialCategory = 'wall' | 'floor' | 'counter' | 'cabinet' | 'door' | 'glass' | 'fabric' | 'generic';
export type MaterialPattern = 'none' | 'wood' | 'tile' | 'brick' | 'carpet' | 'stone' | 'concrete';

export interface Material {
  id: Id;
  name: string;
  category: MaterialCategory;
  color: string;
  roughness: number;
  metalness: number;
  pattern: MaterialPattern;
  /** Size of one pattern repeat in mm (tile size, plank width, ...). */
  patternScale: number;
  /** Optional external texture (URL or asset id) for future photoreal materials. */
  textureRef?: string;
  opacity?: number;
}

export type ObservationType =
  | 'wall_length'
  | 'room_width'
  | 'room_depth'
  | 'opening_width'
  | 'door'
  | 'window'
  | 'offset'
  | 'ceiling_height'
  | 'label'
  | 'fixture'
  | 'note'
  | 'other';

export type ObservationStatus = 'confirmed' | 'likely' | 'ambiguous' | 'conflicting' | 'missing' | 'rejected';

export interface ObservationAlternative {
  text: string;
  valueMm: number;
  confidence: number;
}

/** A single thing read off a sketch. The reconciliation engine, not the reader, decides geometry. */
export interface Observation {
  id: Id;
  type: ObservationType;
  sourceImageId: Id;
  originalText: string;
  valueMm?: number;
  alternatives: ObservationAlternative[];
  confidence: number;
  /** Normalized 0..1 box in the source image. */
  bbox?: { x: number; y: number; w: number; h: number };
  interpretation: string;
  status: ObservationStatus;
  /** Room / group this reading belongs to (e.g. "Kitchen"). */
  group?: string;
  /** Compass side for room edges: which way the edge runs when walking the room clockwise. */
  direction?: 'N' | 'E' | 'S' | 'W' | number;
  /** Order of the edge within its room loop. */
  sequence?: number;
  linkedElementId?: Id;
  /** For openings: index of the room edge (in sequence order) the opening sits on. */
  edgeIndex?: number;
  /** For openings: distance from the start of that edge to the opening's near side. */
  offsetMm?: number;
  /** Whether the user accepted this reading as approximate (excluded from strict checks). */
  approximate?: boolean;
  provider: string;
}

export interface SourceImage {
  id: Id;
  name: string;
  width: number;
  height: number;
  mime: string;
  /** Key of the image blob in the blob store (not embedded in the document). */
  blobKey: string;
  addedAt: number;
}

export interface ProjectSettings {
  units: UnitSettings;
  /** Which surface displayed wall lengths refer to. */
  dimensionReference: 'centerline' | 'interior';
  gridSize: number;
}

export interface ProjectDoc {
  schema: 'house-project';
  version: 1;
  id: Id;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  materials: Record<Id, Material>;
  variants: Record<Id, Variant>;
  variantOrder: Id[];
  baseVariantId: Id;
  /** Base measured plan is protected from edits unless unlocked. */
  baseLocked: boolean;
  sources: Record<Id, SourceImage>;
  observations: Record<Id, Observation>;
  /** Import review state: where each reconstructed room sits (mm), and options. */
  importLayout?: Record<string, { x: number; y: number }>;
  importSettings?: ImportSettings;
}

export interface ImportSettings {
  /** Sketch lengths are finished wall-to-wall inside the room (typical tape measurements). */
  interiorMeasurements: boolean;
  /** Lock confirmed measured lengths when building the base plan. */
  lockMeasured: boolean;
}

export type PlanElement = Wall | Opening | Item | Annotation | DimensionLine;
export type ElementKind = PlanElement['kind'] | 'room' | 'node';
