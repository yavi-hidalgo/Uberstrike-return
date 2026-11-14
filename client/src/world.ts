// Escena 3D: entorno, mapa, jugadores, arma, efectos y postprocesado.
import * as THREE from "three";
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, type Effect,
} from "postprocessing";
import { EYE_HEIGHT } from "../../shared/src/constants";
import { ARENA_HALF } from "../../shared/src/map";
import { Environment, MOON_DIR } from "./environment";
import { buildMap, type MapVisuals } from "./mapbuilder";
import { ShotEffects, ViewWeapon } from "./weapon";
import { Avatar, loadAvatarModel } from "./avatars";

export type Quality = "low" | "medium" | "high";

export function loadQuality(): Quality {
  try {
    const q = localStorage.getItem("arena.quality");
    if (q === "low" || q === "medium" || q === "high") return q;
  } catch { /* sin storage */ }
  return "medium";
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.03, 2000);
  readonly weapon = new ViewWeapon();
  readonly effects: ShotEffects;
  private composer: EffectComposer | null = null;
  private env: Environment;
  private map: MapVisuals;
  private avatars = new Map<number, Avatar>();
  private tracers: { obj: THREE.Line; life: number; mat: THREE.LineBasicMaterial }[] = [];
  private time = 0;

  constructor(canvas: HTMLCanvasElement, readonly quality: Quality) {
    const usePost = quality !== "low";
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: !usePost, powerPreference: "high-performance", stencil: false,
    });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(quality === "high" ? Math.min(dpr, 1.5) : 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = usePost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = quality === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

    // Entorno
    this.env = new Environment(quality === "low" ? 600 : quality === "medium" ? 1500 : 2500);
    this.scene.add(this.env.group);
    this.scene.fog = new THREE.FogExp2(0x161d33, 0.0042);

    // Luz ambiental y reflejos a partir del cielo
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(this.env.skyOnlyScene(), 0.02).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 1.6;
    pmrem.dispose();

    // Luz de luna con sombras y luz de cielo
    this.scene.add(new THREE.HemisphereLight(0x5a6fa8, 0x1a1f2c, 0.9));
    const moon = new THREE.DirectionalLight(0xbfd0ff, 2.1);
    moon.position.copy(MOON_DIR).multiplyScalar(60);
    moon.castShadow = quality !== "low";
    const sz = quality === "high" ? 4096 : 2048;
    moon.shadow.mapSize.set(sz, sz);
    const sc = moon.shadow.camera;
    sc.left = sc.bottom = -ARENA_HALF - 6;
    sc.right = sc.top = ARENA_HALF + 6;
    sc.near = 1;
    sc.far = 140;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    if (quality === "high") moon.shadow.radius = 3;
    this.scene.add(moon);

    // Mapa
    this.map = buildMap(quality);
    this.scene.add(this.map.group);

    // Arma en primera persona
    this.camera.rotation.order = "YXZ";
    this.camera.add(this.weapon.root);
    this.scene.add(this.camera);
    this.effects = new ShotEffects(this.scene, quality === "low" ? 24 : 64);

    if (usePost) {
      this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const effects: Effect[] = [
        new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.75, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        new VignetteEffect({ offset: 0.32, darkness: 0.55 }),
      ];
      if (quality === "high") effects.push(new SMAAEffect());
      this.composer.addPass(new EffectPass(this.camera, ...effects));
    }

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Carga los modelos externos. Hay que esperarla antes de crear jugadores. */
  async load() {
    try {
      await loadAvatarModel(`${import.meta.env.BASE_URL}assets/models/robot.glb`);
    } catch (e) {
      console.warn("No se pudo cargar el modelo de jugador; se usan cápsulas.", e);
    }
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setView(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.camera.position.set(x, y + EYE_HEIGHT, z);
    this.camera.rotation.set(pitch, yaw, 0);
  }

  // ---------- Disparos ----------

  /** Disparo propio: fogonazo, casquillo, trazadora e impacto. */
  localShot(hit: THREE.Vector3, normal: THREE.Vector3, kind: string | null, feetY: number) {
    this.weapon.fire();
    this.camera.updateMatrixWorld(true);
    const from = this.weapon.muzzleWorld();
    this.tracer(from, hit, 0xffe2a8);
    this.effects.impact(hit, normal, kind);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.effects.ejectShell(this.weapon.ejectorWorld(), right, up, feetY);
  }

  remoteShot(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3 | null, kind: string | null) {
    this.tracer(from, to, 0xff9a6b);
    if (normal) this.effects.impact(to, normal, kind);
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.06, mat });
  }

  // ---------- Jugadores ----------

  upsertAvatar(id: number, name: string): Avatar {
    let a = this.avatars.get(id);
    if (!a) {
      a = new Avatar(id, name);
      this.avatars.set(id, a);
      this.scene.add(a.group);
    } else {
      a.setName(name);
    }
    return a;
  }

  getAvatar(id: number): Avatar | undefined {
    return this.avatars.get(id);
  }

  removeAvatar(id: number) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    this.avatars.delete(id);
  }

  avatarIds(): number[] {
    return [...this.avatars.keys()];
  }

  // ---------- Botiquines ----------

  setPickups(active: number[]) {
    const set = new Set(active);
    for (const [id, v] of this.map.pickups) {
      const on = set.has(id);
      v.item.visible = on;
      v.glow.visible = on;
      if (v.light) v.light.visible = on;
    }
  }

  render(dt: number, view: { speed: number; onGround: boolean; lookDX: number; lookDY: number; reloading: boolean; alive: boolean }) {
    this.time += dt;
    this.env.update(dt, this.time, this.camera.position);
    if (this.map.dome) this.map.dome.rotation.y += dt * 0.02;
    const blink = Math.sin(this.time * 3) > 0.2;
    for (const b of this.map.blinkers) b.visible = blink;
    for (const v of this.map.pickups.values()) {
      v.item.rotation.y += dt * 1.4;
      v.item.position.y = v.baseY + Math.sin(this.time * 2.2) * 0.07;
    }
    for (const a of this.avatars.values()) a.update(dt);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / 0.06) * 0.85;
      if (t.life <= 0) {
        this.scene.remove(t.obj);
        t.obj.geometry.dispose();
        t.mat.dispose();
        this.tracers.splice(i, 1);
      }
    }
    this.effects.update(dt);
    this.weapon.update(dt, { ...view, visible: view.alive });

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
