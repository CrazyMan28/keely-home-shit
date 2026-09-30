import * as THREE from 'three';
import type { Material, MaterialPattern } from '../../model/types';

/**
 * Converts document materials into Three.js materials. Patterns are drawn
 * procedurally onto canvases (no asset downloads), cached per material and
 * repeated in world space (1 texture repeat = `patternScale` mm).
 */
const textureCache = new Map<string, THREE.Texture>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function drawPattern(pattern: MaterialPattern, color: string): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = rand(pattern.length * 997 + color.charCodeAt(1));
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  switch (pattern) {
    case 'wood': {
      const planks = 4;
      const ph = size / planks;
      for (let i = 0; i < planks; i++) {
        g.fillStyle = shade(color, (r() - 0.5) * 0.08);
        g.fillRect(0, i * ph, size, ph);
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = shade(color, -0.04 - r() * 0.06);
          g.globalAlpha = 0.35;
          g.lineWidth = 0.6 + r();
          g.beginPath();
          const y = i * ph + r() * ph;
          g.moveTo(0, y);
          for (let x = 0; x <= size; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = shade(color, -0.18);
        g.fillRect(0, i * ph, size, 1.5);
        const joint = r() * size;
        g.fillRect(joint, i * ph, 1.5, ph);
      }
      break;
    }
    case 'tile': {
      const n = 2;
      const t = size / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = shade(color, (r() - 0.5) * 0.04);
          g.fillRect(i * t, j * t, t, t);
        }
      g.fillStyle = shade(color, -0.12);
      for (let i = 0; i <= n; i++) {
        g.fillRect(i * t - 2, 0, 4, size);
        g.fillRect(0, i * t - 2, size, 4);
      }
      break;
    }
    case 'brick': {
      const rows = 8;
      const bh = size / rows;
      const bw = size / 2;
      for (let row = 0; row < rows; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < size + bw; x += bw) {
          g.fillStyle = shade(color, (r() - 0.5) * 0.12);
          g.fillRect(x + off + 2, row * bh + 2, bw - 4, bh - 4);
        }
      }
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#c9c1b6';
      g.fillRect(0, 0, size, size);
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'carpet':
    case 'concrete':
    case 'stone': {
      const n = pattern === 'carpet' ? 9000 : 3500;
      for (let i = 0; i < n; i++) {
        g.fillStyle = shade(color, (r() - 0.5) * (pattern === 'stone' ? 0.22 : 0.1));
        g.globalAlpha = pattern === 'carpet' ? 0.5 : 0.35;
        const s = pattern === 'stone' ? 1 + r() * 3 : 1;
        g.fillRect(r() * size, r() * size, s, s);
      }
      g.globalAlpha = 1;
      if (pattern === 'stone') {
        g.strokeStyle = shade(color, 0.1);
        g.globalAlpha = 0.25;
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.moveTo(r() * size, r() * size);
          g.bezierCurveTo(r() * size, r() * size, r() * size, r() * size, r() * size, r() * size);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      break;
    }
    default:
      break;
  }
  return c;
}

function textureFor(mat: Material): THREE.Texture | null {
  if (mat.pattern === 'none') return null;
  const key = `${mat.pattern}|${mat.color}`;
  let tex = textureCache.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(drawPattern(mat.pattern, mat.color));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textureCache.set(key, tex);
  }
  return tex;
}

/** Shared material for a document material. `uvScaleM` = size of UV unit in meters (1 for world-space UVs). */
export function materialFor(mat: Material | undefined, variant: 'normal' | 'demolish' | 'new' = 'normal'): THREE.MeshStandardMaterial {
  const m = mat ?? { id: 'fallback', name: '', category: 'generic', color: '#cccccc', roughness: 0.8, metalness: 0, pattern: 'none', patternScale: 300 };
  const key = `${m.id}|${m.color}|${m.pattern}|${m.patternScale}|${m.roughness}|${m.metalness}|${variant}`;
  let out = materialCache.get(key);
  if (out) return out;
  const tex = variant === 'normal' ? textureFor(m as Material) : null;
  let map: THREE.Texture | null = null;
  if (tex) {
    map = tex.clone();
    map.needsUpdate = true;
    const rep = 1000 / m.patternScale;
    map.repeat.set(rep, rep);
  }
  out = new THREE.MeshStandardMaterial({
    color: variant === 'demolish' ? '#ff5f57' : variant === 'new' ? new THREE.Color(m.color).lerp(new THREE.Color('#4fb3ff'), 0.45) : map ? '#ffffff' : m.color,
    map,
    roughness: m.roughness,
    metalness: m.metalness,
    transparent: variant === 'demolish' || m.category === 'glass' || (m.opacity ?? 1) < 1,
    opacity: variant === 'demolish' ? 0.32 : m.category === 'glass' ? 0.28 : (m.opacity ?? 1),
    depthWrite: variant !== 'demolish' && m.category !== 'glass',
    side: THREE.FrontSide,
  });
  materialCache.set(key, out);
  return out;
}

const highlightCache = new WeakMap<THREE.Material, { select: THREE.Material; hover: THREE.Material }>();

/** Selection / hover variants of a material (emissive accent tint). */
export function highlighted<T extends THREE.Material | THREE.Material[]>(base: T, kind: 'select' | 'hover'): T {
  if (Array.isArray(base)) return base.map((m) => highlightedOne(m, kind)) as T;
  return highlightedOne(base as THREE.Material, kind) as T;
}

function highlightedOne(base: THREE.Material, kind: 'select' | 'hover'): THREE.Material {
  let h = highlightCache.get(base);
  if (!h) {
    const mk = (intensity: number) => {
      const c = (base as THREE.MeshStandardMaterial).clone();
      c.emissive = new THREE.Color('#8b7bff');
      c.emissiveIntensity = intensity;
      return c;
    };
    h = { select: mk(0.55), hover: mk(0.22) };
    highlightCache.set(base, h);
  }
  return h[kind];
}

export const simpleMaterial = (() => {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  return (color: string, roughness = 0.6, metalness = 0, opacity = 1) => {
    const key = `${color}|${roughness}|${metalness}|${opacity}`;
    let m = cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
      cache.set(key, m);
    }
    return m;
  };
})();
