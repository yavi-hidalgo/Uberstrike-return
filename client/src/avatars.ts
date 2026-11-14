// Jugadores remotos: robot animado (modelo CC0 de Quaternius) teñido por jugador.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MAX_HP, PLAYER_HEIGHT } from "../../shared/src/constants";
import { softSprite } from "./textures";

const PLAYER_COLORS = [0xd94b3b, 0x3b7dd9, 0x3fae5a, 0xe0a83a, 0x9a5ad9, 0x2fb8b0, 0xd95aa8, 0xe8e8e8];

let template: GLTF | null = null;
let templateScale = 1;

export async function loadAvatarModel(url: string): Promise<void> {
  template = await new GLTFLoader().loadAsync(url);
  const box = new THREE.Box3().setFromObject(template.scene);
  const h = box.max.y - box.min.y;
  templateScale = h > 0 ? (PLAYER_HEIGHT * 0.98) / h : 1;
}

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

  constructor(readonly id: number, name: string) {
    this.name = name;
    const color = new THREE.Color(PLAYER_COLORS[id % PLAYER_COLORS.length]);
    if (template) {
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
    this.weaponHolder.position.set(0.24, 1.08, -0.15);
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
  }

  update(dt: number) {
    if (this.dyingUntil === 0) {
      this.tag.visible = true;
      if (Math.abs(this.vy) > 1.2) this.play("Jump", 0.15);
      else if (this.speed > 4.5) this.play("Running");
      else if (this.speed > 0.6) this.play("Walking");
      else this.play("Idle");
    }
    this.mixer?.update(dt);
  }

  revive() {
    this.dyingUntil = 0;
    this.hasPose = false;
    this.current = null;
    this.actions.forEach((a) => a.stop());
    this.play("Idle", 0);
  }
}
