// Jugadores remotos: soldados de Sketchfab (CC BY) animados por código encima de su pose de reposo.
// Si no cargan, se usa el robot animado (CC0, Quaternius).
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MAX_HP, PLAYER_HEIGHT } from "../../shared/src/constants";
import { softSprite } from "./textures";
import { LEGACY_SKINS, type Look } from "../../shared/src/gear";
import { buildCharacter, loadSkin, type Character } from "./skins";

const PLAYER_COLORS = [0xd94b3b, 0x3b7dd9, 0x3fae5a, 0xe0a83a, 0x9a5ad9, 0x2fb8b0, 0xd95aa8, 0xe8e8e8];

let template: GLTF | null = null;
let templateScale = 1;

export async function loadAvatarModel(url: string): Promise<void> {
  template = await new GLTFLoader().loadAsync(url);
  const box = new THREE.Box3().setFromObject(template.scene);
  const h = box.max.y - box.min.y;
  templateScale = h > 0 ? (PLAYER_HEIGHT * 0.98) / h : 1;
}

// ---------- Soldados ----------
interface SoldierTemplate { gltf: GLTF; scale: number; offset: THREE.Vector3; hasGun: boolean }
const soldiers: (SoldierTemplate | undefined)[] = [];

/** Carga los soldados. `hasGun`: el modelo ya trae su rifle en las manos. */
export async function loadSoldierModels(list: { url: string; hasGun: boolean }[]): Promise<void> {
  const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(list.map(async ({ url, hasGun }, index) => {
    try {
      const gltf = await loader.loadAsync(url);
      // Tamaño en la pose de reposo (con los huesos aplicados)
      const mixer = new THREE.AnimationMixer(gltf.scene);
      if (gltf.animations[0]) { mixer.clipAction(gltf.animations[0]).play(); mixer.setTime(0.5); }
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
      soldiers[index] = { gltf, scale, offset, hasGun };
    } catch (e) {
      console.warn("No se pudo cargar un soldado", url, e);
    }
  }));
}

interface Legs { thighL: THREE.Bone; thighR: THREE.Bone; kneeL: THREE.Bone | null; kneeR: THREE.Bone | null }

function makeTag(name: string, hp: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 72;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 30px 'Saira Condensed', 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(name, 128, 24);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, 128, 24);
  const w = 150, x = 128 - w / 2, y = 50;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 2, y - 2, w + 4, 12);
  const f = Math.max(0, Math.min(1, hp / MAX_HP));
  ctx.fillStyle = f > 0.6 ? "#4ade80" : f > 0.3 ? "#facc15" : "#ef4444";
  ctx.fillRect(x, y, w * f, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Reutilizados en cada cuadro por la animación de piernas
const AXIS_X = new THREE.Vector3(1, 0, 0);
const LEG_Q = new THREE.Quaternion();

type Anim = "Idle" | "Walking" | "Running" | "Jump" | "Death";

export class Avatar {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<Anim, THREE.AnimationAction>();
  private current: Anim | null = null;
  private tag: THREE.Sprite;
  private tagHp = -1;
  private last = new THREE.Vector3();
  private speed = 0;
  private vy = 0;
  private hasPose = false;
  dyingUntil = 0;
  name: string;
  weaponId = "";
  private weaponHolder = new THREE.Group();
  private legs: Legs | null = null;
  private stride = 0;
  private body: THREE.Object3D | null = null;
  private fallT = 0;
  /** Skin nueva con esqueleto posado por código (y su equipo). */
  private char: Character | null = null;

  constructor(readonly id: number, name: string, look?: Look) {
    this.name = name;
    const color = new THREE.Color(PLAYER_COLORS[id % PLAYER_COLORS.length]);
    const legacy = look ? LEGACY_SKINS.indexOf(look.skin) : id % 3;
    const soldier = legacy >= 0 ? soldiers[legacy] : undefined;
    if (look && legacy < 0) {
      // Skin nueva: se carga en segundo plano y aparece al estar lista
      const body = new THREE.Group();
      this.body = body;
      this.group.add(body);
      this.weaponHolder.visible = true;
      void loadSkin(look.skin).then(() => {
        const ch = buildCharacter(look.skin);
        if (!ch) return;
        this.char = ch;
        body.add(ch.body);
        void ch.setGear(look);
      });
    } else if (soldier) {
      const t = soldier;
      const model = SkeletonUtils.clone(t.gltf.scene) as THREE.Object3D;
      model.scale.multiplyScalar(t.scale);
      model.position.copy(t.offset);
      const body = new THREE.Group();
      body.add(model);
      body.rotation.y = Math.PI; // los soldados miran hacia +Z; el juego usa -Z
      this.body = body;
      this.group.add(body);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // la caja de los modelos con esqueleto no se actualiza al animar
      });
      this.mixer = new THREE.AnimationMixer(model);
      const idle = t.gltf.animations[0];
      if (idle) {
        const a = this.mixer.clipAction(idle);
        a.time = Math.random() * idle.duration; // que no respiren todos a la vez
        a.play();
        this.actions.set("Idle", a);
        this.current = "Idle";
      }
      const bone = (re: RegExp) => { let f: THREE.Bone | null = null; model.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o as THREE.Bone; }); return f as THREE.Bone | null; };
      const thighL = bone(/(LeftUpLeg|L_Thigh)/), thighR = bone(/(RightUpLeg|R_Thigh)/);
      if (thighL && thighR) this.legs = { thighL, thighR, kneeL: bone(/(LeftLeg|L_Calf)/), kneeR: bone(/(RightLeg|R_Calf)/) };
      this.weaponHolder.visible = !t.hasGun; // si el soldado ya trae su rifle, no ponemos otro
    } else if (template) {
      const model = SkeletonUtils.clone(template.scene) as THREE.Object3D;
      model.scale.setScalar(templateScale);
      model.rotation.y = Math.PI; // el modelo mira hacia +Z; el juego usa -Z
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const tinted = mats.map((mat) => {
          const c = (mat as THREE.MeshStandardMaterial).clone();
          if (c.name === "Main") { c.color = color.clone(); c.roughness = 0.45; c.metalness = 0.35; }
          if (c.name === "Grey") { c.roughness = 0.5; c.metalness = 0.6; }
          return c;
        });
        m.material = Array.isArray(m.material) ? tinted : tinted[0];
      });
      this.group.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of template.animations) {
        const n = clip.name as Anim;
        if (["Idle", "Walking", "Running", "Jump", "Death"].includes(n)) {
          const a = this.mixer.clipAction(clip);
          if (n === "Jump" || n === "Death") { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
          this.actions.set(n, a);
        }
      }
      this.play("Idle", 0);
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 10), new THREE.MeshStandardMaterial({ color }));
      body.position.y = 0.9;
      body.castShadow = true;
      this.group.add(body);
    }
    // Sombra de contacto suave
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ map: softSprite("rgba(0,0,0,0.5)"), transparent: true, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.group.add(blob);

    // El arma va sujeta a la altura del pecho y apunta hacia donde mira el jugador
    this.weaponHolder.position.set(look && legacy < 0 ? 0.15 : 0.24, 1.08, -0.15);
    this.group.add(this.weaponHolder);

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeTag(name, MAX_HP), depthTest: true, transparent: true }));
    this.tag.scale.set(1.5, 0.42, 1);
    this.tag.position.y = PLAYER_HEIGHT + 0.45;
    this.group.add(this.tag);
  }

  private play(name: Anim, fade = 0.2) {
    if (this.current === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    next.reset().play();
    const prev = this.current ? this.actions.get(this.current) : null;
    if (prev) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }

  setWeaponModel(o: THREE.Object3D) {
    this.weaponHolder.clear();
    const len = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).z;
    o.position.z -= len * 0.3; // la culata cerca del hombro
    o.traverse((c) => { (c as THREE.Mesh).frustumCulled = true; });
    this.weaponHolder.add(o);
  }

  setName(name: string) {
    if (name === this.name) return;
    this.name = name;
    this.tagHp = -1;
  }

  setHp(hp: number) {
    const bucket = Math.round(hp / 5) * 5;
    if (bucket === this.tagHp) return;
    this.tagHp = bucket;
    const mat = this.tag.material;
    mat.map?.dispose();
    mat.map = makeTag(this.name, hp);
    mat.needsUpdate = true;
  }

  setPose(x: number, y: number, z: number, yaw: number, dt: number) {
    if (this.hasPose && dt > 0) {
      const sp = Math.hypot(x - this.last.x, z - this.last.z) / dt;
      this.speed += (sp - this.speed) * Math.min(1, dt * 10);
      this.vy += ((y - this.last.y) / dt - this.vy) * Math.min(1, dt * 12);
    }
    this.hasPose = true;
    this.last.set(x, y, z);
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  die() {
    this.dyingUntil = performance.now() + 2200;
    this.play("Death", 0.1);
    this.tag.visible = false;
    this.fallT = 0.0001;
  }

  /** Paso de caminar/correr y salto, sumados a la pose que dejó la animación de reposo. */
  private animateLegs(dt: number) {
    if (this.char) { this.char.update(dt, this.speed, Math.abs(this.vy) > 1.2); return; }
    if (!this.legs) return;
    const airborne = Math.abs(this.vy) > 1.2;
    const sp = Math.min(this.speed, 8);
    this.stride += dt * (2 + sp * 1.1);
    const amp = airborne ? 0 : Math.min(0.6, sp * 0.08);
    const s = Math.sin(this.stride * Math.PI);
    const rot = (b: THREE.Bone | null, a: number) => { if (b && a) b.quaternion.multiply(LEG_Q.setFromAxisAngle(AXIS_X, a)); };
    const tuck = airborne ? 0.5 : 0;
    rot(this.legs.thighL, s * amp + tuck);
    rot(this.legs.thighR, -s * amp + tuck * 0.6);
    rot(this.legs.kneeL, -(Math.max(0, -s) * amp * 1.4 + tuck * 1.2));
    rot(this.legs.kneeR, -(Math.max(0, s) * amp * 1.4 + tuck));
    // pequeño rebote del cuerpo al caminar
    if (this.body) this.body.position.y = -Math.abs(Math.cos(this.stride * Math.PI)) * amp * 0.06;
  }

  /** Caída al morir: el cuerpo se inclina hacia atrás y cae al suelo. */
  private animateFall(dt: number) {
    if (!this.body || this.fallT <= 0) return;
    this.fallT = Math.min(1, this.fallT + dt * 2.2);
    const e = this.fallT * this.fallT;
    this.body.rotation.x = e * (Math.PI / 2 - 0.1);
    this.body.position.y = -e * 0.15;
  }

  update(dt: number) {
    if (this.body) {
      this.mixer?.update(dt);
      if (this.dyingUntil === 0) { this.tag.visible = true; this.animateLegs(dt); }
      else this.animateFall(dt);
      return;
    }
    if (this.dyingUntil === 0) {
      this.tag.visible = true;
      if (Math.abs(this.vy) > 1.2) this.play("Jump", 0.15);
      else if (this.speed > 4.5) this.play("Running");
      else if (this.speed > 0.6) this.play("Walking");
      else this.play("Idle");
    }
    this.mixer?.update(dt);
  }

  /** Libera lo propio de este jugador (la textura del nombre). Modelos y materiales se comparten. */
  dispose() {
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
  }

  revive() {
    this.dyingUntil = 0;
    this.hasPose = false;
    this.fallT = 0;
    if (this.body) {
      this.body.rotation.x = 0;
      this.body.position.y = 0;
      return;
    }
    this.current = null;
    this.actions.forEach((a) => a.stop());
    this.play("Idle", 0);
  }
}
