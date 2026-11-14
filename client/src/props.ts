// Modelos 3D reales (Poly Haven, CC0): objetos del mapa, árboles, rocas, farolas y la pistola.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { MAP_BOXES, MAP_FEATURES, PROPS, SCENERY, type Prop } from "../../shared/src/map";
import { softSprite } from "./textures";

const MODEL_FILES = [
  "Barrel_01", "barrel_03", "metal_jerrycan", "portable_generator", "utility_box_01", "utility_box_02",
  "metal_tool_chest", "barrel_stove", "wooden_crate_01", "Lantern_01", "street_lamp_02",
  "rock_09", "stone_01", "fir_sapling", "service_pistol",
] as const;

const models = new Map<string, THREE.Object3D>();

export async function loadPropModels(): Promise<void> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(MODEL_FILES.map(async (name) => {
    try {
      const g = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/models/${name}.glb`);
      g.scene.updateMatrixWorld(true);
      models.set(name, g.scene);
    } catch (e) {
      console.warn(`No se pudo cargar ${name}`, e);
    }
  }));
}

/** Copia de un modelo; "nombre#n" toma solo la variante n (hijo n) y la centra en el origen. */
function instance(key: string): THREE.Object3D | null {
  const [name, variant] = key.split("#");
  const src = models.get(name);
  if (!src) return null;
  if (variant === undefined) return src.clone(true);
  const child = src.children[Number(variant)];
  if (!child) return null;
  const c = child.clone(true);
  c.position.set(0, 0, 0);
  const g = new THREE.Group();
  g.add(c);
  return g;
}

function shadows(o: THREE.Object3D, cast: boolean, receive = true) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = cast;
    m.receiveShadow = receive;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      // Las hojas usan transparencia por recorte: así proyectan sombra con su forma
      if (sm.alphaMap || sm.transparent) { sm.alphaTest = 0.4; sm.transparent = false; sm.side = THREE.DoubleSide; }
    }
  });
}

function warmLight(parent: THREE.Object3D, x: number, y: number, z: number, intensity: number, distance: number, withLight: boolean) {
  if (withLight) {
    const l = new THREE.PointLight(0xffc27a, intensity, distance, 2);
    l.position.set(x, y, z);
    parent.add(l);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite("rgba(255,200,130,0.5)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glow.position.set(x, y, z);
  glow.scale.setScalar(1.1);
  parent.add(glow);
}

function place(group: THREE.Group, p: Prop, quality: string, castShadow: boolean) {
  const o = instance(p.model);
  if (!o) return;
  if (p.model.startsWith("fir_sapling")) {
    // `scale` = altura deseada
    const h = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y || 1;
    o.scale.setScalar((p.scale as number) / h);
  } else if (Array.isArray(p.scale)) {
    o.scale.set(...p.scale);
  } else if (p.scale) {
    o.scale.setScalar(p.scale);
  }
  o.position.set(p.x, p.y ?? 0, p.z);
  o.rotation.y = p.rot ?? 0;
  shadows(o, castShadow);
  group.add(o);
  if (p.light) warmLight(group, p.x, (p.y ?? 0) + 0.17, p.z, 2.2, 5, quality !== "low");
}

/** Coloca todos los modelos. Devuelve el grupo para añadirlo a la escena. */
export function buildProps(quality: "low" | "medium" | "high"): THREE.Group {
  const group = new THREE.Group();
  for (const p of PROPS) place(group, p, quality, true);
  for (const p of SCENERY) {
    if (quality === "low" && p.model.startsWith("fir") && Math.random() < 0.4) continue;
    place(group, p, quality, quality === "high");
  }

  // Rocas de la arena: roca escaneada ajustada al tamaño exacto de su colisión
  for (const b of MAP_BOXES) {
    if (b.kind !== "rock" || b.hidden) continue;
    const o = instance("rock_09");
    if (!o) continue;
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    // el modelo es más largo en Z: lo giramos si la caja es más larga en X
    const turn = w > d;
    if (turn) o.rotation.y = Math.PI / 2;
    o.scale.set((turn ? d : w) / size.x, h / size.y, (turn ? w : d) / size.z);
    const center = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    o.position.set((b.min[0] + b.max[0]) / 2 - center.x, b.min[1] - new THREE.Box3().setFromObject(o).min.y, (b.min[2] + b.max[2]) / 2 - center.z);
    shadows(o, true);
    o.userData.replacesRock = true;
    group.add(o);
  }

  // Farolas: el farol clásico va montado sobre los postes del mapa
  for (const f of MAP_FEATURES) {
    if (f.type !== "lamp") continue;
    const o = instance("street_lamp_02");
    if (!o) continue;
    const away = Math.atan2(f.x, f.z); // el brazo apunta hacia fuera del centro
    o.position.set(f.x, 2.7 + 0.4, f.z);
    o.rotation.y = away;
    shadows(o, true, false);
    group.add(o);
    const head = new THREE.Vector3(0, 1.0, 0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), away);
    warmLight(group, f.x + head.x, 3.1 + head.y, f.z + head.z, 9, 13, quality !== "low");
  }
  return group;
}

/** Pistola para primera persona: la variante con cachas de madera, sin cargadores sueltos. */
export function pistolModel(): THREE.Object3D | null {
  const src = models.get("service_pistol");
  if (!src) return null;
  const g = new THREE.Group();
  for (const c of src.children) {
    if (/_a$/.test(c.name) && !/magazine|bullet/.test(c.name)) g.add(c.clone(true));
  }
  if (g.children.length === 0) return null;
  // Centrar en el origen (el modelo trae las dos variantes separadas)
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((ch) => ch.position.sub(new THREE.Vector3(c.x, box.min.y, c.z)));
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return g;
}

/** ¿Hay modelos cargados? (si fallan, el mapa conserva sus versiones generadas por código). */
export function hasModel(name: string): boolean {
  return models.has(name);
}
