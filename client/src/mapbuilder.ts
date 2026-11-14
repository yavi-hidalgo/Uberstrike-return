// Construye la parte visual del mapa a partir de las cajas de colisión y las piezas decorativas.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_HALF, MAP_BOXES, MAP_FEATURES, PICKUPS, type Box, type Feature } from "../../shared/src/map";
import { applyWorldUV, material, softSprite, type MaterialName } from "./textures";

export interface MapVisuals {
  group: THREE.Group;
  dome: THREE.Object3D | null;
  blinkers: THREE.Mesh[];
  pickups: Map<number, PickupVisual>;
}

export interface PickupVisual {
  root: THREE.Group;
  item: THREE.Group;
  glow: THREE.Sprite;
  light: THREE.PointLight | null;
  baseY: number;
}

const KIND_MATERIAL: Record<string, MaterialName> = {
  concrete: "concrete", rock: "rock", wood: "wood", metal: "metalOrange", crate: "crate",
};

function castAll(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
  });
}

/** Bloque biselado con textura a escala real. */
function block(w: number, h: number, d: number, mat: MaterialName, cx: number, cy: number, cz: number, radius = 0.06, tile = 2): THREE.Mesh {
  const r = Math.min(radius, w / 2.2, h / 2.2, d / 2.2);
  const geo = new RoundedBoxGeometry(w, h, d, 3, r);
  applyWorldUV(geo, tile, new THREE.Vector3(cx, cy, cz));
  const m = new THREE.Mesh(geo, material(mat));
  m.position.set(cx, cy, cz);
  return m;
}

/** Capa de nieve acumulada sobre una superficie horizontal. */
function snowCap(w: number, d: number, x: number, y: number, z: number, thick = 0.1): THREE.Mesh {
  const geo = new RoundedBoxGeometry(w + 0.04, thick, d + 0.04, 2, Math.min(thick / 2.1, 0.05));
  applyWorldUV(geo, 3, new THREE.Vector3(x, y, z));
  const m = new THREE.Mesh(geo, material("snow"));
  m.position.set(x, y + thick / 2 - 0.02, z);
  return m;
}

/** Roca: bloque redondeado con la superficie deformada. */
function boulder(b: Box): THREE.Object3D {
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const geo = new RoundedBoxGeometry(w, h, d, 5, Math.min(w, h, d) * 0.32);
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const seed = cx * 3.1 + cz * 7.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 2.3 + seed) * Math.cos(z * 2.1 - seed) + Math.sin(y * 3.1 + x * 1.3) * 0.5;
    const k = 1 - 0.07 * (n + 1.5) / 3; // solo hacia dentro: nunca sobresale de la colisión
    p.setXYZ(i, x * k, y * (y > 0 ? k : 1), z * k);
  }
  geo.computeVertexNormals();
  applyWorldUV(geo, 3, new THREE.Vector3(cx, cy, cz));
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, material("rock"));
  m.position.set(cx, cy, cz);
  g.add(m);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.4),
    material("snow"),
  );
  cap.scale.set(w * 0.42, h * 0.16, d * 0.42);
  cap.position.set(cx, b.max[1] - h * 0.1, cz);
  g.add(cap);
  return g;
}

function genericBox(b: Box): THREE.Object3D {
  if (b.kind === "rock") return boulder(b);
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const g = new THREE.Group();
  let mat: MaterialName = KIND_MATERIAL[b.kind] ?? "concrete";
  if (b.kind === "metal") mat = cx > 0 ? "metalOrange" : "metalBlue";
  const tile = b.kind === "crate" ? Math.max(w, h, d) : b.kind === "metal" ? 2.4 : 2;
  const mesh = block(w, h, d, mat, cx, cy, cz, b.kind === "concrete" ? 0.08 : 0.04, tile);
  if (b.kind === "crate") {
    // la caja usa su propio mapeo por cara para que el marco coincida con los bordes
    mesh.geometry = new RoundedBoxGeometry(w, h, d, 2, 0.03);
  }
  g.add(mesh);
  g.add(snowCap(w, d, cx, b.max[1], cz, b.kind === "crate" ? 0.06 : 0.12));
  if (b.kind === "metal") {
    // Puertas del contenedor y barras de cierre
    const dark = material("metalDark");
    const side = w > d ? 1 : 0;
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, h * 0.85, 8), dark);
      if (side) bar.position.set(cx + s * 0.25, cy, cz + d / 2 + 0.03);
      else bar.position.set(cx + d / 2 + 0.03, cy, cz + s * 0.25);
      g.add(bar);
    }
  }
  return g;
}

// ---------- Piezas decorativas ----------

function observatory(f: Extract<Feature, { type: "observatory" }>): { group: THREE.Group; dome: THREE.Object3D } {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  const R = f.baseRadius / Math.cos(Math.PI / 8); // caras planas a baseRadius del centro

  // Base octogonal de hormigón
  const baseGeo = new THREE.CylinderGeometry(R, R * 1.02, f.baseHeight, 8, 1);
  baseGeo.rotateY(Math.PI / 8);
  baseGeo.translate(0, f.baseHeight / 2, 0);
  applyWorldUV(baseGeo, 2.5);
  const base = new THREE.Mesh(baseGeo.toNonIndexed(), material("concrete"));
  (base.geometry as THREE.BufferGeometry).computeVertexNormals();
  applyWorldUV(base.geometry as THREE.BufferGeometry, 2.5);
  g.add(base);

  // Cornisa y techo transitable con nieve
  const corn = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.035, R * 1.035, 0.28, 8), material("metalDark"));
  corn.geometry.rotateY(Math.PI / 8);
  corn.position.y = f.baseHeight - 0.1;
  g.add(corn);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.08, 8), material("snow"));
  roof.geometry.rotateY(Math.PI / 8);
  applyWorldUV(roof.geometry, 3);
  roof.position.y = f.baseHeight + 0.02;
  g.add(roof);
  // Zócalo oscuro
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.04, 0.5, 8), material("metalDark"));
  plinth.geometry.rotateY(Math.PI / 8);
  plinth.position.y = 0.25;
  g.add(plinth);

  // Ventanas con luz cálida en las caras diagonales
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: 0xffb15c, emissiveIntensity: 2.2, roughness: 0.3 });
  const frameMat = material("metalDark");
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 4 / 1; // caras diagonales y frontales alternas
    if (i % 2 === 0) continue;
    const ang = (i * Math.PI) / 4;
    const dist = f.baseRadius + 0.02;
    const wg = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.08), frameMat);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.06), winMat);
    glass.position.z = 0.02;
    wg.add(frame, glass);
    wg.position.set(Math.sin(ang) * dist, 1.9, Math.cos(ang) * dist);
    wg.rotation.y = ang;
    g.add(wg);
    void a;
  }
  // Puertas metálicas este y oeste con luz encima
  for (const s of [-1, 1]) {
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.1, 2.1, 1.3, 2, 0.02), material("metalDark"));
    door.position.set(s * (f.baseRadius + 0.03), 1.05, 0);
    g.add(door);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0xfff0d0, emissiveIntensity: 3 }));
    lamp.position.set(s * (f.baseRadius + 0.1), 2.4, 0);
    g.add(lamp);
    const pl = new THREE.PointLight(0xffd9a8, 6, 9, 2);
    pl.position.set(s * (f.baseRadius + 0.8), 2.3, 0);
    g.add(pl);
  }

  // Cúpula de metal blanco con su anillo y la ranura del telescopio
  const dome = new THREE.Group();
  dome.position.y = f.baseHeight;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(f.domeRadius + 0.12, f.domeRadius + 0.12, 0.45, 48), material("metalDark"));
  ring.position.y = 0.22;
  dome.add(ring);
  const shellGeo = new THREE.SphereGeometry(f.domeRadius, 64, 24, 0.25, Math.PI * 2 - 0.5, 0, Math.PI / 2);
  // UV propios: paneles en gajos
  const sp = shellGeo.getAttribute("position") as THREE.BufferAttribute;
  const suv = shellGeo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) suv.setXY(i, suv.getX(i) * 8, suv.getY(i) * 2);
  void sp;
  const shell = new THREE.Mesh(shellGeo, material("metalWhite"));
  shell.position.y = 0.42;
  dome.add(shell);
  // Ranura oscura con brillo azul del interior
  const slit = new THREE.Mesh(
    new THREE.SphereGeometry(f.domeRadius - 0.05, 16, 24, -0.25, 0.5, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x1d3c70, emissiveIntensity: 0.6, side: THREE.DoubleSide }),
  );
  slit.position.y = 0.42;
  dome.add(slit);
  // Nervios de la cúpula
  for (let i = 0; i < 12; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(f.domeRadius + 0.02, 0.035, 6, 32, Math.PI / 2), material("metalDark"));
    rib.rotation.set(0, (i / 12) * Math.PI * 2, Math.PI / 2);
    rib.position.y = 0.42;
    rib.rotateX(0);
    const holder = new THREE.Group();
    holder.rotation.y = (i / 12) * Math.PI * 2;
    rib.rotation.set(0, Math.PI / 2, 0);
    holder.add(rib);
    holder.position.y = 0.42;
    rib.position.set(0, 0, 0);
    dome.add(holder);
  }
  // Nieve en la parte alta de la cúpula
  const domeSnow = new THREE.Mesh(new THREE.SphereGeometry(f.domeRadius + 0.03, 48, 8, 0, Math.PI * 2, 0, 0.55), material("snow"));
  domeSnow.position.y = 0.42;
  dome.add(domeSnow);
  g.add(dome);
  castAll(g);
  return { group: g, dome };
}

function stairs(f: Extract<Feature, { type: "stairs" }>): THREE.Group {
  const g = new THREE.Group();
  const s = f.dir === "s" ? 1 : -1;
  for (let k = 1; k <= f.steps; k++) {
    const len = (f.steps + 1 - k) * 1.0;
    const h = f.stepH * k;
    const zc = f.z + s * (len / 2);
    g.add(block(f.width, h, len, "concrete", f.x, h / 2, zc, 0.04, 2));
    g.add(snowCap(f.width - 0.1, 0.9, f.x, h, f.z + s * (len - 0.5), 0.05));
  }
  // Barandillas metálicas
  const rail = material("metalDark");
  for (const side of [-1, 1]) {
    const x = f.x + side * (f.width / 2 + 0.05);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= f.steps; k++) {
      const z = f.z + s * ((f.steps - k) * 1.0 + 0.5);
      const y = f.stepH * Math.max(k, 0.5) + 1.0;
      pts.push(new THREE.Vector3(x, y, z));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 8), rail);
      post.position.set(x, y - 0.5, z);
      g.add(post);
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 8), rail);
    g.add(tube);
  }
  castAll(g);
  return g;
}

function terrace(f: Extract<Feature, { type: "terrace" }>): THREE.Group {
  const g = new THREE.Group();
  // Muro de contención de roca
  const geo = new RoundedBoxGeometry(f.w, f.h, f.d, 4, 0.25);
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(y - f.h / 2) < 0.01) continue; // la parte de arriba queda plana para caminar
    const n = Math.sin(z * 1.7 + y * 2.3) * Math.cos(x * 1.9) * 0.5 + 0.5;
    const k = 1 - 0.03 * n;
    p.setXYZ(i, x * k, y, z * (1 - 0.01 * n));
  }
  geo.computeVertexNormals();
  applyWorldUV(geo, 3, new THREE.Vector3(f.x, f.h / 2, f.z));
  const m = new THREE.Mesh(geo, material("rock"));
  m.position.set(f.x, f.h / 2, f.z);
  g.add(m);
  // Suelo de losas encima, con borde de nieve
  const top = new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.3, 0.06, f.d - 0.3), material("flagstone"));
  applyWorldUV(top.geometry, 3, new THREE.Vector3(f.x, f.h, f.z));
  top.position.set(f.x, f.h + 0.02, f.z);
  g.add(top);
  // Escalón de acceso
  const sx = Math.sign(f.x);
  g.add(block(1.5, f.h / 2, 6, "concrete", f.x - sx * 4.75, f.h / 4, f.z, 0.05));
  g.add(snowCap(1.4, 5.9, f.x - sx * 4.75, f.h / 2, f.z, 0.05));
  castAll(g);
  return g;
}

function hut(f: Extract<Feature, { type: "hut" }>): THREE.Group {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  // Muros de troncos
  const walls = block(f.w, f.h, f.d, "wood", 0, f.h / 2, 0, 0.05, 2);
  walls.geometry = applyWorldUV(new RoundedBoxGeometry(f.w, f.h, f.d, 2, 0.05), 2, new THREE.Vector3(f.x, f.h / 2, f.z));
  g.add(walls);
  // Postes de esquina
  const dark = material("woodDark");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, f.h + 0.1, 0.22), dark);
    post.position.set(sx * (f.w / 2), f.h / 2, sz * (f.d / 2));
    g.add(post);
  }
  // Tejado a dos aguas de chapa con nieve
  const roofH = 1.3;
  const shape = new THREE.Shape();
  shape.moveTo(-f.d / 2 - 0.45, 0);
  shape.lineTo(0, roofH);
  shape.lineTo(f.d / 2 + 0.45, 0);
  shape.lineTo(f.d / 2 + 0.45, -0.12);
  shape.lineTo(0, roofH - 0.14);
  shape.lineTo(-f.d / 2 - 0.45, -0.12);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: f.w + 0.7, bevelEnabled: false });
  roofGeo.translate(0, 0, -(f.w + 0.7) / 2);
  roofGeo.rotateY(Math.PI / 2);
  applyWorldUV(roofGeo, 2);
  const roof = new THREE.Mesh(roofGeo, material("metalDark"));
  roof.position.y = f.h;
  g.add(roof);
  for (const s of [-1, 1]) {
    const slope = Math.atan2(roofH, f.d / 2 + 0.45);
    const len = Math.hypot(roofH, f.d / 2 + 0.45);
    const sn = new THREE.Mesh(new RoundedBoxGeometry(f.w + 0.7, 0.14, len, 2, 0.06), material("snow"));
    applyWorldUV(sn.geometry, 3);
    sn.position.set(0, f.h + roofH / 2 + 0.06, s * (f.d / 4 + 0.22));
    sn.rotation.x = s * slope;
    g.add(sn);
  }
  // Hastiales (triángulos de los extremos)
  const gable = new THREE.Shape();
  gable.moveTo(-f.d / 2, 0); gable.lineTo(0, roofH - 0.1); gable.lineTo(f.d / 2, 0);
  for (const s of [-1, 1]) {
    const gg = new THREE.ShapeGeometry(gable);
    applyWorldUV(gg, 2);
    const gm = new THREE.Mesh(gg, material("wood"));
    gm.rotation.y = s * Math.PI / 2;
    gm.position.set(s * (f.w / 2 + 0.001), f.h, 0);
    g.add(gm);
  }
  // Ventanas iluminadas y puerta
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1c1208, emissive: 0xffa64d, emissiveIntensity: 2.4 });
  const doorSide = f.door === "e" ? 1 : -1;
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.06), winMat);
    win.position.set(s * 1.2, 1.7, f.d / 2 + 0.03);
    const win2 = win.clone();
    win2.position.z = -f.d / 2 - 0.03;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 0.05), dark);
    frame.position.copy(win.position).add(new THREE.Vector3(0, 0, -0.01));
    const frame2 = frame.clone();
    frame2.position.copy(win2.position).add(new THREE.Vector3(0, 0, 0.01));
    g.add(frame, win, frame2, win2);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 1.0), dark);
  door.position.set(doorSide * (f.w / 2 + 0.04), 1.0, 0);
  g.add(door);
  const porch = new THREE.PointLight(0xffb36b, 7, 10, 2);
  porch.position.set(doorSide * (f.w / 2 + 0.9), 2.4, 0);
  g.add(porch);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }));
  bulb.position.set(doorSide * (f.w / 2 + 0.2), 2.45, 0);
  g.add(bulb);
  // Chimenea
  const chim = block(0.5, 1.4, 0.5, "concrete", f.w / 2 - 0.8, f.h + 0.9, 0.6, 0.03);
  g.add(chim);
  castAll(g);
  return g;
}

function antenna(f: Extract<Feature, { type: "antenna" }>, blinkers: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.4 });
  const geos: THREE.BufferGeometry[] = [];
  const half = 0.55;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.CylinderGeometry(0.05, 0.06, f.h, 6);
    c.translate(sx * half, f.h / 2, sz * half);
    geos.push(c);
  }
  // Riostras en zigzag
  const seg = 1.0;
  for (let y = 0; y < f.h - 0.1; y += seg) {
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      const a = new THREE.Vector3(ax * half, y, az * half);
      const b = new THREE.Vector3(bx * half, y + seg, bz * half);
      const len = a.distanceTo(b);
      const c = new THREE.CylinderGeometry(0.022, 0.022, len, 4);
      c.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      c.applyQuaternion(q);
      c.translate(a.x, a.y, a.z);
      geos.push(c);
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(geos), metal));
  // Antenas de varilla y luz roja intermitente
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), metal);
  top.position.y = f.h + 1.25;
  g.add(top);
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2a1a, emissiveIntensity: 6 }));
  red.position.y = f.h + 2.55;
  g.add(red);
  blinkers.push(red);
  const base = block(1.6, 0.4, 1.6, "concrete", 0, 0.2, 0, 0.04);
  g.add(base);
  castAll(g);
  return g;
}

function dish(f: Extract<Feature, { type: "dish" }>): THREE.Group {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  g.add(block(2.2, 1.2, 2.2, "concrete", 0, 0.6, 0, 0.06));
  g.add(snowCap(2.1, 2.1, 0, 1.2, 0, 0.06));
  const white = material("metalWhite");
  const dark = material("metalDark");
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 12), dark);
  mast.position.y = 1.9;
  g.add(mast);
  const head = new THREE.Group();
  head.position.y = 2.7;
  head.rotation.y = f.yaw;
  const dishGeo = new THREE.SphereGeometry(1.8, 40, 12, 0, Math.PI * 2, 0, 0.75);
  const d = new THREE.Mesh(dishGeo, white);
  d.material = white.clone();
  (d.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  d.rotation.x = -Math.PI / 2 - 0.6;
  d.position.z = 0.2;
  head.add(d);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), dark);
  arm.rotation.x = Math.PI / 2 - 0.6;
  arm.position.set(0, 0.55, -0.55);
  head.add(arm);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.3, 10), dark);
  feed.position.set(0, 0.95, -1.15);
  feed.rotation.x = Math.PI / 2 - 0.6;
  head.add(feed);
  g.add(head);
  castAll(g);
  return g;
}

function lamp(f: Extract<Feature, { type: "lamp" }>, withLight: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  const dark = material("metalDark");
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 10), dark);
  pole.position.y = 1.8;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.08), dark);
  arm.position.set(0.25, 3.55, 0);
  g.add(arm);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 0.18, 12), dark);
  head.position.set(0.5, 3.45, 0);
  g.add(head);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0xffd9a0, emissiveIntensity: 5 }));
  bulb.position.set(0.5, 3.36, 0);
  g.add(bulb);
  if (withLight) {
    const l = new THREE.PointLight(0xffc98a, 9, 12, 2);
    l.position.set(0.5, 3.2, 0);
    g.add(l);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite("rgba(255,210,150,0.55)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(1.6);
  glow.position.set(0.5, 3.36, 0);
  g.add(glow);
  castAll(g, true, false);
  return g;
}

function boundaryFence(): THREE.Group {
  // Muro bajo y valla de seguridad en el borde del acantilado.
  const g = new THREE.Group();
  const H = ARENA_HALF + 0.35;
  for (const [x, z, w, d] of [[0, -H, ARENA_HALF * 2 + 1.4, 0.7], [0, H, ARENA_HALF * 2 + 1.4, 0.7], [-H, 0, 0.7, ARENA_HALF * 2], [H, 0, 0.7, ARENA_HALF * 2]] as const) {
    g.add(block(w, 0.7, d, "concrete", x, 0.35, z, 0.05));
    g.add(snowCap(w, d, x, 0.7, z, 0.08));
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0x6d7681, metalness: 0.8, roughness: 0.45 });
  const geos: THREE.BufferGeometry[] = [];
  const step = 2.5;
  for (let t = -ARENA_HALF; t <= ARENA_HALF; t += step) {
    for (const [x, z] of [[t, -H], [t, H], [-H, t], [H, t]]) {
      const p = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6);
      p.translate(x, 0.7 + 0.55, z);
      geos.push(p);
    }
  }
  for (const y of [1.2, 1.75]) {
    for (const [x, z, horiz] of [[0, -H, 1], [0, H, 1], [-H, 0, 0], [H, 0, 0]] as const) {
      const r = new THREE.CylinderGeometry(0.025, 0.025, ARENA_HALF * 2, 6);
      if (horiz) r.rotateZ(Math.PI / 2); else r.rotateX(Math.PI / 2);
      r.translate(x, y, z);
      geos.push(r);
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(geos), metal));
  castAll(g, true, true);
  return g;
}

function ground(): THREE.Group {
  const g = new THREE.Group();
  const size = ARENA_HALF * 2 + 4;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  applyWorldUV(geo, 5);
  const snow = new THREE.Mesh(geo, material("snow"));
  snow.receiveShadow = true;
  g.add(snow);
  // Plaza de losas alrededor del observatorio y caminos a las terrazas
  const plazaGeo = new THREE.CircleGeometry(11, 48);
  plazaGeo.rotateX(-Math.PI / 2);
  applyWorldUV(plazaGeo, 3.5);
  const plaza = new THREE.Mesh(plazaGeo, material("flagstone"));
  plaza.position.y = 0.01;
  plaza.receiveShadow = true;
  g.add(plaza);
  for (const s of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(4, 3.4);
    pg.rotateX(-Math.PI / 2);
    pg.translate(s * 12.3, 0.012, 0);
    applyWorldUV(pg, 3.5);
    const path = new THREE.Mesh(pg, material("flagstone"));
    path.receiveShadow = true;
    g.add(path);
  }
  return g;
}

function pickupVisual(x: number, y: number, z: number, withLight: boolean): PickupVisual {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  // Base: anillo luminoso en el suelo
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 32),
    new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  root.add(ring);
  // Maletín médico
  const item = new THREE.Group();
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.35, metalness: 0.1 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.36, 0.26, 3, 0.05), caseMat);
  item.add(body);
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0xff2020, emissiveIntensity: 1.6 });
  for (const s of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.02), crossMat);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.02), crossMat);
    v.position.z = h.position.z = s * 0.135;
    item.add(v, h);
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 16, Math.PI), material("metalDark"));
  handle.position.y = 0.18;
  item.add(handle);
  item.position.y = 0.75;
  item.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
  root.add(item);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite("rgba(255,120,120,0.6)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(1.6);
  glow.position.y = 0.75;
  root.add(glow);
  let light: THREE.PointLight | null = null;
  if (withLight) {
    light = new THREE.PointLight(0xff6d6d, 3, 4, 2);
    light.position.y = 0.9;
    root.add(light);
  }
  return { root, item, glow, light, baseY: 0.75 };
}

export function buildMap(quality: "low" | "medium" | "high"): MapVisuals {
  const group = new THREE.Group();
  const blinkers: THREE.Mesh[] = [];
  let dome: THREE.Object3D | null = null;
  const withLights = quality !== "low";

  group.add(ground());
  group.add(boundaryFence());

  for (const b of MAP_BOXES) {
    if (b.hidden || b.kind === "invisible") continue;
    const o = genericBox(b);
    castAll(o);
    group.add(o);
  }

  for (const f of MAP_FEATURES) {
    switch (f.type) {
      case "observatory": { const o = observatory(f); dome = o.dome; group.add(o.group); break; }
      case "stairs": group.add(stairs(f)); break;
      case "terrace": group.add(terrace(f)); break;
      case "hut": group.add(hut(f)); break;
      case "antenna": group.add(antenna(f, blinkers)); break;
      case "dish": group.add(dish(f)); break;
      case "lamp": group.add(lamp(f, withLights)); break;
    }
  }
  if (!withLights) group.traverse((o) => { if ((o as THREE.PointLight).isPointLight) o.visible = false; });

  const pickups = new Map<number, PickupVisual>();
  for (const k of PICKUPS) {
    const v = pickupVisual(k.x, k.y, k.z, quality === "high");
    pickups.set(k.id, v);
    group.add(v.root);
  }
  return { group, dome, blinkers, pickups };
}
