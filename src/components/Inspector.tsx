import { useMemo, useState } from 'react';
import { CATALOG_BY_ID, CATEGORY_LABELS } from '../assets/catalog';
import { derivePlan } from '../geometry/derive';
import { distancesToWalls } from '../geometry/items/items';
import { formatArea, formatLength } from '../geometry/measurement/format';
import { faceLength, wallAngleDeg } from '../geometry/walls/wallGeometry';
import type { ResizeAnchor } from '../geometry/walls/wallOps';
import { STATUS_LABEL } from '../model/renovation';
import type { DoorStyle, ElementStatus, Floor, Id, Item, MaterialCategory, Opening, Wall, WindowStyle } from '../model/types';
import {
  convertWallType,
  deleteSelection,
  duplicateSelection,
  flipDoor,
  mergeSelectedWalls,
  reverseWallDirection,
  rotateItems,
  setFlag,
  setItemDistance,
  setStatus,
  setWallDirection,
  setWallEndpoint,
  setWallLength,
  splitWall,
  toggleWallLock,
  updateItem,
  updateOpening,
  updateRoom,
  updateSettings,
  updateWall,
  updateWalls,
} from '../state/actions';
import { editFloor, useDocument } from '../state/documentStore';
import { FloorEditor } from '../model/floorEditor';
import { select, useUi } from '../state/uiStore';
import { AngleInput, LengthInput, Switch, TextInput, useUnits } from './common';
import { Icon, type IconName } from './Icon';

function useFloor(): Floor | undefined {
  return useDocument((s) => s.doc?.variants[s.variantId]?.floors[s.floorId]);
}

export function Inspector() {
  const selection = useUi((s) => s.selection);
  const floor = useFloor();
  if (!floor) return null;
  if (selection.length === 0) return <FloorInspector floor={floor} />;
  if (selection.length > 1) return <MultiInspector ids={selection} floor={floor} />;
  const id = selection[0];
  if (floor.walls[id]) return <WallInspector key={id} wall={floor.walls[id]} floor={floor} />;
  if (floor.openings[id]) return <OpeningInspector key={id} o={floor.openings[id]} floor={floor} />;
  if (floor.items[id]) return <ItemInspector key={id} item={floor.items[id]} floor={floor} />;
  if (floor.rooms[id]) return <RoomInspector key={id} id={id} floor={floor} />;
  if (floor.annotations[id]) return <NoteInspector key={id} id={id} floor={floor} />;
  if (floor.dimensions[id]) return <DimInspector key={id} id={id} floor={floor} />;
  return null;
}

function Head({ icon, title, sub }: { icon: IconName; title: string; sub?: string }) {
  return (
    <div className="inspector-head">
      <div className="glyph">
        <Icon name={icon} size={17} />
      </div>
      <div style={{ minWidth: 0 }}>
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}

function StatusPicker({ ids, status }: { ids: Id[]; status: ElementStatus }) {
  return (
    <div className="section">
      <div className="section-title">Renovation</div>
      <div className="status-pills">
        {(['existing', 'demolish', 'new'] as ElementStatus[]).map((s) => (
          <button key={s} data-s={s} className={status === s ? 'on' : ''} onClick={() => setStatus(ids, s)}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

function MaterialSelect({ value, category, onChange, focusKey }: { value: Id | undefined; category: MaterialCategory | MaterialCategory[]; onChange: (id: Id) => void; focusKey?: string }) {
  const mats = useDocument((s) => s.doc?.materials);
  const cats = Array.isArray(category) ? category : [category];
  const list = Object.values(mats ?? {}).filter((m) => cats.includes(m.category));
  const current = value ? mats?.[value] : undefined;
  return (
    <div className="row">
      <span style={{ width: 22, height: 22, borderRadius: 5, background: current?.color ?? '#888', boxShadow: '0 0 0 1px var(--border-strong) inset', flex: 'none' }} />
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} data-focus={focusKey}>
        {!current && <option value="">—</option>}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Wall ──────────────────────────────────────────────────────────────────

function WallInspector({ wall, floor }: { wall: Wall; floor: Floor }) {
  const units = useUnits();
  const reference = useDocument((s) => s.doc?.settings.dimensionReference ?? 'centerline');
  const view = useUi((s) => s.renovationView);
  const [anchor, setAnchor] = useState<ResizeAnchor>('start');
  const a = floor.nodes[wall.a];
  const b = floor.nodes[wall.b];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = wallAngleDeg(floor, wall);
  const fp = derivePlan(floor, view).geometry.footprints.get(wall.id);
  const faces = fp ? { left: faceLength(fp, 'left'), right: faceLength(fp, 'right') } : null;
  const interiorFace = faces ? (faces.left <= faces.right ? 'left' : 'right') : 'left';
  const selectedWalls = useUi((s) => s.selection);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const anchorName = (k: ResizeAnchor) => (k === 'center' ? 'Center' : horizontal ? ((k === 'start') === a.x <= b.x ? 'Left' : 'Right') : (k === 'start') === a.y <= b.y ? 'Top' : 'Bottom');

  return (
    <div className="scroll" style={{ height: '100%' }}>
      <Head icon="wall" title={wall.name ?? (wall.wallType === 'exterior' ? 'Exterior wall' : 'Interior wall')} sub={`${formatLength(length, units)} · ${STATUS_LABEL[wall.status]}`} />
      <div className="section">
        <div className="section-title">Dimensions</div>
        <div className="field">
          <label>Length {reference === 'interior' ? '(centerline)' : ''}</label>
          <LengthInput value={length} focusKey="wall-length" testId="wall-length" onCommit={(v) => setWallLength(wall.id, v, { anchor, mode: 'connected' })} />
        </div>
        {faces && (
          <div className="field">
            <label>Interior face length</label>
            <LengthInput value={faces[interiorFace]} onCommit={(v) => setWallLength(wall.id, v, { anchor, mode: 'connected', face: interiorFace })} />
          </div>
        )}
        <div className="field">
          <label>When resizing, keep fixed</label>
          <div className="segmented" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
            {(['start', 'center', 'end'] as ResizeAnchor[]).map((k) => (
              <button key={k} className={anchor === k ? 'on' : ''} onClick={() => setAnchor(k)} style={anchor === k ? { background: 'var(--bg-elev)', boxShadow: '0 1px 3px rgba(0,0,0,.2)' } : undefined}>
                {anchorName(k)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Thickness</label>
            <LengthInput value={wall.thickness} min={10} onCommit={(v) => updateWall(wall.id, { thickness: v }, 'Change wall thickness')} />
          </div>
          <div className="field">
            <label>Height</label>
            <LengthInput value={wall.height} min={100} onCommit={(v) => updateWall(wall.id, { height: v }, 'Change wall height')} />
          </div>
          <div className="field">
            <label>Angle</label>
            <AngleInput value={(360 - angle) % 360} onCommit={(d) => setWallDirection(wall.id, (360 - d) % 360, anchor === 'end' ? 'end' : anchor === 'center' ? 'center' : 'start')} />
          </div>
          <div className="field">
            <label>Type</label>
            <select className="input" value={wall.wallType} onChange={(e) => convertWallType(wall.id, e.target.value as Wall['wallType'])}>
              <option value="interior">Interior</option>
              <option value="exterior">Exterior</option>
            </select>
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Position</div>
        <div className="grid2">
          <div className="field">
            <label>Start X</label>
            <LengthInput value={a.x} allowNegative onCommit={(v) => setWallEndpoint(wall.id, 'a', { x: v, y: a.y })} />
          </div>
          <div className="field">
            <label>Start Y</label>
            <LengthInput value={a.y} allowNegative onCommit={(v) => setWallEndpoint(wall.id, 'a', { x: a.x, y: v })} />
          </div>
          <div className="field">
            <label>End X</label>
            <LengthInput value={b.x} allowNegative onCommit={(v) => setWallEndpoint(wall.id, 'b', { x: v, y: b.y })} />
          </div>
          <div className="field">
            <label>End Y</label>
            <LengthInput value={b.y} allowNegative onCommit={(v) => setWallEndpoint(wall.id, 'b', { x: b.x, y: v })} />
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Finish</div>
        <div className="field">
          <label>Left side</label>
          <MaterialSelect value={wall.materialId} category="wall" onChange={(id) => updateWall(wall.id, { materialId: id }, 'Change material')} />
        </div>
      </div>
      <div className="section">
        <div className="section-title">Locks</div>
        <Switch on={wall.locks.length} onChange={() => toggleWallLock(wall.id, 'length')} label={<span>Lock length{wall.locks.length && wall.lockedLength ? <span className="muted"> · {formatLength(wall.lockedLength, units)}</span> : null}</span>} />
        <Switch on={wall.locks.angle} onChange={() => toggleWallLock(wall.id, 'angle')} label="Lock angle" />
        <Switch on={wall.locks.position} onChange={() => toggleWallLock(wall.id, 'position')} label="Lock position" />
      </div>
      <StatusPicker ids={[wall.id]} status={wall.status} />
      <div className="section">
        <div className="section-title">Actions</div>
        <div className="actions-grid">
          <button className="btn sm" onClick={() => splitWall(wall.id)}>
            <Icon name="split" size={14} /> Split
          </button>
          <button className="btn sm" onClick={() => reverseWallDirection(wall.id)}>
            <Icon name="flip" size={14} /> Reverse
          </button>
          <button className="btn sm" onClick={duplicateSelection}>
            <Icon name="copy" size={14} /> Duplicate
          </button>
          <button className="btn sm" onClick={() => convertWallType(wall.id, wall.wallType === 'exterior' ? 'interior' : 'exterior')}>
            <Icon name="wall" size={14} /> {wall.wallType === 'exterior' ? 'To interior' : 'To exterior'}
          </button>
          {selectedWalls.length === 2 && (
            <button className="btn sm" onClick={mergeSelectedWalls}>
              Merge
            </button>
          )}
          <button className="btn sm danger" onClick={() => deleteSelection([wall.id])}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Opening ───────────────────────────────────────────────────────────────

function OpeningInspector({ o, floor }: { o: Opening; floor: Floor }) {
  const units = useUnits();
  const w = floor.walls[o.wallId];
  const L = Math.hypot(floor.nodes[w.b].x - floor.nodes[w.a].x, floor.nodes[w.b].y - floor.nodes[w.a].y);
  const title = o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Opening';
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <Head icon={o.type === 'door' ? 'door' : o.type === 'window' ? 'window' : 'opening'} title={title} sub={`${formatLength(o.width, units)} × ${formatLength(o.height, units)} · on a ${formatLength(L, units)} wall`} />
      <div className="section">
        <div className="section-title">Size</div>
        <div className="grid2">
          <div className="field">
            <label>Width</label>
            <LengthInput value={o.width} min={100} focusKey="opening-width" onCommit={(v) => updateOpening(o.id, { width: v }, 'Change width')} />
          </div>
          <div className="field">
            <label>Height</label>
            <LengthInput value={o.height} min={100} onCommit={(v) => updateOpening(o.id, { height: v }, 'Change height')} />
          </div>
          <div className="field">
            <label>{o.type === 'window' ? 'Sill height' : 'Threshold'}</label>
            <LengthInput value={o.sill} onCommit={(v) => updateOpening(o.id, { sill: v }, 'Change sill height')} />
          </div>
          <div className="field">
            <label>Head height</label>
            <LengthInput value={o.sill + o.height} onCommit={(v) => updateOpening(o.id, { height: Math.max(100, v - o.sill) }, 'Change head height')} />
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Position on wall</div>
        <div className="grid2">
          <div className="field">
            <label>From wall start</label>
            <LengthInput value={o.offset} onCommit={(v) => updateOpening(o.id, { offset: v }, 'Move opening')} />
          </div>
          <div className="field">
            <label>From wall end</label>
            <LengthInput value={L - o.offset - o.width} onCommit={(v) => updateOpening(o.id, { offset: L - o.width - v }, 'Move opening')} />
          </div>
        </div>
        <button className="btn sm outline" onClick={() => updateOpening(o.id, { offset: (L - o.width) / 2 }, 'Center opening')}>
          Center on wall
        </button>
      </div>
      {o.type === 'door' && o.door && (
        <div className="section">
          <div className="section-title">Door</div>
          <div className="field">
            <label>Style</label>
            <select className="input" value={o.door.style} onChange={(e) => updateOpening(o.id, { door: { ...o.door!, style: e.target.value as DoorStyle } }, 'Change door style')}>
              <option value="single">Single swing</option>
              <option value="double">Double (French)</option>
              <option value="sliding">Sliding</option>
              <option value="pocket">Pocket</option>
              <option value="bifold">Bifold</option>
            </select>
          </div>
          <div className="grid2">
            <button className="btn sm outline" onClick={() => flipDoor(o.id, 'hinge')}>
              <Icon name="flip" size={14} /> Flip hinge
            </button>
            <button className="btn sm outline" onClick={() => flipDoor(o.id, 'swing')}>
              <Icon name="rotate" size={14} /> Flip swing
            </button>
          </div>
          <div className="field">
            <label>Finish</label>
            <MaterialSelect value={o.materialId ?? 'mat-door-white'} category="door" onChange={(id) => updateOpening(o.id, { materialId: id }, 'Change door finish')} />
          </div>
        </div>
      )}
      {o.type === 'window' && o.window && (
        <div className="section">
          <div className="section-title">Window</div>
          <select className="input" value={o.window.style} onChange={(e) => updateOpening(o.id, { window: { style: e.target.value as WindowStyle } }, 'Change window style')}>
            <option value="double-hung">Double hung</option>
            <option value="single-hung">Single hung</option>
            <option value="casement">Casement</option>
            <option value="sliding">Sliding</option>
            <option value="fixed">Fixed</option>
            <option value="picture">Picture</option>
          </select>
        </div>
      )}
      <StatusPicker ids={[o.id]} status={o.status} />
      <div className="section">
        <button className="btn sm danger" onClick={() => deleteSelection([o.id])}>
          <Icon name="trash" size={14} /> Delete {title.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

// ── Item ──────────────────────────────────────────────────────────────────

const SIDE_LABEL = { back: 'Back', front: 'Front', left: 'Left side', right: 'Right side' } as const;

function ItemInspector({ item, floor }: { item: Item; floor: Floor }) {
  const units = useUnits();
  const entry = CATALOG_BY_ID[item.catalogId];
  const dists = useMemo(() => distancesToWalls(item, derivePlan(floor, 'proposed').geometry, 20000), [item, floor]);
  const matCats: MaterialCategory[] = item.category === 'counter' ? ['counter', 'cabinet'] : item.category === 'cabinet' ? ['cabinet', 'counter'] : ['fabric', 'cabinet', 'generic', 'counter', 'floor'];
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <Head icon={item.category === 'bed' ? 'bed' : item.category === 'bath' ? 'bath' : item.category === 'counter' || item.category === 'cabinet' ? 'kitchen' : 'sofa'} title={item.name ?? entry?.name ?? 'Item'} sub={`${CATEGORY_LABELS[item.category]} · ${formatLength(item.width, units)} × ${formatLength(item.depth, units)}`} />
      <div className="section">
        <div className="field">
          <label>Name</label>
          <TextInput value={item.name ?? ''} onCommit={(v) => updateItem(item.id, { name: v }, 'Rename item')} />
        </div>
        <div className="grid3">
          <div className="field">
            <label>Width</label>
            <LengthInput value={item.width} min={10} focusKey="item-width" onCommit={(v) => updateItem(item.id, { width: v }, 'Resize item')} />
          </div>
          <div className="field">
            <label>Depth</label>
            <LengthInput value={item.depth} min={10} onCommit={(v) => updateItem(item.id, { depth: v }, 'Resize item')} />
          </div>
          <div className="field">
            <label>Height</label>
            <LengthInput value={item.height} min={1} onCommit={(v) => updateItem(item.id, { height: v }, 'Resize item')} />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Rotation</label>
            <AngleInput value={item.rotation} onCommit={(d) => updateItem(item.id, { rotation: ((d % 360) + 360) % 360 }, 'Rotate item')} />
          </div>
          <div className="field">
            <label>Off the floor</label>
            <LengthInput value={item.elevation} onCommit={(v) => updateItem(item.id, { elevation: v }, 'Change elevation')} />
          </div>
        </div>
        <div className="row">
          <button className="btn sm outline" onClick={() => rotateItems([item.id], -90)}>
            ⟲ 90°
          </button>
          <button className="btn sm outline" onClick={() => rotateItems([item.id], 90)}>
            ⟳ 90°
          </button>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Distance to walls</div>
        {dists.length === 0 && <span className="muted">No walls in line with this item.</span>}
        <div className="grid2">
          {dists.map((d) => (
            <div className="field" key={d.side}>
              <label>
                {SIDE_LABEL[d.side]}
                {d.compass !== 'angled' ? ` (${d.compass})` : ''}
              </label>
              <LengthInput value={d.distance} focusKey={d.side === 'back' ? 'item-distance' : undefined} onCommit={(v) => setItemDistance(item.id, d.side, v)} />
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-title">Position</div>
        <div className="grid2">
          <div className="field">
            <label>Center X</label>
            <LengthInput value={item.x} allowNegative onCommit={(v) => updateItem(item.id, { x: v }, 'Move item')} />
          </div>
          <div className="field">
            <label>Center Y</label>
            <LengthInput value={item.y} allowNegative onCommit={(v) => updateItem(item.id, { y: v }, 'Move item')} />
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Finish</div>
        <MaterialSelect value={item.materialId} category={matCats} onChange={(id) => updateItem(item.id, { materialId: id }, 'Change finish')} />
      </div>
      <StatusPicker ids={[item.id]} status={item.status} />
      <div className="section">
        <div className="actions-grid">
          <button className="btn sm" onClick={duplicateSelection}>
            <Icon name="copy" size={14} /> Duplicate
          </button>
          <button className="btn sm" onClick={() => setFlag([item.id], 'locked', !item.locked)}>
            <Icon name={item.locked ? 'unlock' : 'lock'} size={14} /> {item.locked ? 'Unlock' : 'Lock'}
          </button>
          <button className="btn sm" onClick={() => setFlag([item.id], 'hidden', true)}>
            <Icon name="eyeOff" size={14} /> Hide
          </button>
          <button className="btn sm danger" onClick={() => deleteSelection([item.id])}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Room / note / dimension ──────────────────────────────────────────────

function RoomInspector({ id, floor }: { id: Id; floor: Floor }) {
  const units = useUnits();
  const room = floor.rooms[id];
  const view = useUi((s) => s.renovationView);
  const detected = derivePlan(floor, view).rooms.find((r) => r.room.id === id);
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <Head icon="room" title={room.name} sub={detected ? `${formatArea(detected.area, units)} · perimeter ${formatLength(detected.perimeter, units)}` : undefined} />
      <div className="section">
        <div className="field">
          <label>Name</label>
          <TextInput value={room.name} focusKey="room-name" onCommit={(v) => updateRoom(id, { name: v }, 'Rename room')} />
        </div>
        <div className="field">
          <label>Floor finish</label>
          <MaterialSelect value={room.floorMaterialId} category="floor" focusKey="room-floor" onChange={(m) => updateRoom(id, { floorMaterialId: m }, 'Change floor finish')} />
        </div>
        <div className="field">
          <label>Ceiling height</label>
          <LengthInput value={room.ceilingHeight ?? floor.defaultWallHeight} onCommit={(v) => updateRoom(id, { ceilingHeight: v }, 'Change ceiling height')} />
        </div>
      </div>
      {detected && (
        <div className="section">
          <div className="section-title">Measurements</div>
          <div className="row between">
            <span className="muted">Finished floor area</span>
            <b className="tnum">{formatArea(detected.area, units)}</b>
          </div>
          <div className="row between">
            <span className="muted">Perimeter (interior)</span>
            <b className="tnum">{formatLength(detected.perimeter, units)}</b>
          </div>
          <div className="row between">
            <span className="muted">Walls</span>
            <b className="tnum">{detected.wallIds.length}</b>
          </div>
          <button className="btn sm outline" onClick={() => updateRoom(id, { labelOffset: { x: 0, y: 0 } }, 'Reset label')}>
            Re-center label
          </button>
        </div>
      )}
    </div>
  );
}

function NoteInspector({ id, floor }: { id: Id; floor: Floor }) {
  const n = floor.annotations[id];
  const patch = (p: Partial<typeof n>, label: string) =>
    editFloor(label, (f) => {
      const ed = new FloorEditor(f);
      ed.patchAnnotation(id, p);
      return ed.floor;
    });
  return (
    <div>
      <Head icon="text" title="Note" />
      <div className="section">
        <div className="field">
          <label>Text</label>
          <TextInput value={n.text} focusKey="note-text" onCommit={(v) => patch({ text: v }, 'Edit note')} />
        </div>
        <div className="field">
          <label>Size</label>
          <select className="input" value={n.fontSize} onChange={(e) => patch({ fontSize: Number(e.target.value) }, 'Change note size')}>
            {[11, 13, 16, 20, 26].map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </div>
        <button className="btn sm danger" onClick={() => deleteSelection([id])}>
          <Icon name="trash" size={14} /> Delete note
        </button>
      </div>
    </div>
  );
}

function DimInspector({ id, floor }: { id: Id; floor: Floor }) {
  const units = useUnits();
  const d = floor.dimensions[id];
  return (
    <div>
      <Head icon="ruler" title="Dimension" sub={formatLength(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y), units)} />
      <div className="section">
        <span className="muted">Manual dimensions are annotations. To change geometry, edit the wall or item it measures.</span>
        <button className="btn sm danger" onClick={() => deleteSelection([id])}>
          <Icon name="trash" size={14} /> Delete dimension
        </button>
      </div>
    </div>
  );
}

function MultiInspector({ ids, floor }: { ids: Id[]; floor: Floor }) {
  const walls = ids.filter((id) => floor.walls[id]);
  const items = ids.filter((id) => floor.items[id]);
  const units = useUnits();
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <Head icon="layers" title={`${ids.length} selected`} sub={[walls.length && `${walls.length} walls`, items.length && `${items.length} items`].filter(Boolean).join(' · ')} />
      {walls.length > 0 && (
        <div className="section">
          <div className="section-title">Walls</div>
          <div className="grid2">
            <div className="field">
              <label>Thickness</label>
              <LengthInput value={floor.walls[walls[0]].thickness} onCommit={(v) => updateWalls(walls, { thickness: v }, 'Change thickness')} />
            </div>
            <div className="field">
              <label>Height</label>
              <LengthInput value={floor.walls[walls[0]].height} onCommit={(v) => updateWalls(walls, { height: v }, 'Change height')} />
            </div>
          </div>
          <div className="muted">Total length {formatLength(walls.reduce((s, id) => s + Math.hypot(floor.nodes[floor.walls[id].b].x - floor.nodes[floor.walls[id].a].x, floor.nodes[floor.walls[id].b].y - floor.nodes[floor.walls[id].a].y), 0), units)}</div>
          {walls.length === 2 && (
            <button className="btn sm outline" onClick={mergeSelectedWalls}>
              Merge walls
            </button>
          )}
        </div>
      )}
      <div className="section">
        <div className="section-title">Renovation</div>
        <div className="status-pills">
          {(['existing', 'demolish', 'new'] as ElementStatus[]).map((s) => (
            <button key={s} data-s={s} onClick={() => setStatus(ids, s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="actions-grid">
          <button className="btn sm" onClick={duplicateSelection}>
            <Icon name="copy" size={14} /> Duplicate
          </button>
          <button className="btn sm" onClick={() => setFlag(ids, 'hidden', true)}>
            <Icon name="eyeOff" size={14} /> Hide
          </button>
          <button className="btn sm danger" onClick={() => deleteSelection(ids)}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function FloorInspector({ floor }: { floor: Floor }) {
  const units = useUnits();
  const settings = useDocument((s) => s.doc?.settings);
  const view = useUi((s) => s.renovationView);
  const rooms = derivePlan(floor, view).rooms;
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const setFloor = (patch: Partial<Floor>, label: string) =>
    editFloor(label, (f) => {
      const ed = new FloorEditor(f);
      ed.setFloorProps(patch);
      return ed.floor;
    });
  if (!settings) return null;
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <Head icon="plan" title={floor.name} sub={`${Object.keys(floor.walls).length} walls · ${rooms.length} rooms · ${formatArea(total, units)}`} />
      {rooms.length > 0 && (
        <div className="section">
          <div className="section-title">Rooms</div>
          {rooms
            .slice()
            .sort((a, b) => b.area - a.area)
            .map((r) => (
              <button key={r.room.id} className="row between" style={{ width: '100%', padding: '3px 0' }} onClick={() => select([r.room.id])}>
                <span>{r.room.name}</span>
                <span className="muted tnum">{formatArea(r.area, units)}</span>
              </button>
            ))}
        </div>
      )}
      <div className="section">
        <div className="section-title">New walls</div>
        <div className="grid2">
          <div className="field">
            <label>Default thickness</label>
            <LengthInput value={floor.defaultWallThickness} onCommit={(v) => setFloor({ defaultWallThickness: v }, 'Change default thickness')} />
          </div>
          <div className="field">
            <label>Default height</label>
            <LengthInput value={floor.defaultWallHeight} onCommit={(v) => setFloor({ defaultWallHeight: v }, 'Change default height')} />
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Units & dimensions</div>
        <div className="grid2">
          <div className="field">
            <label>Units</label>
            <select className="input" value={units.system} onChange={(e) => updateSettings({ units: { ...units, system: e.target.value as 'imperial' | 'metric' } }, 'Change units')}>
              <option value="imperial">Feet & inches</option>
              <option value="metric">Metric</option>
            </select>
          </div>
          {units.system === 'imperial' ? (
            <div className="field">
              <label>Precision</label>
              <select className="input" value={units.imperialPrecision} onChange={(e) => updateSettings({ units: { ...units, imperialPrecision: Number(e.target.value) as 1 | 2 | 4 | 8 | 16 } }, 'Change precision')}>
                <option value={1}>1"</option>
                <option value={2}>1/2"</option>
                <option value={4}>1/4"</option>
                <option value={8}>1/8"</option>
                <option value={16}>1/16"</option>
              </select>
            </div>
          ) : (
            <div className="field">
              <label>Show in</label>
              <select className="input" value={units.metricUnit} onChange={(e) => updateSettings({ units: { ...units, metricUnit: e.target.value as 'mm' | 'cm' | 'm' } }, 'Change metric unit')}>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </div>
          )}
        </div>
        <div className="field">
          <label>Wall dimensions measure</label>
          <select className="input" value={settings.dimensionReference} onChange={(e) => updateSettings({ dimensionReference: e.target.value as 'centerline' | 'interior' }, 'Change dimension reference')} data-testid="dimension-reference">
            <option value="centerline">Wall centerlines</option>
            <option value="interior">Inside rooms (finished wall to wall)</option>
          </select>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          Tape-measured rooms are usually wall-to-wall inside. Choose “Inside rooms” to see and edit those numbers directly.
        </p>
      </div>
      {floor.underlay && (
        <div className="section">
          <div className="section-title">Sketch underlay</div>
          <Switch on={floor.underlay.visible} onChange={(v) => setFloor({ underlay: { ...floor.underlay!, visible: v } }, 'Toggle underlay')} label="Show sketch under plan" />
          <div className="field">
            <label>Opacity</label>
            <input type="range" min={0.05} max={1} step={0.05} value={floor.underlay.opacity} onChange={(e) => setFloor({ underlay: { ...floor.underlay!, opacity: Number(e.target.value) } }, 'Underlay opacity')} />
          </div>
          <div className="grid2">
            <div className="field">
              <label>Rotation</label>
              <AngleInput value={floor.underlay.rotation} onCommit={(d) => setFloor({ underlay: { ...floor.underlay!, rotation: d } }, 'Rotate underlay')} />
            </div>
            <div className="field">
              <label>Scale (mm/px)</label>
              <input className="input" type="number" step="0.1" value={+floor.underlay.scale.toFixed(3)} onChange={(e) => setFloor({ underlay: { ...floor.underlay!, scale: Math.max(0.01, Number(e.target.value)) } }, 'Scale underlay')} />
            </div>
            <div className="field">
              <label>Offset X</label>
              <LengthInput value={floor.underlay.x} allowNegative onCommit={(v) => setFloor({ underlay: { ...floor.underlay!, x: v } }, 'Move underlay')} />
            </div>
            <div className="field">
              <label>Offset Y</label>
              <LengthInput value={floor.underlay.y} allowNegative onCommit={(v) => setFloor({ underlay: { ...floor.underlay!, y: v } }, 'Move underlay')} />
            </div>
          </div>
          <button className="btn sm danger" onClick={() => setFloor({ underlay: undefined }, 'Remove underlay')}>
            Remove underlay
          </button>
        </div>
      )}
    </div>
  );
}
