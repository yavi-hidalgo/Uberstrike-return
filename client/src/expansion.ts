// Dibuja las ampliaciones de los mapas (shared/src/layout.ts): fachadas de ladrillo armadas con el kit
// modular de Poly Haven, contenedores, autos, barreras, galpones, grúa, torres de luz y el hangar.
// Los objetos repetidos se dibujan con InstancedMesh (una llamada de dibujo por pieza distinta).
import * as THREE from "three";
import { ktx2Loader } from "./ktx";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Expansion, FacadeRun, Piece } from "../../shared/src/layout";
import { applyWorldUV, photoMaterial } from "./textures";

type Quality = "low" | "medium" | "high";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setKTX2Loader(ktx2Loader);
const kitCache = new Map<string, Promise<THREE.Object3D | null>>();

function kit(name: string, dir = "kit"): Promise<THREE.Object3D | null> {
  const key = `${dir}/${name}`;
  let p = kitCache.get(key);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}assets/${key}.glb`).then((g) => {
      g.scene.updateMatrixWorld(true);
      return g.scene;
    }).catch((e) => { console.warn(`Sin modelo ${key}`, e); return null; });
    kitCache.set(key, p);
  }
  return p;
}

/**
 * Junta instancias: cada malla de una plantilla se convierte en un InstancedMesh con todas las
 * ubicaciones donde aparece. La matriz de cada instancia = ubicación · matriz de la malla en la plantilla.
 */
class Instancer {
  private sets = new Map<string, { key: string; mesh: THREE.Mesh; local: THREE.Matrix4; mats: THREE.Matrix4[]; material: THREE.Material | THREE.Material[] }>();

  constructor(private shadows: boolean) {}

  add(template: THREE.Object3D, where: THREE.Matrix4, key: string, material?: (m: THREE.Material) => THREE.Material) {
    template.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const id = `${key}|${mesh.uuid}`;
      let set = this.sets.get(id);
      if (!set) {
        const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
        const mat = material ? (Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material)) : mesh.material;
        set = { key, mesh, local, mats: [], material: mat };
        this.sets.set(id, set);
      }
      set.mats.push(new THREE.Matrix4().multiplyMatrices(where, set.local));
    });
  }

  build(group: THREE.Group) {
    for (const s of this.sets.values()) {
      const im = new THREE.InstancedMesh(s.mesh.geometry, s.material, s.mats.length);
      im.name = s.key;
      s.mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      // Los objetos chicos no proyectan sombra: cada uno costaría otra llamada de dibujo en la
      // pasada de sombras y su sombra casi no se nota. Sí la reciben.
      im.castShadow = this.shadows && !SMALL.test(s.key);
      im.receiveShadow = this.shadows;
      im.computeBoundingSphere();
      group.add(im);
    }
  }
}

/**
 * Nivel de detalle de los contenedores (skill threejs-performance: "Drop detail with distance").
 * El modelo detallado (~5.300 triángulos, con bisagras y cerrojos) solo se dibuja cerca de la cámara;
 * a lo lejos cada contenedor es una caja con la textura de chapa de su mismo color (12 triángulos).
 * Cada color es un InstancedMesh detallado y otro simple; cada cuadro se reparten las instancias.
 */
class ContainerLOD {
  private items: { v: number; near: THREE.Matrix4; far: THREE.Matrix4; pos: THREE.Vector3 }[] = [];
  private sets: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh; items: number[] }[] = [];
  private lastCam = new THREE.Vector3(Infinity, 0, 0);
  /** Distancia (m) hasta la que se ve el modelo detallado. */
  static NEAR = 30;

  add(p: Piece, near: THREE.Matrix4) {
    const w = p.rot % 2 ? p.d : p.w, d = p.rot % 2 ? p.w : p.d;
    const far = new THREE.Matrix4().makeTranslation(p.x, p.y + p.h / 2, p.z).multiply(new THREE.Matrix4().makeScale(w, p.h, d));
    this.items.push({ v: p.v, near, far, pos: new THREE.Vector3(p.x, p.y + p.h / 2, p.z) });
  }

  build(tpl: THREE.Object3D | null, group: THREE.Group, shadows: boolean, tinted: (tint: number) => (m: THREE.Material) => THREE.Material) {
    if (!this.items.length) return;
    const byVariant = new Map<number, number[]>();
    this.items.forEach((it, i) => { const l = byVariant.get(it.v) ?? []; l.push(i); byVariant.set(it.v, l); });
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const [v, idx] of byVariant) {
      const tint = CONTAINER_TINTS[v % CONTAINER_TINTS.length];
      const near: THREE.InstancedMesh[] = [];
      if (tpl) {
        tpl.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(tpl.matrixWorld).invert();
        tpl.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const im = new THREE.InstancedMesh(m.geometry, (Array.isArray(m.material) ? m.material.map(tinted(tint)) : tinted(tint)(m.material)), idx.length);
          im.userData.local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
          im.castShadow = im.receiveShadow = shadows;
          im.name = `container${v}`;
          near.push(im); group.add(im);
        });
      }
      const mat = photoMaterial("corrugated_iron", 0.42, { tint, metalness: 0.5 });
      mat.color.multiplyScalar(1.15);
      const far = new THREE.InstancedMesh(box, mat, idx.length);
      far.castShadow = far.receiveShadow = shadows;
      far.name = `container${v}-lejos`;
      group.add(far);
      this.sets.push({ near, far, items: idx });
    }
    this.update(new THREE.Vector3(0, 0, 0), true);
  }

  private tmp = new THREE.Matrix4();
  update(cam: THREE.Vector3, force = false) {
    // solo se recalcula si la cámara se movió más de 1 m
    if (!force && cam.distanceToSquared(this.lastCam) < 1) return;
    this.lastCam.copy(cam);
    const n2 = ContainerLOD.NEAR * ContainerLOD.NEAR;
    for (const s of this.sets) {
      let nn = 0, nf = 0;
      for (const i of s.items) {
        const it = this.items[i];
        if (it.pos.distanceToSquared(cam) < n2) {
          for (const im of s.near) im.setMatrixAt(nn, this.tmp.multiplyMatrices(it.near, im.userData.local));
          nn++;
        } else s.far.setMatrixAt(nf++, it.far);
      }
      for (const im of s.near) { im.count = nn; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
      s.far.count = nf; s.far.instanceMatrix.needsUpdate = true; s.far.computeBoundingSphere();
    }
  }
}

/** Piezas que no proyectan sombra (ver Instancer.build). */
const SMALL = /^(crate|milcrate|plasticbin|drum|tyre|trash\d|seclight|aircon|tube|scicrate2?|shutter\d)$|^fac\|(window_|door_)/;

/** Matriz que encaja la caja de la plantilla dentro de la caja de la pieza. */
function fitMatrix(tplBox: THREE.Box3, p: Piece, opts: { uniform?: boolean; rotY?: number } = {}): THREE.Matrix4 {
  const size = tplBox.getSize(new THREE.Vector3());
  const rotY = opts.rotY ?? 0;
  // tamaño de la plantilla después del giro previo (solo múltiplos de 90°)
  const swap = Math.round(rotY / (Math.PI / 2)) % 2 !== 0;
  const sx = swap ? size.z : size.x, sz = swap ? size.x : size.z;
  let kx = p.w / sx, ky = p.h / size.y, kz = p.d / sz;
  if (opts.uniform) { const k = Math.min(kx, ky, kz); kx = ky = kz = k; }
  const c = tplBox.getCenter(new THREE.Vector3());
  const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationY(p.rot * Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(kx, ky, kz))
    .multiply(new THREE.Matrix4().makeRotationY(rotY))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -tplBox.min.y, -c.z));
  return m;
}

/**
 * Caja del cuerpo del contenedor. El modelo trae una hoja de la puerta abierta en el extremo +X,
 * que sobresale hacia +X y +Z: el alto y el ancho salen de la mitad trasera, y el largo llega
 * hasta la hoja cerrada (los vértices del lado -Z).
 */
function bodyBox(o: THREE.Object3D): THREE.Box3 {
  const full = new THREE.Box3().setFromObject(o);
  const midX = (full.min.x + full.max.x) / 2;
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push(v.clone());
      if (v.x < midX) b.expandByPoint(v);
    }
  });
  const midZ = (b.min.z + b.max.z) / 2;
  let maxX = b.max.x;
  for (const p of pts) if (p.z < midZ && p.z > b.min.z - 0.02) maxX = Math.max(maxX, p.x);
  b.max.x = maxX;
  return b;
}

/** Textura de franjas de peligro amarillas y negras. */
function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9a514"; g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#1b1b1b";
  for (let x = -64; x < 320; x += 64) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 32, 64); g.lineTo(x + 64, 0); g.lineTo(x + 32, 0); g.fill(); }
  // desgaste
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(90,80,70,${Math.random() * 0.35})`; g.fillRect(Math.random() * 256, Math.random() * 64, 2 + Math.random() * 6, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function boxMesh(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadows: boolean, worldUV = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  if (worldUV) applyWorldUV(g);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = shadows;
  return m;
}

// Tonos de los contenedores: rojo, azul, verde, naranja, gris, crema y dos grises oscuros (hangar)
const CONTAINER_TINTS = [0xb04a3a, 0x3a6a9c, 0x4f7a52, 0xc8783a, 0xa8a8a8, 0xd8d0bc, 0x8a929c, 0xa8b0b8];
const CAR_TINTS = [0xffffff, 0x8f9aa8, 0xb8a888, 0x6f7a6a];

export interface ExpansionVisuals {
  group: THREE.Group;
  /** Materiales que brillan (focos): se ajusta su intensidad según la hora. */
  glows: THREE.MeshStandardMaterial[];
  /** Campo de fuerza animado del hangar. */
  /** `cam`: posición de la cámara (para elegir el nivel de detalle de los contenedores). */
  update(time: number, cam?: THREE.Vector3): void;
}

export async function buildExpansion(e: Expansion, quality: Quality, opts: { indoor: boolean }): Promise<ExpansionVisuals> {
  const shadows = quality !== "low";
  const group = new THREE.Group();
  group.name = "expansion";
  const inst = new Instancer(shadows);
  const glows: THREE.MeshStandardMaterial[] = [];
  const updaters: ((t: number) => void)[] = [];
  const lod = new ContainerLOD();

  // ---------- Suelos ----------
  const asphalt = photoMaterial("asphalt_02", 5);
  const yard = photoMaterial("concrete_floor_worn_001", 4.5, { tint: 0x8c8780 });
  const hangarFloor = photoMaterial("concrete_floor_painted", 4, { tint: 0x9aa0a8 });
  for (const [x0, z0, x1, z1, kind] of e.grounds) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, -0.01, (z0 + z1) / 2);
    applyWorldUV(g);
    const m = new THREE.Mesh(g, kind === "asphalt" ? asphalt : kind === "yard" ? yard : hangarFloor);
    m.receiveShadow = shadows;
    group.add(m);
  }
  // Rejillas de desagüe sobre las uniones entre suelos distintos
  const grate = photoMaterial("metal_plate_02", 0.6, { tint: 0x3c4046, metalness: 0.7 });
  for (const [x0, z0, x1, z1] of e.seams) {
    const m = boxMesh(x1 - x0, 0.03, z1 - z0, grate, (x0 + x1) / 2, -0.005, (z0 + z1) / 2, false);
    m.receiveShadow = shadows;
    group.add(m);
  }
  if (!opts.indoor) buildSurroundings(e, group, shadows);

  // Líneas pintadas (algo transparentes: pintura gastada)
  const lineMats = [
    new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.85, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }),
    new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.8, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
  ];
  for (const [x0, z0, x1, z1, w, c] of e.lines) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(w, len);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, lineMats[c]);
    m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    m.receiveShadow = shadows;
    group.add(m);
  }

  // ---------- Materiales por código ----------
  const concreteWall = photoMaterial("concrete_wall_007", 3);
  const curbMat = photoMaterial("concrete_floor_worn_001", 2.2, { tint: 0xb0aca4 });
  const corrugated = [photoMaterial("corrugated_iron", 2.5, { tint: 0xb8c0c4, metalness: 0.6 }), photoMaterial("corrugated_iron", 2.5, { tint: 0x7f9fae, metalness: 0.6 })];
  const yellowPaint = photoMaterial("rusty_metal_02", 2, { tint: 0xe2ad2a, metalness: 0.35 });
  const galvanized = photoMaterial("metal_plate_02", 1.5, { tint: 0x9aa2a8, metalness: 0.7 });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 });
  const lampGlass = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffd9a0, emissiveIntensity: opts.indoor ? 3 : 1.4, roughness: 0.3 });
  glows.push(lampGlass);

  // ---------- Plantillas ----------
  const names = [
    "container", "covered_car", "concrete_road_barrier", "concrete_road_barrier_02", "wooden_crate_02", "wooden_military_crate",
    "old_tyre", "metal_trash_can", "rollershutter_door", "security_light", "industrial_pastic_container", "exterior_aircon_unit",
    "dropship", "scicrate", "scicrate2", "mounted_fluorescent_lights", "steel_frame_shelves_02", "propane_tank",
  ];
  const tpl = new Map<string, THREE.Object3D | null>();
  await Promise.all(names.map(async (n) => tpl.set(n, await kit(n))));
  const barrel = await kit("Barrel_01", "models");
  const bbox = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
  // Partes de un archivo con varias variantes (p. ej. basurero normal y oxidado)
  const subset = (o: THREE.Object3D | null | undefined, test: (name: string) => boolean): THREE.Object3D | null => {
    if (!o) return null;
    const g = new THREE.Group();
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && test(m.name || m.parent?.name || "")) {
        const k = m.clone();
        k.matrix.copy(m.matrixWorld); k.matrix.decompose(k.position, k.quaternion, k.scale);
        g.add(k);
      }
    });
    g.updateMatrixWorld(true);
    return g.children.length ? g : null;
  };
  const trashVariants = [subset(tpl.get("metal_trash_can"), (n) => !/rust/.test(n)), subset(tpl.get("metal_trash_can"), (n) => /rust/.test(n))];
  const tintCache = new Map<string, THREE.Material>();
  const tinted = (tint: number) => (m: THREE.Material) => {
    const key = `${m.uuid}|${tint}`;
    let c = tintCache.get(key);
    if (!c) { c = (m as THREE.MeshStandardMaterial).clone(); (c as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(tint)).multiplyScalar(1.5); tintCache.set(key, c); }
    return c;
  };

  let containerBody: THREE.Box3 | undefined;
  const placed = (p: Piece) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationY(p.rot * Math.PI / 2));

  for (const p of e.pieces) {
    switch (p.kind) {
      case "container": case "containerOpen": {
        const t = tpl.get("container");
        if (!t) { group.add(boxMesh(p.rot % 2 ? p.d : p.w, p.h, p.rot % 2 ? p.w : p.d, corrugated[0], p.x, p.y, p.z, shadows)); break; }
        // el modelo trae una hoja abierta en el extremo +X (queda en -Z de la pieza): se encaja solo el cuerpo
        const b = containerBody ??= bodyBox(t);
        lod.add(p, fitMatrix(b, p, { rotY: Math.PI / 2 }));
        break;
      }
      case "stepbox": {
        // pila de cajas militares: una por cada 0.52 m de alto
        const t = tpl.get("wooden_military_crate");
        if (!t) { group.add(boxMesh(p.w, p.h, p.d, corrugated[0], p.x, p.y, p.z, shadows)); break; }
        const n = Math.max(1, Math.round(p.h / 0.52));
        for (let i = 0; i < n; i++) {
          const layer: Piece = { ...p, y: p.y + i * (p.h / n), h: p.h / n, rot: (p.v + i) % 2 };
          inst.add(t, fitMatrix(bbox(t), layer), "stepbox");
        }
        break;
      }
      case "car": {
        const t = tpl.get("covered_car");
        if (t) inst.add(t, fitMatrix(bbox(t), p, { uniform: true }), `car${p.v}`, tinted(CAR_TINTS[p.v % CAR_TINTS.length]));
        break;
      }
      case "barrier": case "barrier2": {
        const t = tpl.get(p.kind === "barrier" ? "concrete_road_barrier" : "concrete_road_barrier_02");
        if (t) inst.add(t, fitMatrix(bbox(t), p), p.kind);
        break;
      }
      case "crate": {
        // dos cajas de madera lado a lado, en dos capas
        const t = tpl.get("wooden_crate_02");
        if (!t) break;
        const b = bbox(t), s = b.getSize(new THREE.Vector3());
        for (let layer = 0; layer < 2; layer++) for (const side of [-1, 1]) {
          const m = placed(p).multiply(new THREE.Matrix4().makeTranslation(0, layer * s.y, side * s.x / 2))
            .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2 + (layer ? 0.06 * side : 0)))
            .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2));
          inst.add(t, m, "crate");
        }
        break;
      }
      case "milcrate": {
        const t = tpl.get("wooden_military_crate");
        if (t) inst.add(t, fitMatrix(bbox(t), p), "milcrate");
        break;
      }
      case "pallet": {
        // tarima de madera con bidones plásticos encima
        const pal = boxMesh(1.2, 0.14, 1.2, photoMaterial("wood_planks_dirt", 1.5), 0, 0, 0, shadows);
        pal.applyMatrix4(placed(p));
        group.add(pal);
        const t = tpl.get("industrial_pastic_container");
        if (!t) break;
        const b = bbox(t), s = b.getSize(new THREE.Vector3());
        const layers = Math.max(1, Math.floor((p.h - 0.14) / s.y));
        for (let l = 0; l < layers; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          const m = placed(p).multiply(new THREE.Matrix4().makeTranslation(-0.4 + i * 0.4, 0.14 + l * s.y, -0.3 + j * 0.6))
            .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2));
          inst.add(t, m, "plasticbin");
        }
        break;
      }
      case "drums": {
        if (!barrel) break;
        const b = bbox(barrel), s = b.getSize(new THREE.Vector3());
        const k = Math.min(0.66 / Math.max(s.x, s.z), p.h / s.y);
        for (let i = 0; i < 4; i++) {
          if (p.v === 1 && i === 3) continue;
          const m = placed(p).multiply(new THREE.Matrix4().makeTranslation((i % 2 - 0.5) * 0.7, 0, (Math.floor(i / 2) - 0.5) * 0.7))
            .multiply(new THREE.Matrix4().makeRotationY(i * 1.3)).multiply(new THREE.Matrix4().makeScale(k, k, k))
            .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2));
          inst.add(barrel, m, "drum");
        }
        break;
      }
      case "tyres": {
        const t = tpl.get("old_tyre");
        if (!t) break;
        const b = bbox(t), s = b.getSize(new THREE.Vector3());
        for (const [ox, oz, n] of [[-0.3, -0.25, 4], [0.32, 0.28, 3]] as const) for (let i = 0; i < n; i++) {
          const m = placed(p).multiply(new THREE.Matrix4().makeTranslation(ox, i * s.z * 0.98, oz))
            .multiply(new THREE.Matrix4().makeRotationY(i * 0.9)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
            .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z));
          inst.add(t, m, "tyre");
        }
        break;
      }
      case "trash": {
        const t = trashVariants[p.v % 2] ?? trashVariants[0];
        if (t) inst.add(t, fitMatrix(bbox(t), p, { uniform: true }), `trash${p.v % 2}`);
        break;
      }
      case "shed": {
        // galpón de chapa: muros, techo con alero y portones enrollables en el frente (lado -z)
        const g = new THREE.Group();
        const mat = corrugated[p.v % 2];
        g.add(boxMesh(p.w, p.h, p.d, mat, 0, 0, 0, shadows));
        g.add(boxMesh(p.w + 0.8, 0.25, p.d + 0.8, galvanized, 0, p.h, 0, shadows));
        g.add(boxMesh(p.w + 0.02, 0.5, p.d + 0.02, concreteWall, 0, 0, 0, shadows));
        g.applyMatrix4(placed(p));
        group.add(g);
        const door = tpl.get("rollershutter_door");
        const light = tpl.get("security_light");
        const n = Math.max(1, Math.floor(p.w / 6));
        for (let i = 0; i < n; i++) {
          const dx = -p.w / 2 + (i + 0.5) * (p.w / n);
          if (door) {
            const nd = subset(door, (nm) => (i % 2 ? /graffiti/ : /^(?!.*graffiti)/).test(nm));
            if (nd) {
              const b = bbox(nd);
              const m = placed(p).multiply(new THREE.Matrix4().makeTranslation(dx, 0, -p.d / 2 - 0.02))
                .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
                .multiply(new THREE.Matrix4().makeScale(2.6, Math.min(1.4, (p.h - 1) / 2.4), 1))
                .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -b.min.z));
              inst.add(nd, m, `shutter${i % 2}`);
            }
          }
          if (light) {
            const m = placed(p).multiply(new THREE.Matrix4().makeTranslation(dx, Math.min(p.h - 0.6, 4.2), -p.d / 2))
              .multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeScale(1.4, 1.4, 1.4));
            inst.add(light, m, "seclight", (mt) => (/glass/i.test(mt.name) ? lampGlass : mt));
          }
        }
        // aire acondicionado en un costado
        const ac = tpl.get("exterior_aircon_unit");
        if (ac) {
          const sub = subset(ac, (nm) => /rusted/.test(nm));
          if (sub) {
            const b = bbox(sub);
            const m = placed(p).multiply(new THREE.Matrix4().makeTranslation(p.w / 2 + 0.2, 0.3, 0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
              .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -b.min.z));
            inst.add(sub, m, "aircon");
          }
        }
        break;
      }
      case "dock": {
        const g = new THREE.Group();
        g.add(boxMesh(p.w, p.h, p.d, concreteWall, 0, 0, 0, shadows));
        const edgeTex = hazardTexture();
        edgeTex.repeat.set(p.w / 1.2, 1);
        const edge = boxMesh(p.w, 0.12, 0.08, new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.7 }), 0, p.h - 0.12, -p.d / 2 - 0.04, false, false);
        g.add(edge);
        // topes de goma negros
        const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
        for (let x = -p.w / 2 + 2; x < p.w / 2 - 1; x += 4) g.add(boxMesh(0.5, 0.6, 0.15, rubber, x, 0.25, -p.d / 2 - 0.07, shadows, false));
        g.applyMatrix4(placed(p));
        group.add(g);
        break;
      }
      case "curb": {
        const m = boxMesh(p.w, p.h, p.d, curbMat, p.x, p.y, p.z, false);
        m.receiveShadow = shadows;
        group.add(m);
        break;
      }
      case "step": {
        const m = boxMesh(p.w, p.h, p.d, concreteWall, 0, 0, 0, shadows);
        m.applyMatrix4(placed(p));
        group.add(m);
        break;
      }
      case "gantryLeg": {
        group.add(boxMesh(p.w, p.h, p.d, yellowPaint, p.x, p.y, p.z, shadows));
        // franja de peligro en la base
        const band = boxMesh(p.w + 0.04, 1.2, p.d + 0.04, hazard, p.x, 0.3, p.z, false, true);
        group.add(band);
        break;
      }
      case "gantryBeam": {
        group.add(boxMesh(p.w, p.h, p.d, yellowPaint, p.x, p.y, p.z, shadows));
        // carro de la grúa con cables y gancho (solo en la primera viga)
        if (p.z < 37) {
          group.add(boxMesh(3.2, 1.6, 5.6, yellowPaint, p.x + 4, p.y + p.h, p.z + 2.1, shadows));
          const cable = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.8 });
          for (const dx of [-0.5, 0.5]) group.add(boxMesh(0.04, 9, 0.04, cable, p.x + 4 + dx, p.y - 9, p.z + 2.1, shadows, false));
          group.add(boxMesh(2.6, 0.6, 2.6, galvanized, p.x + 4, p.y - 9.6, p.z + 2.1, shadows));
        }
        break;
      }
      case "lightmast": {
        group.add(boxMesh(p.w * 0.6, p.h, p.w * 0.6, galvanized, p.x, 0, p.z, shadows));
        group.add(boxMesh(p.w * 1.6, 0.4, p.w * 1.6, concreteWall, p.x, 0, p.z, shadows));
        const light = tpl.get("security_light");
        const heads = p.v ? [0] : [0, 1, 2, 3];
        if (!p.v) group.add(boxMesh(2.4, 0.12, 0.12, galvanized, p.x, p.h - 0.4, p.z, shadows, false));
        for (const i of heads) {
          if (!light) break;
          const ang = p.v ? 0 : (i % 2) * Math.PI;
          const off = p.v ? 0.4 : (i < 2 ? -0.7 : 0.7);
          const m = new THREE.Matrix4().makeTranslation(p.x + (p.v ? 0 : off), p.h - 0.35, p.z + (p.v ? 0.4 : 0))
            .multiply(new THREE.Matrix4().makeRotationY(ang)).multiply(new THREE.Matrix4().makeRotationX(0.5))
            .multiply(new THREE.Matrix4().makeScale(2, 2, 2));
          inst.add(light, m, "seclight", (mt) => (/glass/i.test(mt.name) ? lampGlass : mt));
        }
        break;
      }
      // ---------- Hangar ----------
      case "hangarWall": case "column": case "catwalk": case "stairs": case "corridor": case "hangarCeiling":
      case "railing": case "forcefield": case "hangarFloor":
        buildHangarPiece(p, group, shadows, glows, updaters);
        break;
      case "dropship": {
        const t = tpl.get("dropship");
        if (t) inst.add(t, fitMatrix(bbox(t), { ...p, h: p.h * 1.25 }, { uniform: true, rotY: 0 }), "dropship");
        break;
      }
      case "scicrate": case "scicrate2": {
        const t = tpl.get(p.kind);
        if (t) inst.add(t, fitMatrix(bbox(t), p), p.kind, tinted(0x9aa2ac));
        break;
      }
    }
  }

  // Fachadas
  for (const run of e.facades) await buildFacadeRun(run, inst, group, shadows, concreteWall);

  // Tubos fluorescentes del hangar
  const tube = tpl.get("mounted_fluorescent_lights");
  if (opts.indoor && tube) {
    const tubeGlow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfeaff, emissiveIntensity: 4, roughness: 0.2 });
    glows.push(tubeGlow);
    for (const [x, y, z, kind] of e.lights) {
      if (kind !== 2) continue;
      for (const dz of [-1.1, 0, 1.1]) {
        const m = new THREE.Matrix4().makeTranslation(x, y, z + dz).multiply(new THREE.Matrix4().makeScale(2.6, 1, 1.4));
        inst.add(tube, m, "tube", () => tubeGlow);
      }
    }
  }

  inst.build(group);
  lod.build(tpl.get("container") ?? null, group, shadows, tinted);
  return { group, glows, update: (t, cam) => { for (const u of updaters) u(t); if (cam) lod.update(cam); } };
}

// ---------- Fachadas de ladrillo con el kit modular ----------

const FACING: Record<FacadeRun["facing"], [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

async function buildFacadeRun(run: FacadeRun, inst: Instancer, group: THREE.Group, shadows: boolean, bodyMat: THREE.Material) {
  const facade = await kit("modular_factory_facade");
  if (!facade) return;
  const nodes = new Map<string, THREE.Object3D>();
  facade.traverse((o) => { if ((o as THREE.Mesh).isMesh || o.children.length === 0) nodes.set(o.name, o); });
  // Las piezas son hijas directas de la escena del kit: las buscamos por nombre
  for (const c of facade.children) nodes.set(c.name, c);
  const boxes = new Map<string, THREE.Box3>();
  const box = (n: string) => { let b = boxes.get(n); if (!b) { const o = nodes.get(n); b = o ? new THREE.Box3().setFromObject(o) : new THREE.Box3(); boxes.set(n, b); } return b; };

  const [nx, nz] = FACING[run.facing];
  const theta = Math.atan2(nx, nz);
  const kx = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)); // eje X del kit en el mundo
  const a = new THREE.Vector3(run.x0, 0, run.z0), b = new THREE.Vector3(run.x1, 0, run.z1);
  const start = a.dot(kx) < b.dot(kx) ? a : b;
  const rot = new THREE.Matrix4().makeRotationY(theta);

  /** Coloca una pieza del kit con su muro, ventana o puerta y molduras asociadas. */
  const placeModule = (wallName: string, along: number, floor: number) => {
    const wb = box(wallName);
    if (wb.isEmpty()) return;
    const suffix = wallName.replace(/^wall_/, "");
    const parts = [wallName, suffix, `door_${suffix}`, suffix.replace(/^door_/, "")].filter((n, i, arr) => nodes.has(n) && arr.indexOf(n) === i);
    // centro del módulo en el kit y destino en el mundo
    const kitCenterX = (wb.min.x + wb.max.x) / 2;
    const width = wb.max.x - wb.min.x;
    const dest = start.clone().addScaledVector(kx, along + width / 2);
    const m = new THREE.Matrix4().makeTranslation(dest.x, floor * 3, dest.z).multiply(rot)
      .multiply(new THREE.Matrix4().makeTranslation(-kitCenterX, -wb.min.y, -0));
    // en el kit las filas alternativas (_02) están desplazadas hacia atrás en z: se corrige
    const zFix = wallName.match(/_0[2468]$/) && Math.abs(wb.max.z + 2) < 0.4 ? 2 : 0;
    if (zFix) m.multiply(new THREE.Matrix4().makeTranslation(0, 0, zFix));
    for (const n of parts) { const node = nodes.get(n)!; inst.add(node, m.clone().multiply(node.matrixWorld), `fac|${n}`); }
    return width;
  };
  const trim = (name: string, along: number, y: number) => {
    const tb = box(name);
    if (tb.isEmpty()) return;
    const dest = start.clone().addScaledVector(kx, along + 1.5);
    const node = nodes.get(name)!;
    const m = new THREE.Matrix4().makeTranslation(dest.x, y, dest.z).multiply(rot)
      .multiply(new THREE.Matrix4().makeTranslation(-(tb.min.x + tb.max.x) / 2, -tb.min.y, 0))
      .multiply(node.matrixWorld);
    inst.add(node, m, `fac|${name}`);
  };

  const WINDOWS = ["centered_large", "centered_medium", "centered_small", "centered_double"];
  const maxIdx: Record<string, number> = { centered_large: 6, centered_medium: 6, centered_small: 4, centered_double: 4 };
  let along = 0;
  let seed = Math.floor(Math.abs(run.x0 * 13 + run.z0 * 7));
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const bld of run.buildings) {
    const bStart = along;
    let m = 0;
    while (m < bld.modules) {
      // planta baja
      let ground = "wall_standard_standard_01";
      const r = rnd();
      if (bld.ground === 1 && m + 2 <= bld.modules && r < 0.45) ground = "wall_door_garage_door_01";
      else if (bld.ground === 2 && m + 3 <= bld.modules && r < 0.2) ground = "wall_door_garage_double_01";
      else if (r < 0.25) ground = "wall_door_recessed_large_01";
      else if (r < 0.4) ground = "wall_door_recessed_small_01";
      else if (r < 0.75) ground = `wall_window_${WINDOWS[bld.style]}_01`;
      const w = placeModule(ground, along, 0) ?? 3;
      const cols = Math.max(1, Math.round(w / 3));
      for (let c = 0; c < cols; c++) {
        trim("cornice03_standard_standard_01", along + c * 3, 2.94);
        for (let f = 1; f < bld.floors; f++) {
          const type = WINDOWS[bld.style];
          const idx = Math.min(f, maxIdx[type]);
          const name = rnd() < 0.08 ? "wall_standard_standard_01" : `wall_window_${type}_0${idx}`;
          placeModule(name, along + c * 3, f);
        }
        trim("crown_standard_standard_01", along + c * 3, bld.floors * 3);
      }
      along += cols * 3;
      m += cols;
    }
    // Cuerpo del edificio detrás de la fachada (se ve donde cambian las alturas)
    const len = along - bStart;
    const mid = start.clone().addScaledVector(kx, bStart + len / 2).addScaledVector(new THREE.Vector3(nx, 0, nz), -0.4 - 4);
    const height = bld.floors * 3 + 0.32;
    const body = new THREE.BoxGeometry(len, height, 8);
    body.applyMatrix4(new THREE.Matrix4().makeRotationY(theta));
    body.translate(mid.x, height / 2, mid.z);
    applyWorldUV(body);
    const mesh = new THREE.Mesh(body, bodyMat);
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }
}

// ---------- Hangar ----------

let hangarMats: Record<string, THREE.MeshStandardMaterial> | null = null;
function hangarMaterials() {
  if (hangarMats) return hangarMats;
  hangarMats = {
    wall: photoMaterial("blue_metal_plate", 2.4, { tint: 0xc4ccd6, metalness: 0.15 }),
    dark: photoMaterial("metal_plate_02", 2, { tint: 0x7a838e, metalness: 0.2 }),
    trim: photoMaterial("metal_plate_02", 1.2, { tint: 0xa8382f, metalness: 0.2 }),
    floor: photoMaterial("metal_plate", 2, { tint: 0xa6adb6, metalness: 0.1 }),
    grate: photoMaterial("metal_plate_02", 1, { tint: 0x8a929c, metalness: 0.3 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 }),
  };
  return hangarMats;
}

function buildHangarPiece(p: Piece, group: THREE.Group, shadows: boolean, glows: THREE.MeshStandardMaterial[], updaters: ((t: number) => void)[]) {
  const M = hangarMaterials();
  const w = p.rot % 2 ? p.d : p.w, d = p.rot % 2 ? p.w : p.d;
  switch (p.kind) {
    case "hangarFloor":
    case "corridor": {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(p.x, 0.005, p.z);
      applyWorldUV(g);
      const m = new THREE.Mesh(g, M.floor);
      m.receiveShadow = shadows;
      group.add(m);
      if (p.kind === "corridor") {
        const c = new THREE.PlaneGeometry(w, d);
        c.rotateX(Math.PI / 2);
        c.translate(p.x, p.h - 0.01, p.z);
        applyWorldUV(c);
        group.add(new THREE.Mesh(c, M.dark));
      }
      break;
    }
    case "hangarWall": {
      group.add(boxMesh(w, p.h, d, p.v ? M.dark : M.wall, p.x, p.y, p.z, shadows));
      // Zócalo y canaleta al pie de la pared, y moldura arriba: tapan las uniones con el piso y el techo
      if (p.y === 0 && p.h > 3) {
        group.add(boxMesh(w + 0.24, 0.45, d + 0.24, M.dark, p.x, 0, p.z, shadows));
        group.add(boxMesh(w + 0.5, 0.05, d + 0.5, M.grate, p.x, 0, p.z, false));
        group.add(boxMesh(w + 0.3, 0.12, d + 0.3, M.trim, p.x, 0.45, p.z, false));
      }
      if (p.y + p.h > 13) group.add(boxMesh(w + 0.3, 0.5, d + 0.3, M.dark, p.x, p.y + p.h - 0.5, p.z, false));
      break;
    }
    case "hangarCeiling": {
      const c = new THREE.PlaneGeometry(w, d);
      c.rotateX(Math.PI / 2);
      c.translate(p.x, p.y, p.z);
      applyWorldUV(c);
      const m = new THREE.Mesh(c, M.dark);
      m.receiveShadow = shadows;
      group.add(m);
      // vigas reticuladas del techo
      for (let x = p.x - w / 2 + 5.5; x < p.x + w / 2; x += 5.5) {
        group.add(boxMesh(0.5, 1.2, d, M.dark, x, p.y - 1.2, p.z, shadows, true));
        group.add(boxMesh(0.25, 0.25, d, M.trim, x, p.y - 1.45, p.z, shadows, true));
      }
      break;
    }
    case "column": {
      group.add(boxMesh(w, p.h, d, M.dark, p.x, 0, p.z, shadows));
      group.add(boxMesh(w + 0.06, 0.3, d + 0.06, M.trim, p.x, 3.6, p.z, shadows));
      group.add(boxMesh(w + 0.04, 1.1, d + 0.04, M.hazard, p.x, 0, p.z, shadows, true));
      break;
    }
    case "catwalk": {
      group.add(boxMesh(w, p.h, d, M.grate, p.x, p.y, p.z, shadows));
      // apoyos y borde
      for (let x = p.x - w / 2 + 1; x < p.x + w / 2; x += 6) group.add(boxMesh(0.25, p.y, 0.25, M.dark, x, 0, p.z + d / 2 - 0.2, shadows, false));
      group.add(boxMesh(w, 0.25, 0.15, M.trim, p.x, p.y + p.h - 0.25, p.z + d / 2, shadows, false));
      break;
    }
    case "railing": {
      group.add(boxMesh(w, 0.06, 0.06, M.trim, p.x, p.y + p.h - 0.06, p.z, shadows, false));
      group.add(boxMesh(w, 0.04, 0.04, M.dark, p.x, p.y + p.h * 0.5, p.z, shadows, false));
      for (let x = p.x - w / 2; x <= p.x + w / 2 + 0.01; x += 1.5) group.add(boxMesh(0.05, p.h, 0.05, M.dark, x, p.y, p.z, shadows, false));
      break;
    }
    case "stairs": {
      // peldaño (el bloque bajo él se dibuja como larguero oscuro)
      group.add(boxMesh(w, 0.08, d, M.grate, p.x, p.y + p.h - 0.08, p.z, shadows, true));
      group.add(boxMesh(0.12, p.h, d, M.dark, p.x - w / 2 + 0.06, p.y, p.z, shadows, false));
      group.add(boxMesh(0.12, p.h, d, M.dark, p.x + w / 2 - 0.06, p.y, p.z, shadows, false));
      break;
    }
    case "forcefield": {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main(){
            float scan = 0.5 + 0.5 * sin(vUv.y * 160.0 - uTime * 3.0);
            float hex = abs(sin(vUv.x * 90.0) * sin(vUv.y * 40.0 + uTime * 0.5));
            float edge = smoothstep(0.08, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
            float a = 0.035 + 0.03 * scan + 0.04 * smoothstep(0.92, 1.0, hex) + edge * 0.5;
            gl_FragColor = vec4(vec3(0.35, 0.65, 1.0) * a, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const g = new THREE.PlaneGeometry(d, p.h);
      g.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(p.x, p.y + p.h / 2, p.z);
      group.add(m);
      updaters.push((t) => { mat.uniforms.uTime.value = t; });
      // marco luminoso
      const glow = new THREE.MeshStandardMaterial({ color: 0x0a1420, emissive: 0x4aa8ff, emissiveIntensity: 2.5 });
      glows.push(glow);
      group.add(boxMesh(0.15, 0.12, d, glow, p.x - 0.05, p.y - 0.06, p.z, false, false));
      group.add(boxMesh(0.15, 0.12, d, glow, p.x - 0.05, p.y + p.h - 0.06, p.z, false, false));
      break;
    }
  }
}


// ---------- Alrededores: suelo más allá del límite y edificios lejanos ----------

/** Textura de fachada lejana: grilla de ventanas, algunas encendidas. */
function skylineTexture(seed: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const mk = () => { const c = document.createElement("canvas"); c.width = 256; c.height = 256; return c; };
  const a = mk(), b = mk();
  const g = a.getContext("2d")!, ge = b.getContext("2d")!;
  const tone = 70 + Math.floor(rnd() * 50);
  g.fillStyle = `rgb(${tone + 12},${tone + 4},${tone})`; g.fillRect(0, 0, 256, 256);
  ge.fillStyle = "#000"; ge.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const lit = rnd() < 0.22;
    g.fillStyle = lit ? "#caa66a" : `rgb(${28 + rnd() * 20},${34 + rnd() * 20},${44 + rnd() * 24})`;
    g.fillRect(x * 32 + 7, y * 32 + 6, 18, 20);
    if (lit) { ge.fillStyle = `rgb(${200 + rnd() * 55},${150 + rnd() * 50},${80 + rnd() * 40})`; ge.fillRect(x * 32 + 7, y * 32 + 6, 18, 20); }
  }
  const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: tex(a), emissive: tex(b) };
}

function buildSurroundings(e: Expansion, group: THREE.Group, shadows: boolean) {
  const b = e.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  // Suelo hasta el horizonte: ya no se ve vacío por debajo del cielo
  const ground = new THREE.PlaneGeometry(1400, 1400);
  ground.rotateX(-Math.PI / 2);
  ground.translate(cx, -0.2, cz);
  applyWorldUV(ground);
  const gm = new THREE.Mesh(ground, photoMaterial("asphalt_02", 9, { tint: 0x6c6a66 }));
  gm.receiveShadow = shadows;
  group.add(gm);

  // Anillo de edificios lejanos, cada vez más altos hacia afuera. Una malla por variante de fachada.
  let seed = 90210;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const variants = [0, 1, 2].map((i) => {
    const t = skylineTexture(1234 + i * 77);
    return { mat: new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.9 }), geos: [] as THREE.BufferGeometry[] };
  });
  const roof = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 1 });
  const roofs: THREE.BufferGeometry[] = [];
  const place = (x: number, z: number, w: number, d: number, h: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    // UV en metros: una ventana cada ~3.5 m
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const horiz = Math.abs(nor.getX(i)) > 0.5 ? pos.getZ(i) : pos.getX(i);
      uv.setXY(i, horiz / 28, pos.getY(i) / 28);
    }
    g.translate(x, h / 2 - 0.2, z);
    variants[Math.floor(rnd() * variants.length)].geos.push(g);
    const r = new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6);
    r.translate(x, h - 0.2, z);
    roofs.push(r);
  };
  for (let ring = 0; ring < 3; ring++) {
    const off = 16 + ring * 34;
    const x0 = b.minX - off, x1 = b.maxX + off, z0 = b.minZ - off, z1 = b.maxZ + off;
    const hMin = 20 + ring * 14, hVar = 18 + ring * 22;
    const side = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      let t = 0;
      while (t < len) {
        const w = 16 + rnd() * 22;
        const k = (t + w / 2) / len;
        const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
        if (rnd() > 0.12) place(ax + (bx - ax) * k, az + (bz - az) * k, alongX ? w : 18 + rnd() * 10, alongX ? 18 + rnd() * 10 : w, hMin + rnd() * hVar);
        t += w + 3 + rnd() * 8;
      }
    };
    side(x0, z0, x1, z0); side(x1, z0, x1, z1); side(x1, z1, x0, z1); side(x0, z1, x0, z0);
  }
  for (const v of variants) {
    if (!v.geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(v.geos), v.mat);
    m.castShadow = false; m.receiveShadow = false;
    group.add(m);
  }
  group.add(new THREE.Mesh(mergeGeometries(roofs), roof));
}
