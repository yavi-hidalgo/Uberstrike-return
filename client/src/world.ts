// Escena 3D: entorno, mapa, jugadores, arma, efectos y postprocesado.
import * as THREE from "three";
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, type Effect,
} from "postprocessing";
import { EYE_HEIGHT } from "../../shared/src/constants";
import type { MapDef } from "../../shared/src/maps";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { Environment, MOON_DIR } from "./environment";
import { buildMap, buildPickups, type MapVisuals } from "./mapbuilder";
import { ShotEffects, ViewWeapon } from "./weapon";
import { Avatar, loadAvatarModel, loadSoldierModels } from "./avatars";
import { buildProps, hasModel, loadPropModels } from "./props";
import { weaponAnchors, weaponObject } from "./weaponmodels";
import { ArmsViewModel } from "./fparms";
import { softSprite } from "./textures";
import { weaponModel } from "../../shared/src/weapons";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

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
  /** El arma en primera persona se dibuja en su propia escena, con luz de estudio. */
  private hemi!: THREE.HemisphereLight;
  private weaponScene = new THREE.Scene();
  private weaponCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 20);

  constructor(canvas: HTMLCanvasElement, readonly quality: Quality, readonly mapDef: MapDef) {
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
    this.hemi = new THREE.HemisphereLight(0x6a7fb8, 0x2a2f3c, 0.9);
    this.scene.add(this.hemi);
    const moon = new THREE.DirectionalLight(0xbfd0ff, 2.1);
    moon.position.copy(MOON_DIR).multiplyScalar(60);
    moon.castShadow = quality !== "low";
    const sz = quality === "high" ? 4096 : 2048;
    moon.shadow.mapSize.set(sz, sz);
    const sc = moon.shadow.camera;
    // La sombra cubre todo el mapa
    const bnd = mapDef.bounds;
    const half = Math.max(bnd.maxX - bnd.minX, bnd.maxZ - bnd.minZ) / 2 + 6;
    const cx = (bnd.minX + bnd.maxX) / 2, cz = (bnd.minZ + bnd.maxZ) / 2;
    sc.left = sc.bottom = -half;
    sc.right = sc.top = half;
    sc.near = 1;
    sc.far = 260;
    moon.position.add(new THREE.Vector3(cx, 30, cz));
    moon.target.position.set(cx, 0, cz);
    this.scene.add(moon.target);
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    if (quality === "high") moon.shadow.radius = 3;
    this.scene.add(moon);

    // Mapa: construido por código (observatorio) o escenario modelado (se carga en load())
    this.map = mapDef.model ? buildPickups(quality, mapDef.pickups) : buildMap(quality);
    this.scene.add(this.map.group);

    // Arma en primera persona
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.setupWeaponScene();
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
    const base = import.meta.env.BASE_URL;
    await Promise.all([
      loadAvatarModel(`${base}assets/models/robot.glb`).catch((e) => console.warn("Sin modelo de jugador; se usan cápsulas.", e)),
      loadSoldierModels([
        { url: `${base}assets/soldiers/swat.glb`, hasGun: true },
        { url: `${base}assets/soldiers/operator.glb`, hasGun: true },
        { url: `${base}assets/soldiers/tactical.glb`, hasGun: false },
      ]),
      loadPropModels(),
      this.loadSkyLight(`${base}assets/hdri/rogland_clear_night_1k.hdr`),
      this.mapDef.model ? this.loadMapModel() : Promise.resolve(),
    ]);
    if (this.mapDef.model) {
      // Noche urbana: más luz de ambiente para que se lean las texturas del escenario.
      // Se aplica al final porque el cielo HDRI se carga en paralelo y fija su propia intensidad.
      this.scene.environmentIntensity = 2.2;
      this.renderer.toneMappingExposure = 1.35;
      this.hemi.intensity = 1.7;
      // Niebla nocturna entre los edificios
      this.scene.fog = new THREE.FogExp2(0x1d2540, 0.012);
      return;
    }
    // Objetos reales y reemplazo de las versiones generadas por código
    this.scene.add(buildProps(this.quality));
    const replaceRocks = hasModel("rock_09"), replaceLamps = hasModel("street_lamp_02");
    this.map.group.traverse((o) => {
      if (replaceRocks && o.userData.proceduralRock) o.visible = false;
      if (replaceLamps && o.userData.proceduralLampHead) o.visible = false;
      if (replaceLamps && o.userData.lampPole) { o.scale.y = 3.1 / 3.6; o.position.y = 3.1 / 2; }
    });
  }

  /** Escenario modelado (Sketchfab): escalado a metros reales y con la calle en y = 0. */
  private async loadMapModel() {
    const m = this.mapDef.model!;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const g = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/maps/${m.file}`);
    const root = g.scene;
    root.scale.setScalar(m.scale);
    root.position.y = m.groundOffset;
    const shadows = this.quality !== "low";
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (sm.map) sm.map.anisotropy = 8;
        // Lámparas encendidas y ventanas con algo de luz interior
        if (/^(Lights|LampPosts)/i.test(sm.name)) { sm.emissive = new THREE.Color(0xffc27a); sm.emissiveIntensity = /^Lights/i.test(sm.name) ? 2.5 : 0.25; }
        if (/Windows/i.test(sm.name)) { sm.emissive = new THREE.Color(0x4a3418); sm.emissiveIntensity = 0.55; sm.emissiveMap = sm.map; }
        // Vallas, rejas, cables y carteles usan el canal alfa de la textura: recorte nítido
        // (también proyecta sombras con su forma) en lugar de mezcla, que se ordena mal.
        if (sm.transparent || sm.alphaTest > 0) {
          sm.alphaTest = Math.max(sm.alphaTest, 0.4);
          sm.transparent = false;
          sm.depthWrite = true;
          sm.side = THREE.DoubleSide;
        }
      }
    });
    this.scene.add(root);
    this.addMapLights();
  }

  /** Luz cálida en cada farola y foco del escenario (solo en calidad media y alta). */
  private addMapLights() {
    const lights = this.mapDef.lights ?? [];
    const taken: THREE.Vector3[] = [];
    const glowTex = softSprite("rgba(255,200,130,0.65)");
    const max = this.quality === "high" ? 10 : this.quality === "medium" ? 6 : 0;
    for (const [x, y, z, lamp] of lights) {
      const p = new THREE.Vector3(x, y - (lamp ? 0.4 : 0.1), z);
      if (taken.some((q) => q.distanceTo(p) < 1.5)) continue;
      taken.push(p);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.position.copy(p);
      glow.scale.setScalar(lamp ? 2.6 : 1.6);
      this.scene.add(glow);
      if (taken.length <= max) {
        const l = new THREE.PointLight(0xffb870, lamp ? 60 : 25, lamp ? 24 : 12, 2);
        l.position.copy(p);
        this.scene.add(l);
      }
    }
  }

  /** Carga y coloca en primera persona el arma principal y la pistola elegidas. */
  async equip(loadout: [string, string]) {
    await Promise.all(loadout.map(async (id, slot) => {
      const def = weaponModel(id);
      if (def?.arms) {
        const arms = await ArmsViewModel.load(def);
        if (arms) { this.weapon.setSlotArms(slot, arms); return; }
      }
      const o = await weaponObject(id);
      if (o) this.weapon.setSlotModel(slot, o, weaponAnchors(o));
    }));
  }

  /** Arma que lleva en la mano un rival (se carga la primera vez que se ve). */
  async setAvatarWeapon(playerId: number, weaponId: string) {
    const a = this.avatars.get(playerId);
    if (!a || a.weaponId === weaponId) return;
    a.weaponId = weaponId;
    const o = await weaponObject(weaponId);
    if (o && a.weaponId === weaponId) a.setWeaponModel(o);
  }

  private baseFov = 72;
  /** Zoom de la mira (0 = sin zoom). */
  setZoom(fov: number) {
    const target = fov > 0 ? fov : this.baseFov;
    if (Math.abs(this.camera.fov - target) < 0.01) return;
    this.camera.fov += (target - this.camera.fov) * 0.35;
    if (Math.abs(this.camera.fov - target) < 0.3) this.camera.fov = target;
    this.camera.updateProjectionMatrix();
  }

  /** Luz ambiental y reflejos a partir de una foto HDR de cielo nocturno (Poly Haven, CC0). */
  private async loadSkyLight(url: string) {
    try {
      const hdr = await new HDRLoader().loadAsync(url);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
      this.scene.environmentIntensity = 0.9;
      hdr.dispose();
      pmrem.dispose();
    } catch (e) {
      console.warn("Sin HDRI; se usa la luz del cielo generado.", e);
    }
  }

  /**
   * Escena aparte para el arma: luz de estudio suave con un toque frío de luna,
   * para que los materiales se vean como en el visor 3D. Además el arma nunca
   * atraviesa las paredes, porque se dibuja encima del mundo.
   */
  private setupWeaponScene() {
    this.weaponScene.add(this.weapon.root);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.weaponScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.weaponScene.environmentIntensity = 0.55;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xdfe8ff, 2.2);
    key.position.set(-1, 2, 1.5);
    const fill = new THREE.DirectionalLight(0xffd2a0, 0.5);
    fill.position.set(2, 0.5, 1);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 1.4);
    rim.position.set(1, 1, -2);
    this.weaponScene.add(key, fill, rim, new THREE.AmbientLight(0x404a60, 0.6));
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = w / h;
    this.weaponCamera.updateProjectionMatrix();
  }

  setView(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.camera.position.set(x, y + EYE_HEIGHT, z);
    this.camera.rotation.set(pitch, yaw, 0);
  }

  // ---------- Disparos ----------

  /** Disparo propio: fogonazo, casquillo, trazadora e impacto. */
  localShot(hits: { point: THREE.Vector3; normal: THREE.Vector3; kind: string | null }[], feetY: number) {
    this.weapon.fire(hits.length);
    this.camera.updateMatrixWorld(true);
    // El arma vive en el espacio de la cámara: lo pasamos al mundo para la trazadora
    const from = this.camera.localToWorld(this.weapon.muzzleWorld());
    for (const h of hits) {
      this.tracer(from, h.point, 0xffe2a8);
      this.effects.impact(h.point, h.normal, h.kind);
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.effects.ejectShell(this.camera.localToWorld(this.weapon.ejectorWorld()), right, up, feetY);
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

  render(dt: number, view: { speed: number; onGround: boolean; lookDX: number; lookDY: number; reloading: boolean; alive: boolean; aiming: boolean; reloadSeconds?: number }) {
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

    // Segunda pasada: el arma encima del mundo, con su propia luz
    if (this.weapon.root.visible) {
      const r = this.renderer;
      const prevTone = r.toneMapping;
      r.autoClear = false;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.clearDepth();
      r.render(this.weaponScene, this.weaponCamera);
      r.toneMapping = prevTone;
      r.autoClear = true;
    }
  }
}
