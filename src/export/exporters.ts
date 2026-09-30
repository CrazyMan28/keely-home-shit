import { CATALOG_BY_ID } from '../assets/catalog';
import { derivePlan } from '../geometry/derive';
import { itemFootprint } from '../geometry/items/items';
import { formatArea, formatLength } from '../geometry/measurement/format';
import { bounds } from '../geometry/primitives/polygon';
import { add, scale, type Vec2 } from '../geometry/primitives/vec';
import { openingRect, wallSpans } from '../geometry/walls/wallPieces';
import { isVisibleInView, STATUS_LABEL, type RenovationView } from '../model/renovation';
import type { Floor, ProjectDoc } from '../model/types';

/**
 * Exporters work from the canonical model only (never from UI state), so
 * every format shows exactly the same geometry.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Vector floor plan at 1 px = 10 mm (scalable). */
export function exportSvg(doc: ProjectDoc, floor: Floor, view: RenovationView): string {
  const d = derivePlan(floor, view);
  const units = doc.settings.units;
  const pts: Vec2[] = [];
  for (const fp of d.geometry.footprints.values()) pts.push(...fp.polygon);
  const b = pts.length ? bounds(pts) : { minX: 0, minY: 0, maxX: 5000, maxY: 5000 };
  const pad = 1200;
  const k = 0.1;
  const X = (x: number) => ((x - b.minX + pad) * k).toFixed(2);
  const Y = (y: number) => ((y - b.minY + pad) * k).toFixed(2);
  const P = (poly: Vec2[]) => poly.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
  const W = (b.maxX - b.minX + pad * 2) * k;
  const H = (b.maxY - b.minY + pad * 2) * k;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="-apple-system, Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  for (const r of d.rooms) out.push(`<polygon points="${P(r.interiorPolygon)}" fill="#f6f5fb"/>`);
  for (const it of Object.values(floor.items)) {
    if (it.hidden || !isVisibleInView(it.status, view)) continue;
    out.push(`<polygon points="${P(itemFootprint(it))}" fill="#fafafa" stroke="#8a8d94" stroke-width="0.6"/>`);
    const c = { x: it.x, y: it.y };
    out.push(`<text x="${X(c.x)}" y="${Y(c.y)}" font-size="7" fill="#6b6f78" text-anchor="middle" dominant-baseline="middle">${esc(it.name ?? CATALOG_BY_ID[it.catalogId]?.name ?? '')}</text>`);
  }
  const byWall = new Map<string, typeof floor.openings[string][]>();
  for (const o of Object.values(floor.openings)) if (!o.hidden && isVisibleInView(o.status, view)) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  for (const fp of d.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    const fill = w.status === 'new' && view !== 'existing' ? '#1a8cff' : w.status === 'demolish' && view !== 'existing' ? 'none' : '#26282e';
    const stroke = w.status === 'demolish' && view !== 'existing' ? ' stroke="#e5443b" stroke-dasharray="4 3" stroke-width="1"' : '';
    for (const s of wallSpans(fp, byWall.get(w.id) ?? [])) if (!s.opening) out.push(`<polygon points="${P(s.polygon)}" fill="${fill}"${stroke}/>`);
    for (const o of byWall.get(w.id) ?? []) {
      const r = openingRect(fp, o, w.thickness);
      out.push(`<polyline points="${P([r[0], r[3]])}" stroke="#26282e" stroke-width="0.8" fill="none"/><polyline points="${P([r[1], r[2]])}" stroke="#26282e" stroke-width="0.8" fill="none"/>`);
      if (o.type === 'window') out.push(`<polyline points="${P([add(fp.a, scale(fp.dir, o.offset)), add(fp.a, scale(fp.dir, o.offset + o.width))])}" stroke="#1a8cff" stroke-width="1"/>`);
      if (o.type === 'door' && o.door && (o.door.style === 'single' || o.door.style === 'bifold')) {
        const side = o.door.swing === 'left' ? 1 : -1;
        const n = scale(fp.normal, side);
        const hingeT = o.door.hinge === 'start' ? o.offset : o.offset + o.width;
        const otherT = o.door.hinge === 'start' ? o.offset + o.width : o.offset;
        const hinge = add(add(fp.a, scale(fp.dir, hingeT)), scale(n, w.thickness / 2));
        const tip = add(hinge, scale(n, o.width));
        const closed = add(add(fp.a, scale(fp.dir, otherT)), scale(n, w.thickness / 2));
        const r = (o.width * k).toFixed(2);
        out.push(`<line x1="${X(hinge.x)}" y1="${Y(hinge.y)}" x2="${X(tip.x)}" y2="${Y(tip.y)}" stroke="#26282e" stroke-width="1"/>`);
        // Sweep clockwise on screen when rotating from the open leaf to the closed position is clockwise.
        const sweep = (tip.x - hinge.x) * (closed.y - hinge.y) - (tip.y - hinge.y) * (closed.x - hinge.x) > 0 ? 1 : 0;
        out.push(`<path d="M ${X(tip.x)} ${Y(tip.y)} A ${r} ${r} 0 0 ${sweep} ${X(closed.x)} ${Y(closed.y)}" fill="none" stroke="#8a8d94" stroke-width="0.6" stroke-dasharray="2 2"/>`);
      }
    }
    // Dimension
    const off = w.thickness / 2 + 350;
    const a2 = add(fp.a, scale(fp.normal, off));
    const b2 = add(fp.b, scale(fp.normal, off));
    const m = scale(add(a2, b2), 0.5);
    let ang = (Math.atan2(fp.dir.y, fp.dir.x) * 180) / Math.PI;
    if (ang > 90 || ang <= -90) ang += 180;
    if (fp.length > 600) {
      out.push(`<line x1="${X(a2.x)}" y1="${Y(a2.y)}" x2="${X(b2.x)}" y2="${Y(b2.y)}" stroke="#9a9ea6" stroke-width="0.5"/>`);
      out.push(`<text x="${X(m.x)}" y="${Y(m.y)}" font-size="8" fill="#26282e" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang.toFixed(2)} ${X(m.x)} ${Y(m.y)})" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(formatLength(fp.length, units))}</text>`);
    }
  }
  for (const r of d.rooms) {
    const p = add(r.labelPoint, r.room.labelOffset);
    out.push(`<text x="${X(p.x)}" y="${Y(p.y)}" font-size="11" font-weight="600" fill="#1b1c20" text-anchor="middle">${esc(r.room.name)}</text>`);
    out.push(`<text x="${X(p.x)}" y="${(Number(Y(p.y)) + 12).toFixed(2)}" font-size="8.5" fill="#6b6f78" text-anchor="middle">${esc(formatArea(r.area, units))}</text>`);
  }
  out.push(`<text x="10" y="${(H - 10).toFixed(1)}" font-size="9" fill="#8a8d94">${esc(doc.name)} · ${esc(floor.name)} · ${new Date().toLocaleDateString()}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

/** Opens a print-ready page (Save as PDF from the print dialog). */
export function printPlan(doc: ProjectDoc, floor: Floor, view: RenovationView): void {
  const svg = exportSvg(doc, floor, view);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.name)} – floor plan</title><style>@page{size:landscape;margin:12mm}html,body{margin:0;height:100%}svg{width:100%;height:100%}</style></head><body>${svg}<script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

/** Human-readable measurement report (HTML, printable). */
export function measurementReport(doc: ProjectDoc, floor: Floor): string {
  const units = doc.settings.units;
  const d = derivePlan(floor, 'proposed');
  const fl = (n: number) => esc(formatLength(n, units));
  const rows = (cells: string[][]) => cells.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('');
  const walls = Object.values(floor.walls).map((w, i) => {
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    return [`W${i + 1}`, fl(Math.hypot(b.x - a.x, b.y - a.y)), fl(w.thickness), fl(w.height), w.wallType, STATUS_LABEL[w.status], w.locks.length ? 'locked' : ''];
  });
  const obs = Object.values(doc.observations);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.name)} – measurement report</title>
<style>body{font:13px -apple-system,Helvetica,Arial,sans-serif;color:#1b1c20;margin:32px;max-width:900px}h1{font-size:22px}h2{font-size:15px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e3e4e8;padding:6px 8px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#6b6f78}.muted{color:#6b6f78}</style></head><body>
<h1>${esc(doc.name)}</h1><p class="muted">${esc(floor.name)} · generated ${new Date().toLocaleString()} · lengths are wall centerlines unless noted; room areas are finished interior.</p>
<h2>Rooms</h2><table><tr><th>Room</th><th>Area</th><th>Perimeter</th><th>Floor</th></tr>${rows(d.rooms.map((r) => [esc(r.room.name), esc(formatArea(r.area, units)), fl(r.perimeter), esc(doc.materials[r.room.floorMaterialId]?.name ?? '')]))}</table>
<h2>Walls</h2><table><tr><th>#</th><th>Length</th><th>Thickness</th><th>Height</th><th>Type</th><th>Status</th><th></th></tr>${rows(walls)}</table>
<h2>Doors & windows</h2><table><tr><th>Type</th><th>Width</th><th>Height</th><th>Sill</th><th>Status</th></tr>${rows(Object.values(floor.openings).map((o) => [o.type, fl(o.width), fl(o.height), fl(o.sill), STATUS_LABEL[o.status]]))}</table>
<h2>Furniture & fixtures</h2><table><tr><th>Item</th><th>W × D × H</th><th>Status</th></tr>${rows(Object.values(floor.items).map((it) => [esc(it.name ?? ''), `${fl(it.width)} × ${fl(it.depth)} × ${fl(it.height)}`, STATUS_LABEL[it.status]]))}</table>
${obs.length ? `<h2>Imported measurements</h2><table><tr><th>Reading</th><th>Value</th><th>Type</th><th>Confidence</th><th>Status</th></tr>${rows(obs.map((o) => [esc(o.originalText), o.valueMm !== undefined ? fl(o.valueMm) : '—', o.type, `${Math.round(o.confidence * 100)}%`, o.approximate ? 'approximate' : o.status]))}</table>` : ''}
</body></html>`;
}

/** Binary glTF of the whole floor, built straight from the model. */
export async function exportGlb(doc: ProjectDoc, floor: Floor, view: RenovationView): Promise<Blob> {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const B = await import('../editor/3d/builders');
  const { materialFor } = await import('../editor/3d/materials3d');
  const d = derivePlan(floor, view);
  const root = new THREE.Group();
  root.name = doc.name;
  const byWall = new Map<string, typeof floor.openings[string][]>();
  for (const o of Object.values(floor.openings)) if (!o.hidden && isVisibleInView(o.status, view)) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  for (const fp of d.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    root.add(B.buildWall(w, fp, byWall.get(w.id) ?? [], doc.materials, 'normal'));
    for (const o of byWall.get(w.id) ?? []) root.add(B.buildOpening(o, fp, w.thickness, doc.materials, 'normal'));
  }
  for (const r of d.rooms) root.add(B.buildFloor(r.interiorPolygon, materialFor(doc.materials[r.room.floorMaterialId]), r.room.id));
  for (const it of Object.values(floor.items)) {
    if (it.hidden || !isVisibleInView(it.status, view)) continue;
    const g = B.buildItem(it, doc.materials, 'normal');
    B.placeItem(g, it);
    root.add(g);
  }
  const result = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}
