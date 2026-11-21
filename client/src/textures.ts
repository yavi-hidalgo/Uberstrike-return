// Texturas PBR generadas por código: color, relieve (normal map) y rugosidad.
// Todas son "tileables" (se repiten sin costuras).
import * as THREE from "three";

const SIZE = 512;

// ---------- Ruido periódico (para que la textura se repita sin costuras) ----------
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function valueNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period, y = v * period;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (n: number) => ((n % period) + period) % period;
  const a = hash2(w(x0), w(y0), seed), b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed), d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, period = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(u, v, period, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Ruido de Voronoi periódico: devuelve [distancia al borde, id de celda]. */
function voronoi(u: number, v: number, period: number, seed: number): [number, number] {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 99);
      const d = Math.hypot(px - x, py - y);
      if (d < d1) { d2 = d1; d1 = d; id = hash2(wx, wy, seed + 7); } else if (d < d2) d2 = d;
    }
  }
  return [d2 - d1, id];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

interface Layers {
  color: Float32Array; // rgb 0..1
  height: Float32Array; // 0..1
  rough: Float32Array; // 0..1
}

function makeLayers(fn: (u: number, v: number, out: { r: number; g: number; b: number; h: number; ro: number }) => void): Layers {
  const n = SIZE * SIZE;
  const color = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const o = { r: 0, g: 0, b: 0, h: 0, ro: 0 };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      fn(x / SIZE, y / SIZE, o);
      const i = y * SIZE + x;
      color[i * 3] = o.r; color[i * 3 + 1] = o.g; color[i * 3 + 2] = o.b;
      height[i] = o.h; rough[i] = o.ro;
    }
  }
  return { color, height, rough };
}

function toCanvasTexture(fill: (data: Uint8ClampedArray) => void, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

function bake(l: Layers, normalStrength: number): PBRSet {
  const map = toCanvasTexture((d) => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      d[i * 4] = clamp01(l.color[i * 3]) * 255;
      d[i * 4 + 1] = clamp01(l.color[i * 3 + 1]) * 255;
      d[i * 4 + 2] = clamp01(l.color[i * 3 + 2]) * 255;
      d[i * 4 + 3] = 255;
    }
  }, true);
  const normalMap = toCanvasTexture((d) => {
    const h = l.height;
    const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * SIZE + x) * 4;
        d[i] = (-dx / len * 0.5 + 0.5) * 255;
        d[i + 1] = (dy / len * 0.5 + 0.5) * 255;
        d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
  }, false);
  const roughnessMap = toCanvasTexture((d) => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = clamp01(l.rough[i]) * 255;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  }, false);
  return { map, normalMap, roughnessMap };
}

// ---------- Materiales ----------

/** Hormigón con juntas de encofrado, poros y manchas de escurrimiento. */
function concrete(): PBRSet {
  return bake(makeLayers((u, v, o) => {
    const n = fbm(u, v, 8, 5, 1);
    const fine = valueNoise(u, v, 128, 2);
    const pores = valueNoise(u, v, 96, 3) > 0.86 ? 1 : 0;
    const seamY = Math.min(Math.abs(v * 4 - Math.round(v * 4)), 1) < 0.012 ? 1 : 0;
    const seamX = Math.min(Math.abs(u * 2 - Math.round(u * 2)), 1) < 0.006 ? 1 : 0;
    const streak = Math.pow(valueNoise(u, v * 0.15, 24, 4), 3) * (0.6 + 0.4 * fbm(u, v, 4, 3, 5));
    let g = 0.5 + (n - 0.5) * 0.18 + (fine - 0.5) * 0.05 - streak * 0.16;
    g -= (seamX || seamY ? 0.12 : 0) + pores * 0.12;
    o.r = g * 0.97; o.g = g * 0.98; o.b = g * 1.03;
    o.h = 0.5 + (n - 0.5) * 0.3 + (fine - 0.5) * 0.12 - pores * 0.35 - (seamX || seamY ? 0.4 : 0);
    o.ro = 0.86 - streak * 0.1;
  }), 2.4);
}

/** Roca de montaña: capas, grietas y vetas claras. */
function rock(): PBRSet {
  return bake(makeLayers((u, v, o) => {
    const n = fbm(u, v, 4, 6, 11);
    const ridged = 1 - Math.abs(fbm(u, v * 1.5, 6, 4, 12) * 2 - 1);
    const [edge] = voronoi(u, v, 6, 13);
    const crack = edge < 0.05 ? 1 - edge / 0.05 : 0;
    const strata = 0.5 + 0.5 * Math.sin((v + n * 0.25) * Math.PI * 18);
    let g = 0.3 + n * 0.22 + strata * 0.05 + Math.pow(ridged, 6) * 0.12 - crack * 0.18;
    o.r = g * 0.92; o.g = g * 0.96; o.b = g * 1.06;
    o.h = n * 0.7 + ridged * 0.3 - crack * 0.5;
    o.ro = 0.8 + (1 - n) * 0.12;
  }), 4.5);
}

/** Tablones de madera horizontales con veta y nudos. */
function wood(dark = false): PBRSet {
  const planks = 6;
  return bake(makeLayers((u, v, o) => {
    const row = Math.floor(v * planks);
    const local = v * planks - row;
    const offset = hash2(row, 0, 21);
    const grainU = (u + offset) % 1;
    const grain = fbm(grainU, local * 0.2 + row * 0.13, 3, 4, 22);
    const lines = 0.5 + 0.5 * Math.sin((local * 10 + grain * 8) * Math.PI);
    const knot = valueNoise(grainU, local, 6, 23 + row) > 0.93 ? 1 : 0;
    const seam = local < 0.03 || local > 0.97 ? 1 : 0;
    const tone = 0.85 + hash2(row, 1, 24) * 0.3;
    let r = (dark ? 0.24 : 0.36) * tone, g = (dark ? 0.16 : 0.25) * tone, b = (dark ? 0.1 : 0.16) * tone;
    const k = 0.75 + lines * 0.2 + (grain - 0.5) * 0.3 - knot * 0.35 - seam * 0.5;
    o.r = r * k; o.g = g * k; o.b = b * k;
    o.h = 0.5 + lines * 0.15 + (grain - 0.5) * 0.3 - seam * 0.6 - knot * 0.2;
    o.ro = 0.72 + seam * 0.2;
  }), 2.2);
}

/** Metal pintado por paneles con remaches, rayones y algo de óxido. */
function paintedMetal(base: [number, number, number], ribbed = false, rustAmount = 1): PBRSet {
  return bake(makeLayers((u, v, o) => {
    const pu = (u * 2) % 1, pv = (v * 2) % 1;
    const seam = Math.min(pu, 1 - pu, pv, 1 - pv) < 0.008 ? 1 : 0;
    const rivetU = Math.abs(pu - 0.04) < 0.012 || Math.abs(pu - 0.96) < 0.012;
    const rivetV = Math.abs(((pv * 8) % 1) - 0.5) < 0.1;
    const rivet = rivetU && rivetV ? 1 : 0;
    const ribs = ribbed ? 0.5 + 0.5 * Math.sin(u * Math.PI * 48) : 0.5;
    const scratch = valueNoise(u * 0.3, v * 6, 64, 31) > 0.9 ? 1 : 0;
    const dirt = fbm(u, v, 6, 4, 32);
    const rust = Math.pow(clamp01(fbm(u, v * 0.4, 8, 3, 33) * 1.6 - 0.75), 1.5) * 1.8 * rustAmount;
    const k = 0.9 + (dirt - 0.5) * 0.25 - seam * 0.35 + scratch * 0.15;
    o.r = mix(base[0] * k, 0.35, rust); o.g = mix(base[1] * k, 0.18, rust); o.b = mix(base[2] * k, 0.08, rust);
    o.h = 0.5 + (ribs - 0.5) * (ribbed ? 0.8 : 0) - seam * 0.5 + rivet * 0.5 + (dirt - 0.5) * 0.05;
    o.ro = 0.42 + dirt * 0.18 + rust * 0.3 - scratch * 0.15;
  }), ribbed ? 3.2 : 2.6);
}

/** Nieve compacta con brillos. */
function snow(): PBRSet {
  return bake(makeLayers((u, v, o) => {
    const n = fbm(u, v, 4, 5, 41);
    const fine = valueNoise(u, v, 160, 42);
    const sparkle = fine > 0.97 ? 1 : 0;
    const g = 0.86 + (n - 0.5) * 0.12;
    o.r = g * 0.95; o.g = g * 0.98; o.b = g * 1.04;
    o.h = n * 0.8 + fine * 0.2;
    o.ro = 0.65 - sparkle * 0.4;
  }), 1.4);
}

/** Losas de piedra irregulares con nieve en las juntas. */
function flagstone(): PBRSet {
  return bake(makeLayers((u, v, o) => {
    const [edge, id] = voronoi(u, v, 5, 51);
    const n = fbm(u, v, 8, 4, 52);
    const gap = edge < 0.06 ? 1 : 0;
    const tone = 0.32 + id * 0.12 + (n - 0.5) * 0.1;
    if (gap) {
      const s = 0.78 + n * 0.1;
      o.r = s * 0.95; o.g = s * 0.98; o.b = s * 1.03;
      o.h = 0.1; o.ro = 0.7;
    } else {
      o.r = tone * 0.95; o.g = tone * 0.97; o.b = tone * 1.02;
      o.h = 0.55 + Math.min(edge, 0.25) * 1.2 + (n - 0.5) * 0.2;
      o.ro = 0.78;
    }
  }), 3);
}

/** Caja de madera con marco reforzado. */
function crate(): PBRSet {
  return bake(makeLayers((u, v, o) => {
    const frame = u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9;
    const diag = Math.abs(u - v) < 0.06 && !frame;
    const plank = Math.floor(v * 5);
    const grain = fbm((u + hash2(plank, 0, 61)) % 1, v, 4, 4, 62);
    const lines = 0.5 + 0.5 * Math.sin((v * 5 * 6 + grain * 6) * Math.PI);
    const seam = !frame && Math.abs(v * 5 - Math.round(v * 5)) < 0.04 ? 1 : 0;
    const nail = frame && (Math.hypot(u - 0.05, v - 0.05) < 0.015 || Math.hypot(u - 0.95, v - 0.95) < 0.015 || Math.hypot(u - 0.05, v - 0.95) < 0.015 || Math.hypot(u - 0.95, v - 0.05) < 0.015);
    const k = (frame || diag ? 0.75 : 0.95) + (lines - 0.5) * 0.15 + (grain - 0.5) * 0.2 - seam * 0.4;
    o.r = 0.5 * k; o.g = 0.34 * k; o.b = 0.19 * k;
    if (nail) { o.r = o.g = o.b = 0.25; }
    o.h = (frame || diag ? 0.75 : 0.45) + (grain - 0.5) * 0.15 - seam * 0.4 + (nail ? 0.2 : 0);
    o.ro = nail ? 0.4 : 0.75;
  }), 2.5);
}

// ---------- Caché de materiales ----------
export type MaterialName =
  | "concrete" | "rock" | "wood" | "woodDark" | "metalWhite" | "metalOrange" | "metalBlue"
  | "metalDark" | "snow" | "flagstone" | "crate";

const cache = new Map<MaterialName, THREE.MeshStandardMaterial>();
import { ktx2Loader } from "./ktx";

const texCache = new Map<string, Promise<THREE.CompressedTexture>>();

/** Texturas fotográficas (Poly Haven, CC0): color, relieve y ARM (oclusión, rugosidad, metal). */
// Llegan comprimidas en KTX2 (ver ktx.ts). Se cargan de forma asíncrona y se asignan al material
// al llegar; `photoTexturesReady()` espera a todas (el mundo lo hace antes de compilar shaders).
const pendingPhotos: Promise<unknown>[] = [];
type PhotoSlot = "map" | "normalMap" | "aoMap" | "roughnessMap" | "metalnessMap";

function photo(file: string, kind: "diff" | "nor" | "arm", metersPerTile: number, mat: THREE.MeshStandardMaterial, slots: PhotoSlot[]) {
  const key = `${file}_${kind}_${metersPerTile}`;
  let p = texCache.get(key);
  if (!p) {
    p = ktx2Loader.loadAsync(`${import.meta.env.BASE_URL}assets/textures/${file}_${kind}.ktx2`).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.setScalar(1 / metersPerTile);
      t.anisotropy = 8;
      t.colorSpace = kind === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    });
    texCache.set(key, p);
    pendingPhotos.push(p.catch((e) => console.warn(`Sin textura ${key}`, e)));
  }
  void p.then((t) => {
    for (const slot of slots) (mat as unknown as Record<PhotoSlot, THREE.Texture>)[slot] = t;
    mat.needsUpdate = true;
  }).catch(() => {});
}

/** Espera a que lleguen todas las texturas fotográficas pedidas hasta ahora. */
export async function photoTexturesReady() {
  for (;;) {
    const n = pendingPhotos.length;
    await Promise.all(pendingPhotos);
    if (pendingPhotos.length === n) return;
  }
}

export function photoMaterial(file: string, meters: number, opts: { tint?: number; metalness?: number; normal?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    roughness: 1,
    metalness: opts.metalness ?? 0,
    color: opts.tint ?? 0xffffff,
  });
  photo(file, "diff", meters, m, ["map"]);
  photo(file, "nor", meters, m, ["normalMap"]);
  photo(file, "arm", meters, m, opts.metalness ? ["aoMap", "roughnessMap", "metalnessMap"] : ["aoMap", "roughnessMap"]);
  const n = opts.normal ?? 1;
  m.normalScale.set(n, n);
  return m;
}

export function material(name: MaterialName): THREE.MeshStandardMaterial {
  const hit = cache.get(name);
  if (hit) return hit;
  let m: THREE.MeshStandardMaterial;
  switch (name) {
    case "concrete": m = photoMaterial("cracked_concrete_wall", 2.2); break;
    case "rock": m = photoMaterial("rock_face_03", 2.7, { normal: 1.3 }); break;
    case "wood": m = photoMaterial("wood_planks_dirt", 2); break;
    case "woodDark": m = photoMaterial("wood_planks_dirt", 2, { tint: 0x7a6a5c }); break;
    case "metalWhite": m = photoMaterial("metal_plate", 1.2, { tint: 0xffffff, metalness: 0.12 }); m.color.setScalar(1.6); break;
    case "metalOrange": m = photoMaterial("metal_plate", 1.2, { tint: 0xd97a3a, metalness: 0.5 }); break;
    case "metalBlue": m = photoMaterial("metal_plate", 1.2, { tint: 0x4f7fae, metalness: 0.5 }); break;
    case "metalDark": m = photoMaterial("metal_plate", 1.2, { tint: 0x5c6168, metalness: 0.8 }); break;
    case "snow": m = photoMaterial("snow_01", 3, { tint: 0xf4f7ff, normal: 0.8 }); break;
    case "flagstone": m = photoMaterial("stone_tiles_02", 2); break;
    case "crate": {
      const set = crate();
      m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1 });
      break;
    }
  }
  cache.set(name, m);
  return m;
}

/**
 * Proyecta UVs en coordenadas del mundo según la dirección de cada cara,
 * para que la textura tenga siempre el mismo tamaño real (sin estirarse).
 */
export function applyWorldUV(geo: THREE.BufferGeometry, _tile = 1, offset = new THREE.Vector3()) {
  const tile = 1; // UV en metros; cada textura define su tamaño real con `repeat`
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x, y = pos.getY(i) + offset.y, z = pos.getZ(i) + offset.z;
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = x; v = z; }
    else if (ax >= az) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Textura radial suave (brillos, fogonazos, polvo). */
export function softSprite(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fogonazo en forma de estrella. */
export function flashSprite(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.translate(64, 64);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3 + (i % 2) * 0.2);
    const g = ctx.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, "rgba(255,240,200,0.9)");
    g.addColorStop(1, "rgba(255,150,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(i % 2 ? 46 : 62, 0); ctx.lineTo(0, 6); ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
  g.addColorStop(0, "rgba(255,255,240,1)");
  g.addColorStop(1, "rgba(255,180,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-64, -64, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Agujero de bala con borde quemado. */
export function bulletHoleSprite(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, "rgba(5,5,5,1)");
  g.addColorStop(0.25, "rgba(15,14,12,0.95)");
  g.addColorStop(0.5, "rgba(40,36,30,0.45)");
  g.addColorStop(1, "rgba(40,36,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
