// Personajes: skins con esqueleto y equipo (casco, chaleco, mochila) colocado sobre sus huesos.
//
// Las skins nuevas vienen en pose de descanso (brazos abiertos) y casi nunca traen animaciones útiles,
// así que se posan por código: los brazos se llevan a sujetar el arma y las piernas dan el paso.
// Todo se calcula en el espacio del modelo (mirando hacia +Z) a partir de la dirección real de cada
// hueso, por lo que funciona con cualquier esqueleto humanoide sin depender de sus ejes locales.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { PLAYER_HEIGHT } from "../../shared/src/constants";
import { gearItem, type Look } from "../../shared/src/gear";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

interface SkinTemplate { gltf: GLTF; scale: number; offset: THREE.Vector3 }
const skins = new Map<string, Promise<SkinTemplate | null>>();
const ready = new Map<string, SkinTemplate>();
const gearCache = new Map<string, Promise<THREE.Object3D | null>>();

/** Ajustes por skin: `yaw` si el modelo no mira hacia +Z; `noGear` para piezas que no le calzan. */
const SKIN_FIX: Record<string, { yaw?: number; head?: number; chest?: number }> = {};

/**
 * Ajustes por pieza de equipo. Por defecto se asume que mira hacia +Z y se escala por su ancho.
 *  - yaw: giro para que mire al frente; scale: corrección de tamaño; dy/dz: desplazamiento (en "cabezas").
 *  - hide: partes que se ocultan (maniquíes); first: quedarse solo con las primeras n mallas.
 */
const GEAR_FIX: Record<string, { yaw?: number; scale?: number; dy?: number; dz?: number; hide?: RegExp; first?: number }> = {
  cc510a8975: { hide: /head_low/, dy: 0.25 },
  b0431f9c3c: { scale: 1.75, dy: 0.1 },
  "06be5c0f15": { yaw: Math.PI },
  "8d4ac12671": { first: 3, scale: 0.7, dy: -0.22, dz: 0.3 },
  b0b2ea8152: { hide: /Object_9/ },
  "10c5c86971": { scale: 0.62, dy: 0.02, dz: 0.5 },
  "94701874d8": { yaw: Math.PI },
};

export function loadSkin(id: string): Promise<SkinTemplate | null> {
  let p = skins.get(id);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}assets/skins/${id}.glb`).then((gltf) => {
      // Tamaño en la pose de descanso, con los huesos aplicados
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      gltf.scene.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (sm.isSkinnedMesh) { sm.computeBoundingBox(); box.union(sm.boundingBox!.clone().applyMatrix4(sm.matrixWorld)); }
        else if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
      });
      const h = box.max.y - box.min.y || 1;
      const scale = PLAYER_HEIGHT / h;
      const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).multiplyScalar(scale);
      const t = { gltf, scale, offset };
      ready.set(id, t);
      return t;
    }).catch((e) => { console.warn(`No se pudo cargar la skin ${id}`, e); return null; });
    skins.set(id, p);
  }
  return p;
}

export function skinReady(id: string): boolean { return ready.has(id); }

function loadGear(id: string): Promise<THREE.Object3D | null> {
  let p = gearCache.get(id);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}assets/gear/${id}.glb`).then((g) => {
      const fix = GEAR_FIX[id] ?? {};
      let n = 0;
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        n++;
        if ((fix.hide && fix.hide.test(m.name)) || (fix.first && n > fix.first)) m.visible = false;
      });
      // se quitan las partes ocultas para que no cuenten en el tamaño
      const gone: THREE.Object3D[] = [];
      g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.visible) gone.push(o); });
      gone.forEach((o) => o.removeFromParent());
      return g.scene;
    }).catch((e) => { console.warn(`No se pudo cargar el equipo ${id}`, e); return null; });
    gearCache.set(id, p);
  }
  return p;
}

export interface Character {
  /** Cuerpo del personaje, mirando hacia -Z (como el resto del juego). */
  body: THREE.Group;
  /** Avanza la animación de piernas. `speed` en m/s; `airborne` si está saltando o cayendo. */
  update(dt: number, speed: number, airborne: boolean): void;
  /** Quita el equipo actual y pone el del aspecto dado. */
  setGear(look: Look): Promise<void>;
}

const find = (root: THREE.Object3D, re: RegExp, not?: RegExp): THREE.Bone | null => {
  let f: THREE.Bone | null = null;
  root.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name) && !(not && not.test(o.name))) f = o as THREE.Bone; });
  return f;
};

/** Construye un personaje con la skin dada (debe estar cargada con `loadSkin`). */
export function buildCharacter(skinId: string): Character | null {
  const t = ready.get(skinId);
  if (!t) return null;
  const model = SkeletonUtils.clone(t.gltf.scene) as THREE.Object3D;
  model.scale.multiplyScalar(t.scale);
  model.position.copy(t.offset);
  // `inner` es el espacio del modelo: +Z al frente, +Y arriba, en metros
  const inner = new THREE.Group();
  inner.add(model);
  inner.rotation.y = SKIN_FIX[skinId]?.yaw ?? 0;
  const body = new THREE.Group();
  const facing = new THREE.Group();
  facing.rotation.y = Math.PI; // el juego mira hacia -Z
  facing.add(inner);
  body.add(facing);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // la caja de los modelos con esqueleto no se actualiza al animar
  });
  body.updateMatrixWorld(true);

  // Posición y giro de un objeto en el espacio del modelo (`inner`), esté o no el personaje en la escena
  const wp = (o: THREE.Object3D) => inner.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  const wq = (o: THREE.Object3D) => inner.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(o.getWorldQuaternion(new THREE.Quaternion()));

  // ---- Huesos (los nombres varían entre esqueletos; GLTFLoader quita puntos y dos puntos) ----
  const SEG = /segment|twist|roll|_ik|ik[LR_]|end|top|handle|bag/i;
  const side = (re: RegExp): [THREE.Bone | null, THREE.Bone | null] => {
    const all: THREE.Bone[] = [];
    model.traverse((o) => { if ((o as THREE.Bone).isBone && re.test(o.name) && !SEG.test(o.name)) all.push(o as THREE.Bone); });
    const x = (b: THREE.Bone) => wp(b).x;
    // derecha del personaje = -X (mira hacia +Z)
    const r = all.filter((b) => x(b) < 0).sort((a, b) => depth(a) - depth(b))[0] ?? null;
    const l = all.filter((b) => x(b) >= 0).sort((a, b) => depth(a) - depth(b))[0] ?? null;
    return [r, l];
  };
  const depth = (b: THREE.Object3D) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };
  const [upR, upL] = side(/(Left|Right)Arm$|(Left|Right)Arm_|[LR]_Arm|arm1[LR]|upper_?arm/i);
  const [foreR, foreL] = side(/ForeArm|[LR]_Elbow|arm2[LR]|lower_?arm|forearm/i);
  const [handR, handL] = side(/(Left|Right)Hand(?!.*(Thumb|Index|Middle|Ring|Pinky))|[LR]_Wrist|^wrist[LR]|hand[LR]/i);
  const [thighR, thighL] = side(/UpLeg|[LR]_Thigh|leg1[LR]|thigh/i);
  const [calfR, calfL] = side(/(Left|Right)Leg|[LR]_Knee|leg2[LR]|calf|shin/i);
  const head = find(model, /head/i, SEG);
  const chest = find(model, /Spine2|Spine_3|spine3/i) ?? find(model, /Spine1|Spine_2|spine2/i) ?? find(model, /spine|chest/i);

  /** Lleva un hueso a apuntar hacia `dir` (espacio del modelo), girando lo mínimo desde donde está. */
  const aim = (bone: THREE.Bone | null, child: THREE.Bone | null, dir: THREE.Vector3) => {
    if (!bone || !child) return;
    body.updateMatrixWorld(true);
    const cur = wp(child).sub(wp(bone)).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
    const target = delta.multiply(wq(bone));
    bone.quaternion.copy(wq(bone.parent!).invert().multiply(target));
  };
  // Pose de combate: la mano derecha en la empuñadura, la izquierda adelante sosteniendo el arma
  aim(upR, foreR, new THREE.Vector3(-0.2, -0.9, 0.34));
  aim(foreR, handR, new THREE.Vector3(0.12, -0.25, 0.96));
  aim(upL, foreL, new THREE.Vector3(-0.22, -0.6, 0.77));
  aim(foreL, handL, new THREE.Vector3(-0.5, -0.02, 0.86));
  body.updateMatrixWorld(true);

  // ---- Piernas: giro alrededor del eje X del modelo sobre la pose de descanso ----
  const legs = [thighR, thighL].map((thigh, i) => {
    const calf = i === 0 ? calfR : calfL;
    if (!thigh) return null;
    return {
      thigh, calf,
      thighRest: wq(thigh), thighParent: wq(thigh.parent!),
      calfRest: calf ? wq(calf) : null,
    };
  });
  const X = new THREE.Vector3(1, 0, 0);
  let stride = Math.random() * 2;
  const update = (dt: number, speed: number, airborne: boolean) => {
    const sp = Math.min(speed, 9);
    stride += dt * (2 + sp * 1.1);
    const amp = airborne ? 0 : Math.min(0.62, sp * 0.085);
    const s = Math.sin(stride * Math.PI);
    legs.forEach((leg, i) => {
      if (!leg) return;
      const sg = i === 0 ? 1 : -1;
      const tuck = airborne ? (i === 0 ? 0.5 : 0.3) : 0;
      // ángulo positivo alrededor de X lleva la pierna hacia atrás; negativo, hacia delante
      const a = -(s * sg * amp + tuck);
      const thighW = new THREE.Quaternion().setFromAxisAngle(X, a).multiply(leg.thighRest);
      leg.thigh.quaternion.copy(leg.thighParent.clone().invert().multiply(thighW));
      if (leg.calf && leg.calfRest) {
        const bend = Math.max(0, s * sg) * amp * 1.5 + tuck * 1.6;
        const calfW = new THREE.Quaternion().setFromAxisAngle(X, a + bend).multiply(leg.calfRest);
        leg.calf.quaternion.copy(thighW.clone().invert().multiply(calfW));
      }
    });
    inner.position.y = -Math.abs(Math.cos(stride * Math.PI)) * amp * 0.05;
  };

  // ---- Equipo ----
  // Medidas del cuerpo en la pose final, en el espacio del modelo
  const headPos = head ? wp(head) : new THREE.Vector3(0, PLAYER_HEIGHT - 0.22, 0);
  // alto de la cabeza; se acota porque algunas skins ya traen casco y su "cabeza" mide de más
  const headH = Math.min(0.25, Math.max(0.16, (PLAYER_HEIGHT - headPos.y) * (SKIN_FIX[skinId]?.head ?? 1)));
  const chestPos = chest ? wp(chest) : new THREE.Vector3(0, 1.25, 0);
  const shoulders = upR && upL ? Math.abs(wp(upL).x - wp(upR).x) : 0.38;
  const chestW = Math.max(0.3, shoulders * (SKIN_FIX[skinId]?.chest ?? 1));
  const holders: THREE.Object3D[] = [];
  let gearToken = 0;

  const place = async (id: string) => {
    const item = gearItem(id);
    const tpl = item ? await loadGear(id) : null;
    if (!item || !tpl) return null;
    const fix = GEAR_FIX[id] ?? {};
    const obj = tpl.clone(true);
    obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    const pivot = new THREE.Group();
    pivot.add(obj);
    pivot.rotation.y = fix.yaw ?? 0;
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(pivot);
    let k = 1; const at = new THREE.Vector3();
    if (item.slot === "helmet") {
      // el casco cubre la cabeza: se escala por el alto de la cabeza
      k = (headH * 1.62) / Math.max(size.y, size.x * 0.9) * (fix.scale ?? 1);
      at.set(headPos.x, headPos.y + headH * (0.56 + (fix.dy ?? 0)), headPos.z + headH * (0.08 + (fix.dz ?? 0)));
    } else if (item.slot === "vest") {
      k = (chestW * 1.42) / size.x * (fix.scale ?? 1);
      at.set(chestPos.x, chestPos.y - 0.03 + headH * (fix.dy ?? 0), chestPos.z + 0.02 + headH * (fix.dz ?? 0));
    } else {
      k = (chestW * 0.85) / size.x * (fix.scale ?? 1);
      at.set(chestPos.x, chestPos.y - 0.1 + headH * (fix.dy ?? 0), chestPos.z - 0.04 - (size.z * k) / 2 + headH * (fix.dz ?? 0));
    }
    pivot.scale.setScalar(k);
    pivot.position.copy(ctr).multiplyScalar(-k);
    holder.position.copy(at);
    // se cuelga del hueso conservando su posición en el mundo, para que acompañe al cuerpo
    inner.add(holder);
    inner.updateMatrixWorld(true);
    const bone = item.slot === "helmet" ? head : chest;
    if (bone) bone.attach(holder);
    return holder;
  };

  const setGear = async (look: Look) => {
    const token = ++gearToken;
    const made = await Promise.all([look.helmet, look.vest, look.pack].filter(Boolean).map(place));
    if (token !== gearToken) { made.forEach((h) => h?.removeFromParent()); return; }
    holders.splice(0).forEach((h) => h.removeFromParent());
    for (const h of made) if (h) holders.push(h);
  };

  return { body, update, setGear };
}
