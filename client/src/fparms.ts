// Brazos animados en primera persona (packs de Sketchfab con esqueleto y animaciones).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { WeaponModel } from "../../shared/src/weapons";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

type Clip = "idle" | "walk" | "run" | "fire" | "reload" | "draw";

/** Busca la primera animación cuyo nombre encaje con alguno de los patrones (en orden de preferencia). */
function pick(clips: THREE.AnimationClip[], ...patterns: RegExp[]): THREE.AnimationClip | undefined {
  for (const re of patterns) {
    const c = clips.find((x) => re.test(x.name));
    if (c) return c;
  }
  return undefined;
}

export class ArmsViewModel {
  readonly group = new THREE.Group(); // en el espacio de la cámara del arma
  readonly muzzle = new THREE.Object3D();
  readonly ejector = new THREE.Object3D();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private loop: Clip = "idle";
  private oneShot: Clip | null = null;

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], def: NonNullable<WeaponModel["arms"]>) {
    this.mixer = new THREE.AnimationMixer(model);
    const map: [Clip, THREE.AnimationClip | undefined][] = [
      ["idle", pick(clips, /idle/i)],
      ["walk", pick(clips, /walk/i)],
      ["run", pick(clips, /run/i)],
      ["fire", pick(clips, /shot_nosight/i, /shot|fire(?!_last)/i)],
      ["reload", pick(clips, /reload_full/i, /reload/i)],
      ["draw", pick(clips, /draw/i)],
    ];
    for (const [k, clip] of map) {
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (k === "fire" || k === "reload" || k === "draw") { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(k, a);
    }
    this.mixer.addEventListener("finished", (e) => {
      const done = [...this.actions.entries()].find(([, a]) => a === e.action)?.[0];
      if (done && done === this.oneShot) {
        this.oneShot = null;
        this.fadeTo(this.loop, 0.15);
      }
    });

    // Encuadre con el esqueleto en la pose de reposo: ojo entre los hombros, mirando a las manos
    const idle = this.actions.get("idle");
    idle?.play();
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    const bone = (re: RegExp) => { let f: THREE.Object3D | null = null; model.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o; }); return f as THREE.Object3D | null; };
    const wp = (o: THREE.Object3D | null) => (o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3());
    const shL = bone(/^(uparm_l|upperarm_l)/i), shR = bone(/^(uparm_r|upperarm_r)/i);
    const hL = bone(/^hand_l/i), hR = bone(/^hand_r/i);
    const sMid = wp(shL).add(wp(shR)).multiplyScalar(0.5), hMid = wp(hL).add(wp(hR)).multiplyScalar(0.5);
    const armLen = Math.max(1e-6, (wp(shL).distanceTo(wp(hL)) + wp(shR).distanceTo(wp(hR))) / 2);
    const k = def.arm / armLen;
    const fwd = hMid.clone().sub(sMid);
    fwd.y = 0;
    fwd.normalize();
    const eye = sMid.clone().add(new THREE.Vector3(0, armLen * def.up, 0)).addScaledVector(fwd, -armLen * def.back);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix
      .makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(0, 0, -1)))
      .multiply(new THREE.Matrix4().makeScale(k, k, k))
      .multiply(new THREE.Matrix4().makeTranslation(-eye.x, -eye.y, -eye.z));
    holder.add(model);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
    });
    this.group.add(holder);
    this.muzzle.position.set(...def.muzzle);
    this.ejector.position.set(def.muzzle[0] + 0.05, def.muzzle[1] + 0.04, def.muzzle[2] * 0.45);
    this.group.add(this.muzzle, this.ejector);
  }

  static async load(def: WeaponModel): Promise<ArmsViewModel | null> {
    if (!def.arms) return null;
    try {
      const g = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/arms/${def.id}.glb`);
      return new ArmsViewModel(g.scene, g.animations, def.arms);
    } catch (e) {
      console.warn(`No se pudieron cargar los brazos de ${def.id}`, e);
      return null;
    }
  }

  private fadeTo(name: Clip, time: number) {
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next) return;
    for (const [k, a] of this.actions) if (a !== next && k !== name) a.fadeOut(time);
    next.reset().setEffectiveWeight(1).fadeIn(time).play();
  }

  private playOnce(name: Clip, durationS?: number) {
    const a = this.actions.get(name);
    if (!a) return false;
    this.oneShot = name;
    a.timeScale = durationS ? a.getClip().duration / durationS : 1;
    this.fadeTo(name, name === "fire" ? 0.03 : 0.1);
    return true;
  }

  fire() { this.playOnce("fire"); }
  reload(durationS: number) { this.playOnce("reload", durationS); }
  draw() { this.playOnce("draw", 0.4); }

  /** Elige caminar, correr o quieto según la velocidad (si no hay una animación puntual en curso). */
  update(dt: number, speed: number, onGround: boolean) {
    const want: Clip = !onGround || speed < 0.5 ? "idle" : speed > 6.5 && this.actions.has("run") ? "run" : "walk";
    if (want !== this.loop) {
      this.loop = want;
      if (!this.oneShot) this.fadeTo(want, 0.2);
    }
    this.mixer.update(dt);
  }
}
