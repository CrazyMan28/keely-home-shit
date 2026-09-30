import type { ItemShape } from '../../assets/catalog';

/**
 * Top-view symbols for library objects, drawn in the item's local frame:
 * origin at the footprint center, +x along width, +y toward the front
 * (into the room); the back edge is y = -h/2. Units are screen pixels.
 */
export function drawSymbol(ctx: CanvasRenderingContext2D, shape: ItemShape, w: number, h: number, fill: string, stroke: string): void {
  const x0 = -w / 2;
  const y0 = -h / 2;
  const line = (ax: number, ay: number, bx: number, by: number) => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  const rrect = (x: number, y: number, rw: number, rh: number, r: number) => {
    const rr = Math.max(0, Math.min(r, rw / 2, rh / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + rw, y, x + rw, y + rh, rr);
    ctx.arcTo(x + rw, y + rh, x, y + rh, rr);
    ctx.arcTo(x, y + rh, x, y, rr);
    ctx.arcTo(x, y, x + rw, y, rr);
    ctx.closePath();
  };
  const body = (r = Math.min(w, h) * 0.06) => {
    rrect(x0, y0, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  ctx.strokeStyle = stroke;
  const u = Math.min(w, h);

  switch (shape) {
    case 'bed': {
      body(u * 0.03);
      const pillowH = h * 0.13;
      const gap = w * 0.05;
      const pw = (w - gap * 3) / 2;
      rrect(x0 + gap, y0 + h * 0.05, pw, pillowH, pillowH * 0.35);
      ctx.stroke();
      rrect(x0 + gap * 2 + pw, y0 + h * 0.05, pw, pillowH, pillowH * 0.35);
      ctx.stroke();
      line(x0, y0 + h * 0.3, x0 + w, y0 + h * 0.3);
      line(x0, y0 + h * 0.36, x0 + w, y0 + h * 0.36);
      break;
    }
    case 'sofa': {
      body(u * 0.12);
      const back = h * 0.25;
      const arm = Math.min(w * 0.12, h * 0.3);
      rrect(x0 + arm, y0 + back, w - arm * 2, h - back, u * 0.05);
      ctx.stroke();
      const seats = Math.max(1, Math.round((w - arm * 2) / Math.max(h * 0.9, 1)));
      for (let i = 1; i < seats; i++) {
        const x = x0 + arm + ((w - arm * 2) * i) / seats;
        line(x, y0 + back, x, y0 + h);
      }
      break;
    }
    case 'chair':
      body(u * 0.15);
      line(x0 + w * 0.1, y0 + h * 0.2, x0 + w * 0.9, y0 + h * 0.2);
      break;
    case 'table':
    case 'desk':
      body(u * 0.04);
      rrect(x0 + u * 0.08, y0 + u * 0.08, w - u * 0.16, h - u * 0.16, u * 0.02);
      ctx.save();
      ctx.globalAlpha *= 0.4;
      ctx.stroke();
      ctx.restore();
      break;
    case 'roundTable':
    case 'plant':
    case 'lamp': {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      if (shape === 'lamp') {
        line(-w * 0.3, 0, w * 0.3, 0);
        line(0, -h * 0.3, 0, h * 0.3);
      }
      if (shape === 'plant') {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          line(0, 0, Math.cos(a) * w * 0.42, Math.sin(a) * h * 0.42);
        }
      }
      break;
    }
    case 'shelf':
    case 'box':
      body(u * 0.04);
      line(x0 + u * 0.1, y0 + h - u * 0.12, x0 + w - u * 0.1, y0 + h - u * 0.12);
      break;
    case 'baseCabinet':
    case 'vanity':
    case 'counter':
      body(2);
      line(x0, y0 + h - Math.min(h * 0.08, 12), x0 + w, y0 + h - Math.min(h * 0.08, 12));
      if (shape === 'vanity') {
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.22, h * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'wallCabinet':
      ctx.save();
      ctx.setLineDash([5, 4]);
      body(2);
      ctx.restore();
      break;
    case 'tallCabinet':
    case 'column':
      body(2);
      line(x0, y0, x0 + w, y0 + h);
      line(x0 + w, y0, x0, y0 + h);
      break;
    case 'island':
      body(u * 0.04);
      rrect(x0 + 6, y0 + 6, w - 12, h - 12, u * 0.03);
      ctx.save();
      ctx.globalAlpha *= 0.4;
      ctx.stroke();
      ctx.restore();
      break;
    case 'fridge':
    case 'dishwasher':
    case 'washer': {
      body(3);
      if (shape === 'washer') {
        ctx.beginPath();
        ctx.arc(0, h * 0.05, u * 0.32, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        line(x0, y0 + h - Math.min(h * 0.1, 10), x0 + w, y0 + h - Math.min(h * 0.1, 10));
        label(ctx, shape === 'fridge' ? 'REF' : 'DW', u, stroke);
      }
      break;
    }
    case 'range': {
      body(3);
      const r = u * 0.16;
      for (const [cx, cy] of [
        [-w * 0.22, -h * 0.2],
        [w * 0.22, -h * 0.2],
        [-w * 0.22, h * 0.18],
        [w * 0.22, h * 0.18],
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'sink': {
      body(2);
      rrect(x0 + w * 0.15, y0 + h * 0.18, w * 0.7, h * 0.6, u * 0.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, y0 + h * 0.48, u * 0.04, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'toilet': {
      rrect(x0, y0, w, h * 0.28, u * 0.08);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, y0 + h * 0.62, w * 0.42, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'shower': {
      body(2);
      line(x0, y0, x0 + w, y0 + h);
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.05, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'bathtub': {
      body(u * 0.06);
      rrect(x0 + u * 0.1, y0 + u * 0.1, w - u * 0.2, h - u * 0.2, u * 0.3);
      ctx.stroke();
      break;
    }
    case 'rug': {
      ctx.save();
      ctx.globalAlpha *= 0.7;
      body(2);
      ctx.setLineDash([2, 3]);
      rrect(x0 + 5, y0 + 5, w - 10, h - 10, 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'tv':
      body(1);
      break;
    case 'stairs': {
      body(1);
      const treads = Math.max(2, Math.round(h / Math.max(w * 0.28, 6)));
      for (let i = 1; i < treads; i++) line(x0, y0 + (h * i) / treads, x0 + w, y0 + (h * i) / treads);
      line(0, y0 + h * 0.9, 0, y0 + h * 0.1);
      line(0, y0 + h * 0.1, -w * 0.12, y0 + h * 0.1 + w * 0.12);
      line(0, y0 + h * 0.1, w * 0.12, y0 + h * 0.1 + w * 0.12);
      break;
    }
    default:
      body();
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, size: number, color: string) {
  if (size < 26) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.min(11, size * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
