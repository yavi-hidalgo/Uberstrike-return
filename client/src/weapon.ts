// Arma en primera persona (Kestrel AR-7, diseño original) y efectos de disparo.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bulletHoleSprite, flashSprite, softSprite } from "./textures";
import type { ArmsViewModel } from "./fparms";

const gunmetal = () => new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.85, roughness: 0.36 });
const polymerTan = () => new THREE.MeshStandardMaterial({ color: 0x8a7a5e, metalness: 0, roughness: 0.72 });
const polymerDark = () => new THREE.MeshStandardMaterial({ color: 0x1c1f23, metalness: 0.05, roughness: 0.68 });
const brass = () => new THREE.MeshStandardMaterial({ color: 0xc9953f, metalness: 1, roughness: 0.28 });

function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)), mat);
  m.position.set(x, y, z);
  return m;
}

/** Modelo del rifle. Mira hacia -Z; el origen está en la empuñadura. */
export function buildKestrel(): { group: THREE.Group; muzzle: THREE.Object3D; ejector: THREE.Object3D; reticle: THREE.Mesh } {
  const g = new THREE.Group();
  const gm = gunmetal(), tan = polymerTan(), dk = polymerDark(), br = brass();

  // Cajón de mecanismos
  g.add(rbox(0.062, 0.085, 0.3, 0.012, gm, 0, 0.045, -0.06));
  // Riel superior con dientes
  g.add(rbox(0.04, 0.012, 0.36, 0.003, gm, 0, 0.094, -0.1));
  const tooth = new THREE.BoxGeometry(0.044, 0.008, 0.007);
  const teeth = new THREE.InstancedMesh(tooth, gm, 22);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 22; i++) { m4.makeTranslation(0, 0.103, 0.07 - i * 0.016); teeth.setMatrixAt(i, m4); }
  g.add(teeth);
  // Guardamanos de polímero con ranuras de ventilación
  g.add(rbox(0.07, 0.074, 0.27, 0.014, tan, 0, 0.04, -0.34));
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) {
      g.add(rbox(0.006, 0.02, 0.032, 0.003, dk, s * 0.035, 0.04, -0.25 - i * 0.045));
    }
  }
  // Cañón y bocacha con ranuras
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 14), gm);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.048, -0.56);
  g.add(barrel);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 14), gm);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.048, -0.67);
  g.add(brake);
  for (const s of [-1, 1]) g.add(rbox(0.004, 0.012, 0.03, 0.002, dk, s * 0.018, 0.048, -0.67));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.048, -0.71);
  g.add(muzzle);
  // Empuñadura inclinada
  const grip = rbox(0.034, 0.11, 0.045, 0.01, dk, 0, -0.04, 0.03);
  grip.rotation.x = 0.28;
  g.add(grip);
  // Guardamonte
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 16, Math.PI), gm);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, 0.005, -0.03);
  g.add(guard);
  // Cargador curvo con ventana de balas
  const mag = new THREE.Group();
  mag.add(rbox(0.032, 0.13, 0.062, 0.008, dk, 0, -0.06, 0));
  mag.add(rbox(0.034, 0.1, 0.012, 0.003, new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.55 }), 0, -0.05, -0.026));
  for (let i = 0; i < 5; i++) {
    const round = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.028, 8), br);
    round.rotation.z = Math.PI / 2;
    round.position.set(0, -0.012 - i * 0.018, -0.022);
    mag.add(round);
  }
  mag.position.set(0, 0.0, -0.13);
  mag.rotation.x = -0.14;
  g.add(mag);
  // Culata ajustable
  g.add(rbox(0.05, 0.075, 0.2, 0.014, tan, 0, 0.035, 0.18));
  g.add(rbox(0.054, 0.09, 0.025, 0.008, dk, 0, 0.03, 0.29));
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 12), gm);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.06, 0.12);
  g.add(tube);
  // Palanca de carga y ventana de expulsión
  g.add(rbox(0.012, 0.012, 0.03, 0.003, gm, 0.034, 0.07, 0.06));
  g.add(rbox(0.004, 0.022, 0.06, 0.002, new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9 }), 0.032, 0.055, -0.07));
  const ejector = new THREE.Object3D();
  ejector.position.set(0.04, 0.06, -0.07);
  g.add(ejector);
  // Mira holográfica
  g.add(rbox(0.05, 0.016, 0.075, 0.004, gm, 0, 0.115, -0.02));
  for (const s of [-1, 1]) g.add(rbox(0.006, 0.055, 0.06, 0.003, gm, s * 0.026, 0.148, -0.02));
  g.add(rbox(0.058, 0.008, 0.06, 0.003, gm, 0, 0.178, -0.02));
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.046, 0.05),
    new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, depthWrite: false }),
  );
  glass.position.set(0, 0.148, -0.035);
  g.add(glass);
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.0028, 0.0042, 20),
    new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  reticle.position.set(0, 0.148, -0.034);
  g.add(reticle);
  // Linterna táctica bajo el guardamanos
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.07, 12), dk);
  torch.rotation.x = Math.PI / 2;
  torch.position.set(0.042, 0.02, -0.42);
  g.add(torch);
  return { group: g, muzzle, ejector, reticle };
}

interface Shell { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; floor: number }
interface Particle { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; max: number; grow: number; gravity: number }

/** Efectos de disparo en el mundo: casquillos, agujeros de bala, chispas y polvo. */
export class ShotEffects {
  private shells: Shell[] = [];
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private particles: Particle[] = [];
  private shellGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.025, 8);
  private shellMat = brass();
  private holeMat: THREE.MeshBasicMaterial;
  private sparkMat: THREE.SpriteMaterial;
  private dustTex = softSprite("rgba(255,255,255,0.8)");

  constructor(private scene: THREE.Scene, private maxDecals = 60) {
    this.holeMat = new THREE.MeshBasicMaterial({
      map: bulletHoleSprite(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    this.sparkMat = new THREE.SpriteMaterial({ map: softSprite("rgba(255,220,150,1)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }

  ejectShell(pos: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, floor: number) {
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    mesh.position.copy(pos);
    mesh.castShadow = false;
    this.scene.add(mesh);
    const vel = right.clone().multiplyScalar(1.6 + Math.random() * 0.8).add(up.clone().multiplyScalar(1.4 + Math.random() * 0.6));
    this.shells.push({ mesh, vel, spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20), life: 2.5, floor });
    if (this.shells.length > 30) this.removeShell(0);
  }

  private removeShell(i: number) {
    this.scene.remove(this.shells[i].mesh);
    this.shells.splice(i, 1);
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, kind: string | null) {
    // Agujero de bala (no en la nieve del suelo ni en personajes)
    if (kind && kind !== "ground" && kind !== "player") {
      let d = this.decals[this.decalIdx];
      if (!d) {
        d = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), this.holeMat);
        this.decals[this.decalIdx] = d;
        this.scene.add(d);
      }
      d.position.copy(point).addScaledVector(normal, 0.004);
      d.lookAt(point.clone().add(normal));
      d.rotateZ(Math.random() * Math.PI * 2);
      this.decalIdx = (this.decalIdx + 1) % this.maxDecals;
    }
    // Chispas en metal, polvo en hormigón/roca, nieve en el suelo
    const isMetal = kind === "metal";
    const sparks = isMetal ? 10 : 4;
    for (let i = 0; i < sparks; i++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(4));
      this.spawn(this.sparkMat, point, v, 0.12 + Math.random() * 0.15, 0.06, 0, 9);
    }
    const dustColor = kind === "ground" ? 0xe8eef8 : kind === "wood" || kind === "crate" ? 0x8a6a48 : 0xb8b4ac;
    const dust = new THREE.SpriteMaterial({ map: this.dustTex, color: dustColor, transparent: true, depthWrite: false, opacity: 0.55 });
    for (let i = 0; i < 3; i++) {
      const v = normal.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6));
      this.spawn(dust, point, v, 0.5 + Math.random() * 0.4, 0.18, 0.9, 0.6);
    }
  }

  private spawn(mat: THREE.SpriteMaterial, pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, grow: number, gravity: number) {
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.particles.push({ sprite: s, vel, life, max: life, grow, gravity });
  }

  update(dt: number) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt; s.mesh.rotation.y += s.spin.y * dt; s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < s.floor + 0.006) {
        s.mesh.position.y = s.floor + 0.006;
        s.vel.multiplyScalar(0.35); s.vel.y = Math.abs(s.vel.y) * 0.3; s.spin.multiplyScalar(0.5);
      }
      if (s.life <= 0) this.removeShell(i);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.multiplyScalar(1 + p.grow * dt);
      const mat = p.sprite.material;
      if (mat !== this.sparkMat) mat.opacity = 0.55 * (p.life / p.max);
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        if (mat !== this.sparkMat) mat.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}

/** Arma en primera persona: balanceo al caminar, inercia, retroceso, recarga, cambio de arma y fogonazo. */
export class ViewWeapon {
  readonly root = new THREE.Group(); // colgado de la cámara
  private slots: ({ group: THREE.Group; muzzle: THREE.Object3D; ejector: THREE.Object3D; base: THREE.Vector3; kick: number; yaw?: number; roll?: number; pitch?: number; arms?: ArmsViewModel } | null)[] = [null, null];
  private wasReloading = false;
  private current = 0;
  private flash: THREE.Group;
  private flashLight: THREE.PointLight;
  private flashTime = 0;
  private recoil = 0;
  private bobT = 0;
  private sway = new THREE.Vector2();
  private reloadT = 0;
  private switchT = 0;
  private aimT = 0;

  constructor() {
    // Fogonazo: tres planos cruzados con brillo aditivo
    this.flash = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: flashSprite(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.22), mat);
    p2.rotation.y = Math.PI / 2;
    p2.position.z = -0.08;
    const p3 = p2.clone();
    p3.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    this.flash.add(p1, p2, p3);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb05a, 0, 6, 2);
  }

  /**
   * Coloca un modelo de arma (normalizado: cañón hacia -Z, centrado, tamaño real) en una ranura.
   * La posición se calcula con su tamaño para que cualquier arma quede bien encuadrada.
   */
  setSlotModel(slot: number, model: THREE.Object3D, anchors: { size: THREE.Vector3; box: THREE.Box3; muzzle: THREE.Vector3; ejector: THREE.Vector3 }) {
    const old = this.slots[slot];
    if (old) this.root.remove(old.group);
    model.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    const group = new THREE.Group();
    group.add(model);
    const muzzle = new THREE.Object3D();
    muzzle.position.copy(anchors.muzzle);
    const ejector = new THREE.Object3D();
    ejector.position.copy(anchors.ejector);
    group.add(muzzle, ejector);
    const len = anchors.size.z;
    const pistol = len < 0.4;
    // Encuadre: la parte trasera del arma cerca de la cámara, el borde superior un poco por debajo
    // del centro de la pantalla y girada unos grados hacia dentro para que se vea su costado.
    const rear = pistol ? 0.13 : 0.05;
    const top = pistol ? 0.06 : 0.045;
    const base = new THREE.Vector3(pistol ? 0.1 : 0.14, -top - anchors.box.max.y, -(rear + len / 2));
    group.visible = slot === this.current;
    this.root.add(group);
    this.slots[slot] = { group, muzzle, ejector, base, kick: pistol ? 0.14 : len > 1.05 ? 0.1 : 0.06, yaw: pistol ? 0.28 : 0.32, roll: -0.07, pitch: -0.06 };
    if (slot === this.current) this.attachFlash();
  }

  /** Brazos animados: el pack ya trae su encuadre, balanceo y animaciones. */
  setSlotArms(slot: number, arms: ArmsViewModel) {
    const old = this.slots[slot];
    if (old) this.root.remove(old.group);
    const group = new THREE.Group();
    group.add(arms.group);
    group.visible = slot === this.current;
    this.root.add(group);
    this.slots[slot] = { group, muzzle: arms.muzzle, ejector: arms.ejector, base: new THREE.Vector3(0, 0, 0), kick: 0.015, arms };
    if (slot === this.current) this.attachFlash();
  }

  private active() { return this.slots[this.current] ?? this.slots[0] ?? this.slots[1]; }

  private attachFlash() {
    const a = this.active();
    if (!a) return;
    a.muzzle.add(this.flash);
    a.muzzle.add(this.flashLight);
  }

  setWeapon(index: number) {
    if (index === this.current) return;
    this.current = index;
    this.switchT = 1; // el arma sube desde abajo
    this.slots.forEach((s, i) => { if (s) s.group.visible = i === index; });
    this.attachFlash();
    this.slots[index]?.arms?.draw();
  }

  muzzleWorld(): THREE.Vector3 {
    const a = this.active();
    return a ? a.muzzle.getWorldPosition(new THREE.Vector3()) : this.root.getWorldPosition(new THREE.Vector3());
  }
  ejectorWorld(): THREE.Vector3 {
    const a = this.active();
    return a ? a.ejector.getWorldPosition(new THREE.Vector3()) : this.root.getWorldPosition(new THREE.Vector3());
  }

  fire(pellets = 1) {
    this.active()?.arms?.fire();
    this.recoil = 1;
    this.flashTime = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar((pellets > 1 ? 1.4 : 1) * (0.8 + Math.random() * 0.5));
    this.flashLight.intensity = pellets > 1 ? 35 : 25;
  }

  update(dt: number, opts: { speed: number; onGround: boolean; lookDX: number; lookDY: number; reloading: boolean; visible: boolean; aiming: boolean; reloadSeconds?: number }) {
    const a = this.active();
    if (a?.arms) {
      if (opts.reloading && !this.wasReloading) a.arms.reload(opts.reloadSeconds ?? 1.5);
      a.arms.update(dt, opts.speed, opts.onGround);
    }
    this.wasReloading = opts.reloading;
    // Con la mira telescópica el arma se aparta (se ve la mira a pantalla completa)
    this.aimT += ((opts.aiming ? 1 : 0) - this.aimT) * Math.min(1, dt * 14);
    this.root.visible = opts.visible && this.aimT < 0.9;
    if (!a) return;
    const moving = opts.onGround ? Math.min(1, opts.speed / 7) : 0;
    this.bobT += dt * (6 + moving * 5) * (moving > 0.05 ? 1 : 0.2);
    const bobAmp = a.arms ? 0.004 : 0.012;
    const bobX = Math.sin(this.bobT) * bobAmp * moving;
    const bobY = Math.abs(Math.cos(this.bobT)) * bobAmp * moving;
    this.sway.x += (-opts.lookDX * 0.02 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (opts.lookDY * 0.02 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.clampScalar(-0.03, 0.03);
    const animated = !!a.arms;
    this.reloadT += ((opts.reloading && !animated ? 1 : 0) - this.reloadT) * Math.min(1, dt * 8);
    this.switchT = Math.max(0, this.switchT - dt * 2.8);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    const k = this.recoil;
    const b = a.base;
    this.root.position.set(
      b.x * (1 - this.aimT) + bobX + this.sway.x,
      b.y - bobY + this.sway.y - this.reloadT * 0.12 - this.switchT * 0.25 - this.aimT * 0.1 + (opts.onGround ? 0 : -0.015),
      b.z + k * 0.045,
    );
    const aimK = 1 - this.aimT;
    this.root.rotation.set(
      k * a.kick + this.reloadT * -0.6 - this.switchT * 0.8 + (a.pitch ?? 0) * aimK,
      this.sway.x * 1.5 + (a.yaw ?? 0) * aimK,
      this.reloadT * 0.5 + bobX * 2 + (a.roll ?? 0) * aimK,
    );

    this.flashTime -= dt;
    if (this.flashTime <= 0) {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}
