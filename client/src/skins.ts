// Personajes: skins con esqueleto y equipo (casco, chaleco, mochila) colocado sobre sus huesos.
//
// Las skins nuevas vienen en pose de descanso (brazos abiertos) y casi nunca traen animaciones útiles,
// así que se posan por código: los brazos se llevan a sujetar el arma y las piernas dan el paso.
// Todo se calcula en el espacio del modelo (mirando hacia +Z) a partir de la dirección real de cada
// hueso, por lo que funciona con cualquier esqueleto humanoide sin depender de sus ejes locales.
import * as THREE from "three";
import { ktx2Loader } from "./ktx";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { PLAYER_HEIGHT } from "../../shared/src/constants";
import { gearItem, type Look } from "../../shared/src/gear";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setKTX2Loader(ktx2Loader);

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

export function loadGearModel(id: string): Promise<THREE.Object3D | null> { return loadGear(id); }

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
  /**
   * Pone el arma en las manos: la mano derecha en la empuñadura y la izquierda en el guardamanos
   * (o junto a la derecha en pistolas y armas blancas). El arma debe venir con el cañón hacia -Z.
   */
  holdWeapon(o: THREE.Object3D | null, kind: WeaponHold): void;
  /** Pasa a la postura de tiro durante unos segundos (por ejemplo, al disparar). */
  aim(seconds?: number): void;
}

export type WeaponHold = "rifle" | "pistol" | "melee";

const find = (root: THREE.Object3D, re: RegExp, not?: RegExp): THREE.Bone | null => {
  let f: THREE.Bone | null = null;
  root.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name) && !(not && not.test(o.name))) f = o as THREE.Bone; });
  return f;
};

/**
 * Puntos de agarre de un arma (en su propio espacio: cañón o punta hacia -Z), medidos sobre su malla:
 *  - grip: empuñadura (la parte que sobresale hacia abajo detrás del cargador, o el mango);
 *  - fore: guardamanos, donde va la mano izquierda;
 *  - stock: final de la culata, que se apoya en el hombro;
 *  - grip2: segunda mano en armas blancas largas.
 */
export function gripPoints(o: THREE.Object3D, kind: WeaponHold) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
  const N = 40, low = new Array<number>(N).fill(Infinity), high = new Array<number>(N).fill(-Infinity);
  const v = new THREE.Vector3();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    const pos = m.isMesh ? m.geometry.getAttribute("position") : null;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const k = Math.min(N - 1, Math.max(0, Math.floor(((v.z - box.min.z) / size.z) * N)));
      if (v.y < low[k]) low[k] = v.y;
      if (v.y > high[k]) high[k] = v.y;
    }
  });
  const zAt = (k: number) => box.min.z + ((k + 0.5) / N) * size.z; // k = 0 en la boca del cañón
  const kOf = (f: number) => Math.min(N - 1, Math.max(0, Math.floor(f * N)));
  const midY = (k: number) => (Number.isFinite(low[k]) ? (low[k] + high[k]) / 2 : box.min.y + size.y / 2);
  const lowest = (f0: number, f1: number) => {
    let best = -1;
    for (let k = kOf(f0); k <= kOf(f1); k++) if (Number.isFinite(low[k]) && (best < 0 || low[k] < low[best] - 1e-4)) best = k;
    return best < 0 ? kOf((f0 + f1) / 2) : best;
  };
  const body = box.min.y + size.y * 0.62; // altura del cajón del arma
  if (kind === "melee") {
    const long = size.z > 0.75;
    const kG = kOf(1 - (long ? 0.17 : Math.max(0.06, 0.1 * size.z)) / size.z);
    const grip = new THREE.Vector3(0, midY(kG), zAt(kG));
    const kG2 = kOf(1 - 0.06 / size.z);
    return { grip, grip2: long ? new THREE.Vector3(0, midY(kG2), zAt(kG2)) : null, fore: null, stock: grip };
  }
  if (kind === "pistol") {
    const kG = lowest(0.55, 0.97);
    const grip = new THREE.Vector3(0, (low[kG] + body) / 2, zAt(kG));
    return { grip, grip2: null, fore: null, stock: grip };
  }
  // rifle: la empuñadura es lo más bajo entre el 55 % y el 86 % del largo (desde la boca)
  const kG = lowest(0.55, 0.86);
  const grip = new THREE.Vector3(0, (low[kG] + body) / 2, zAt(kG));
  const kF = Math.max(kOf(0.12), kOf((grip.z - box.min.z - Math.min(0.36, size.z * 0.42)) / size.z));
  const fore = new THREE.Vector3(0, (Number.isFinite(low[kF]) ? low[kF] : box.min.y + size.y * 0.4) + 0.012, zAt(kF));
  let kS = N - 1;
  while (kS > 0 && !Number.isFinite(low[kS])) kS--;
  const stock = new THREE.Vector3(0, midY(kS), box.max.z - 0.01);
  return { grip, grip2: null, fore, stock };
}

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
  const aim = (bone: THREE.Bone | null, child: THREE.Object3D | null, dir: THREE.Vector3) => {
    if (!bone || !child) return;
    body.updateMatrixWorld(true);
    const cur = wp(child).sub(wp(bone)).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
    const target = delta.multiply(wq(bone));
    bone.quaternion.copy(wq(bone.parent!).invert().multiply(target));
  };
  /** Gira un hueso alrededor de un eje del espacio del modelo. */
  const turnBone = (bone: THREE.Object3D | null, axis: THREE.Vector3, angle: number) => {
    if (!bone || !angle) return;
    body.updateMatrixWorld(true);
    const target = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle).multiply(wq(bone));
    bone.quaternion.copy(wq(bone.parent!).invert().multiply(target));
  };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

  // Postura de combate: el torso un poco inclinado hacia delante
  turnBone(chest, X, 0.07);

  // Dedos de cada mano: cadenas de falanges (pulgar, índice, medio, anular, meñique)
  type Fingers = Partial<Record<"thumb" | "index" | "middle" | "ring" | "pinky", THREE.Bone[]>>;
  const fingersOf = (hand: THREE.Bone | null): Fingers => {
    const res: Fingers = {};
    if (!hand) return res;
    for (const c of hand.children) {
      const m = /thumb|index|middle|ring|pinky/i.exec(c.name);
      if (!(c as THREE.Bone).isBone || !m) continue;
      const chain: THREE.Bone[] = [];
      let b: THREE.Object3D | undefined = c;
      while (b && (b as THREE.Bone).isBone && chain.length < 4) {
        chain.push(b as THREE.Bone);
        b = b.children.find((x) => (x as THREE.Bone).isBone && !SEG.test(x.name));
      }
      res[m[0].toLowerCase() as keyof Fingers] = chain;
    }
    return res;
  };
  const fingR = fingersOf(handR), fingL = fingersOf(handL);

  // Pose de descanso de brazos, manos, dedos y cabeza: cada agarre parte siempre de ella
  const posed = [chest, upR, foreR, handR, upL, foreL, handL, head, ...Object.values(fingR).flat(), ...Object.values(fingL).flat()]
    .filter((b): b is THREE.Bone => !!b);
  const rest = new Map(posed.map((b) => [b, b.quaternion.clone()]));
  const resetPose = () => { for (const [b, q] of rest) b.quaternion.copy(q); };

  // ---- Brazos: cinemática inversa de dos huesos (hombro, codo, muñeca) ----
  const armLen = (up: THREE.Bone | null, fore: THREE.Bone | null, hand: THREE.Bone | null) =>
    up && fore && hand ? [wp(fore).distanceTo(wp(up)), wp(hand).distanceTo(wp(fore))] : [0, 0];
  const lenR = armLen(upR, foreR, handR), lenL = armLen(upL, foreL, handL);
  /** Lleva la muñeca a `target` doblando el codo hacia `pole` (todo en el espacio del modelo). */
  const reach = (up: THREE.Bone | null, fore: THREE.Bone | null, hand: THREE.Bone | null, [a, b]: number[], target: THREE.Vector3, pole: THREE.Vector3) => {
    if (!up || !fore || !hand || !a || !b) return;
    body.updateMatrixWorld(true);
    const S = wp(up);
    const toT = target.clone().sub(S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const u = toT.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const perp = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const elbow = S.clone().addScaledVector(u, a * cosA).addScaledVector(perp, a * Math.sqrt(1 - cosA * cosA));
    aim(up, fore, elbow.clone().sub(S));
    aim(fore, hand, S.addScaledVector(u, d).sub(elbow));
  };

  /** Orienta la mano: `f` hacia donde apuntan los nudillos (muñeca → dedo medio) y `s` del índice al meñique. */
  const orientHand = (hand: THREE.Bone | null, fg: Fingers, f: THREE.Vector3, sdir: THREE.Vector3) => {
    const mid = fg.middle?.[0] ?? fg.ring?.[0], ix = fg.index?.[0], pk = fg.pinky?.[0] ?? fg.ring?.[0];
    if (!hand || !mid || !ix || !pk) return;
    body.updateMatrixWorld(true);
    const H = wp(hand);
    const cf = wp(mid).sub(H).normalize();
    const cs = wp(pk).sub(wp(ix)); cs.addScaledVector(cf, -cs.dot(cf)).normalize();
    const tf = f.clone().normalize();
    const ts = sdir.clone().addScaledVector(tf, -sdir.dot(tf)).normalize();
    const mC = new THREE.Matrix4().makeBasis(cf, cs, cf.clone().cross(cs));
    const mT = new THREE.Matrix4().makeBasis(tf, ts, tf.clone().cross(ts));
    const delta = new THREE.Quaternion().setFromRotationMatrix(mT.multiply(mC.transpose()));
    const target = delta.multiply(wq(hand));
    hand.quaternion.copy(wq(hand.parent!).invert().multiply(target));
  };

  /** Cierra los dedos hacia la palma: ángulos (rad) por falange; `rest` para los dedos no nombrados. */
  const curl = (fg: Fingers, palm: THREE.Vector3, k: Partial<Record<keyof Fingers | "rest", number[]>>) => {
    for (const [name, chain] of Object.entries(fg) as [keyof Fingers, THREE.Bone[]][]) {
      const ang = k[name] ?? k.rest ?? [];
      chain.forEach((b, j) => {
        body.updateMatrixWorld(true);
        const next = chain[j + 1];
        const d = next ? wp(next).sub(wp(b)) : wp(b).sub(wp(chain[j - 1] ?? b.parent!));
        const axis = d.normalize().cross(palm);
        if (axis.lengthSq() > 1e-6) turnBone(b, axis, ang[j] ?? 0);
      });
    }
  };

  /** Brazos de reposo sin arma. */
  const defaultArms = () => {
    aim(upR, foreR, new THREE.Vector3(-0.2, -0.9, 0.34));
    aim(foreR, handR, new THREE.Vector3(0.12, -0.25, 0.96));
    aim(upL, foreL, new THREE.Vector3(-0.22, -0.6, 0.77));
    aim(foreL, handL, new THREE.Vector3(-0.5, -0.02, 0.86));
  };
  defaultArms();
  body.updateMatrixWorld(true);

  // ---- Arma en las manos: dos posturas que se mezclan ----
  //  - "carry": de pie y relajado, el arma cruzada delante del cuerpo (culata junto a la cadera derecha,
  //    mano izquierda en el guardamanos frente al pecho, cañón hacia delante y a la izquierda);
  //  - "aim": al disparar, culata al hombro y torso de perfil.
  type PoseSnap = { q: Map<THREE.Bone, THREE.Quaternion>; gp: THREE.Vector3; gq: THREE.Quaternion };
  let held: THREE.Group | null = null;
  let snaps: { carry: PoseSnap; aim: PoseSnap } | null = null;
  let aimT = 0, aimUntil = 0, clock = 0;

  /** Base ortonormal del arma: cañón hacia `fw`, parte de arriba lo más cerca posible de `upHint`. */
  const weaponQuat = (fw: THREE.Vector3, upHint: THREE.Vector3) => {
    const f = fw.clone().normalize();
    const u = upHint.clone().addScaledVector(f, -upHint.dot(f)).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u.clone().cross(f), u, f));
  };

  /** Coloca el arma y resuelve brazos, manos, dedos, torso y cabeza para una postura. */
  const solvePose = (o: THREE.Object3D, g: THREE.Group, pts: ReturnType<typeof gripPoints>, kind: WeaponHold, mode: "carry" | "aim"): PoseSnap => {
    resetPose();
    const carry = mode === "carry";
    // torso de perfil al apuntar con rifle (el hombro izquierdo adelante); de frente al llevarla
    const twist = carry ? (kind === "rifle" ? -0.08 : 0) : kind === "rifle" ? -0.3 : kind === "melee" ? -0.15 : 0;
    turnBone(chest, Y, twist);
    const shoulder = upR ? wp(upR) : new THREE.Vector3(-0.19, 1.42, 0);
    if (kind === "rifle" && carry) {
      // empuñadura junto a la cadera derecha, el arma cruzada en diagonal hacia arriba y a la izquierda
      o.position.copy(pts.grip).negate();
      g.position.set(shoulder.x + 0.05, shoulder.y - 0.43, 0.2);
      g.quaternion.copy(weaponQuat(new THREE.Vector3(0.62, 0.3, 0.73), new THREE.Vector3(-0.25, 1, -0.15)));
    } else if (kind === "rifle") {
      o.position.copy(pts.stock).negate();
      g.position.copy(shoulder).add(new THREE.Vector3(0.07, -0.07, 0.15));
      g.quaternion.setFromEuler(new THREE.Euler(0.07, 0.06, 0, "YXZ"));
    } else if (kind === "pistol") {
      o.position.copy(pts.grip).negate();
      if (carry) { g.position.set(-0.06, shoulder.y - 0.4, 0.3); g.quaternion.setFromEuler(new THREE.Euler(0.55, 0.12, 0, "YXZ")); }
      else { g.position.set(-0.05, shoulder.y - 0.25, 0.42); g.quaternion.setFromEuler(new THREE.Euler(0.12, 0.05, 0, "YXZ")); }
    } else {
      o.position.copy(pts.grip).negate();
      g.position.set(-0.17, shoulder.y - 0.42, 0.27);
      g.quaternion.setFromEuler(new THREE.Euler(-1.0, 0.12, 0, "YXZ")); // la hoja hacia arriba y adelante
    }
    inner.updateMatrixWorld(true);
    const toModel = (p: THREE.Vector3) => inner.worldToLocal(o.localToWorld(p.clone())); // p en el espacio propio del arma
    // ejes del arma en el espacio del modelo
    const fw = Z.clone().applyQuaternion(g.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
    const rw = fw.clone().cross(up).normalize(); // a la derecha del arma
    const lw = rw.clone().negate();
    const v = (a: THREE.Vector3, ka: number, b: THREE.Vector3, kb: number, c?: THREE.Vector3, kc = 0) =>
      a.clone().multiplyScalar(ka).addScaledVector(b, kb).addScaledVector(c ?? a, c ? kc : 0).normalize();
    const gripM = toModel(pts.grip);
    // mano derecha: nudillos hacia delante y abajo, del índice (gatillo) al meñique hacia abajo
    const fR = kind === "melee" ? v(Z.clone().addScaledVector(fw, -Z.dot(fw)), 1, lw, 0.3) : v(fw, 0.88, up, -0.42, lw, 0.15);
    const sR = kind === "melee" ? fw.clone().negate() : v(up, -0.95, fw, -0.3);
    const palmR = fR.clone().cross(sR).normalize();
    const poleR = carry ? new THREE.Vector3(-0.45, -1, -0.55) : kind === "rifle" ? new THREE.Vector3(-0.5, -1, -0.05) : new THREE.Vector3(-0.6, -1, -0.2);
    reach(upR, foreR, handR, lenR, gripM.clone().addScaledVector(fR, -0.08).addScaledVector(palmR, -0.03), poleR);
    orientHand(handR, fingR, fR, sR);
    curl(fingR, palmR, kind === "melee"
      ? { thumb: [0.5, 0.45, 0.3], rest: [1.35, 1.45, 1.0] }
      : { thumb: [0.35, 0.3, 0.2], index: [0.25, 0.45, 0.35], rest: [1.3, 1.4, 0.9] });
    // mano izquierda
    let fL: THREE.Vector3, sL: THREE.Vector3, at: THREE.Vector3 | null = null, poleL = new THREE.Vector3(0.4, -1, 0.05);
    if (kind === "rifle") {
      // bajo el guardamanos, con la palma hacia arriba
      fL = v(fw, 0.8, rw, 0.55, up, 0.15); sL = fw.clone().negate();
      at = toModel(pts.fore!);
      if (carry) poleL = new THREE.Vector3(0.6, -1, -0.3);
      // si el brazo no llega, la mano se desliza por el guardamanos hacia la empuñadura
      if (upL && lenL[0]) {
        const sh = wp(upL), max = (lenL[0] + lenL[1]) * 0.94;
        const back = Math.max(0, at.distanceTo(gripM) - 0.13);
        for (let t = 0; t < back && at.clone().addScaledVector(fw, -t).addScaledVector(fL, -0.075).distanceTo(sh) > max; t += 0.01) at.addScaledVector(fw, -0.01);
      }
    } else if (kind === "pistol") {
      // envuelve la mano derecha desde la izquierda
      fL = v(fw, 0.6, rw, 0.6, up, -0.35); sL = v(up, -0.9, fw, -0.3);
      at = gripM.clone().addScaledVector(lw, 0.035).addScaledVector(up, -0.025);
      poleL = new THREE.Vector3(0.6, -1, carry ? -0.3 : 0);
    } else {
      fL = v(Z.clone().addScaledVector(fw, -Z.dot(fw)), 1, rw, 0.3); sL = fw.clone().negate();
      if (pts.grip2) at = toModel(pts.grip2);
      poleL = new THREE.Vector3(0.6, -1, -0.2);
    }
    const palmL = sL.clone().cross(fL).normalize();
    if (at) {
      reach(upL, foreL, handL, lenL, at.addScaledVector(fL, -0.075).addScaledVector(palmL, -0.035), poleL);
      orientHand(handL, fingL, fL, sL);
      curl(fingL, palmL, kind === "melee" ? { thumb: [0.5, 0.45, 0.3], rest: [1.35, 1.45, 1.0] } : kind === "pistol" ? { thumb: [0.3, 0.2, 0.1], rest: [1.2, 1.2, 0.8] } : { thumb: [0.4, 0.2, 0.1], rest: [1.0, 1.1, 0.8] });
    } else {
      // arma blanca de una mano: el brazo izquierdo suelto, un poco adelantado
      reach(upL, foreL, handL, lenL, new THREE.Vector3(0.24, shoulder.y - 0.55, 0.1), new THREE.Vector3(0.3, -0.2, -1));
      curl(fingL, new THREE.Vector3(-1, 0, 0.3).normalize(), { thumb: [0.2, 0.2, 0.1], rest: [0.45, 0.55, 0.4] });
    }
    // la cabeza sigue mirando al frente aunque el torso gire; al apuntar baja hacia la mira
    turnBone(head, Y, -twist);
    turnBone(head, X, carry ? 0.04 : kind === "rifle" ? 0.13 : 0.08);
    if (!carry && kind === "rifle") turnBone(head, Z, 0.07);
    return { q: new Map(posed.map((b) => [b, b.quaternion.clone()])), gp: g.position.clone(), gq: g.quaternion.clone() };
  };

  const applyBlend = (t: number) => {
    if (!snaps || !held) return;
    const { carry, aim } = snaps;
    for (const b of posed) {
      const a = carry.q.get(b), c = aim.q.get(b);
      if (a && c) b.quaternion.slerpQuaternions(a, c, t);
    }
    held.position.lerpVectors(carry.gp, aim.gp, t);
    held.quaternion.slerpQuaternions(carry.gq, aim.gq, t);
  };

  const holdWeapon = (o: THREE.Object3D | null, kind: WeaponHold) => {
    held?.removeFromParent();
    held = null; snaps = null;
    resetPose();
    if (!o) { defaultArms(); return; }
    const pts = gripPoints(o, kind);
    const g = new THREE.Group();
    const turn = new THREE.Group();
    turn.rotation.y = Math.PI; // el cañón pasa de -Z a +Z (el frente del modelo)
    o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    turn.add(o);
    g.add(turn);
    inner.add(g);
    held = g;
    const aimSnap = solvePose(o, g, pts, kind, "aim");
    const carrySnap = solvePose(o, g, pts, kind, "carry");
    // las dos posturas deben colocar el arma igual respecto al modelo (misma referencia)
    const oCarry = o.position.clone();
    snaps = { carry: carrySnap, aim: aimSnap };
    // el arma se ancla de forma distinta en cada postura: se expresa todo respecto a la misma referencia
    if (kind === "rifle") {
      // al apuntar se usó la culata como ancla; se convierte a la referencia de la empuñadura
      const shift = pts.grip.clone().sub(pts.stock).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0))).applyQuaternion(aimSnap.gq);
      aimSnap.gp.add(shift);
    }
    o.position.copy(oCarry);
    aimT = 0;
    applyBlend(0);
  };

  /** El personaje apunta durante `seconds` (luego vuelve a la postura relajada). */
  const aimFor = (seconds = 1.6) => { aimUntil = clock + seconds; };

  // ---- Piernas: giro alrededor del eje X del modelo sobre la pose de descanso ----
  const legs = [thighR, thighL].map((thigh, i) => {
    const calf = i === 0 ? calfR : calfL;
    if (!thigh) return null;
    return {
      thigh, calf,
      thighRest: wq(thigh), thighParentInv: wq(thigh.parent!).invert(),
      calfRest: calf ? wq(calf) : null,
    };
  });
  // reutilizados en cada cuadro (sin crear basura para el recolector)
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
  let stride = Math.random() * 2;
  const update = (dt: number, speed: number, airborne: boolean) => {
    clock += dt;
    if (snaps) {
      const target = clock < aimUntil ? 1 : 0;
      if (Math.abs(target - aimT) > 1e-3) {
        aimT += (target - aimT) * Math.min(1, dt * (target > aimT ? 12 : 4));
        applyBlend(aimT);
      }
    }
    const sp = Math.min(speed, 9);
    stride += dt * (2 + sp * 1.1);
    const amp = airborne ? 0 : Math.min(0.62, sp * 0.085);
    const s = Math.sin(stride * Math.PI);
    legs.forEach((leg, i) => {
      if (!leg) return;
      const sg = i === 0 ? 1 : -1;
      const tuck = airborne ? (i === 0 ? 0.5 : 0.3) : 0;
      // en guardia: pierna derecha un poco atrás, izquierda adelante y rodillas flexionadas
      // (al correr la zancada manda y la guardia desaparece)
      const guard = airborne ? 0 : 1 - Math.min(1, amp * 2.2);
      // ángulo positivo alrededor de X lleva la pierna hacia atrás; negativo, hacia delante
      const a = -(s * sg * amp + tuck) + (i === 0 ? 0.1 : -0.14) * guard;
      const thighW = qA.setFromAxisAngle(X, a).multiply(leg.thighRest);
      leg.thigh.quaternion.copy(leg.thighParentInv).multiply(thighW);
      if (leg.calf && leg.calfRest) {
        const bend = Math.max(0, s * sg) * amp * 1.5 + tuck * 1.6 + 0.22 * guard;
        const calfW = qB.setFromAxisAngle(X, a + bend).multiply(leg.calfRest);
        leg.calf.quaternion.copy(qC.copy(thighW).invert()).multiply(calfW);
      }
    });
    inner.position.y = -Math.abs(Math.cos(stride * Math.PI)) * amp * 0.05 - 0.02 * (airborne ? 0 : 1 - Math.min(1, amp * 2.2));
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

  return { body, update, setGear, holdWeapon, aim: aimFor };
}
