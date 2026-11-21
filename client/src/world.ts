// Escena 3D: entorno, mapa, jugadores, arma, efectos y postprocesado.
import * as THREE from "three";
import { initKTX2, ktx2Loader } from "./ktx";
import {
  BloomEffect, EffectComposer, EffectPass, Pass, RenderPass, SMAAEffect,
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
import { photoTexturesReady, softSprite } from "./textures";
import { Tracers } from "./tracers";
import type { WeaponFx } from "./fx";
import type { Look } from "../../shared/src/gear";
import { weaponModel } from "../../shared/src/weapons";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { N8AOPostPass } from "n8ao";
import { buildExpansion, type ExpansionVisuals } from "./expansion";

export type Quality = "low" | "medium" | "high";

/** Dibuja el arma encima del escenario dentro de la cadena de postprocesado (suavizado, brillo...). */
class WeaponPass extends Pass {
  constructor(private wScene: THREE.Scene, private wCamera: THREE.Camera, private isVisible: () => boolean) {
    super("WeaponPass");
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    if (!this.isVisible()) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.clearDepth();
    renderer.render(this.wScene, this.wCamera);
    renderer.autoClear = auto;
  }
}

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
  private tracerFx = new Tracers(this.scene);
  private remoteFlash = new THREE.PointLight(0xffb05a, 0, 9, 2);
  private remoteFlashT = 0;
  private numbers: { sp: THREE.Sprite; mat: THREE.SpriteMaterial; tex: THREE.Texture; life: number; vx: number }[] = [];
  private time = 0;
  /** El arma en primera persona se dibuja en su propia escena, con luz de estudio. */
  private hemi!: THREE.HemisphereLight;
  /** Luz principal (sol, luna o luz del planeta en el hangar) y su sombra que sigue a la cámara. */
  private sun!: THREE.DirectionalLight;
  private sunDir = MOON_DIR.clone();
  private shadowHalf = 0;
  private expansion: ExpansionVisuals | null = null;
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
    initKTX2(this.renderer);
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
    this.sun = moon;
    // Mapas grandes: la sombra cubre un cuadrado alrededor del jugador (más nítida que cubrir todo el mapa)
    if (mapDef.model && quality !== "low") {
      this.shadowHalf = quality === "high" ? 48 : 40;
      sc.left = sc.bottom = -this.shadowHalf;
      sc.right = sc.top = this.shadowHalf;
      sc.far = 320;
      moon.shadow.bias = -0.0003;
      moon.shadow.normalBias = 0.04;
    }

    // Mapa: construido por código (observatorio) o escenario modelado (se carga en load())
    this.map = mapDef.model ? buildPickups(quality, mapDef.pickups) : buildMap(quality);
    this.scene.add(this.map.group);

    // Arma en primera persona
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.setupWeaponScene();
    this.effects = new ShotEffects(this.scene, quality === "low" ? 24 : 64);
    this.scene.add(this.remoteFlash, this.projLight, this.boomLight);

    if (usePost) {
      this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Oclusión ambiental: sombras de contacto en rincones, bajo objetos y entre piezas
      const ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.6;
      ao.configuration.halfRes = quality !== "high";
      ao.configuration.gammaCorrection = false;
      this.composer.addPass(ao);
      this.composer.addPass(new WeaponPass(this.weaponScene, this.weaponCamera, () => this.weapon.root.visible));
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
    await this.loadContent();
    await photoTexturesReady();
    // Compila todos los shaders ahora, durante la pantalla de carga, para que la primera vez
    // que se ve algo (una explosión, el hangar) no haya un tirón.
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { console.warn("No se pudieron precompilar los shaders", e); }
  }

  private async loadContent() {
    const base = import.meta.env.BASE_URL;
    await Promise.all([
      loadAvatarModel(`${base}assets/models/robot.glb`).catch((e) => console.warn("Sin modelo de jugador; se usan cápsulas.", e)),
      loadSoldierModels([
        { url: `${base}assets/soldiers/swat.glb`, hasGun: true },
        { url: `${base}assets/soldiers/operator.glb`, hasGun: true },
        { url: `${base}assets/soldiers/tactical.glb`, hasGun: false },
      ]),
      loadPropModels(),
      this.mapDef.model && !this.mapDef.indoor
        ? this.loadSunsetSky(`${base}assets/hdri/industrial_sunset_02_puresky_2k.hdr`)
        : this.loadSkyLight(`${base}assets/hdri/rogland_clear_night_1k.hdr`),
      this.mapDef.model ? this.loadMapModel() : Promise.resolve(),
      this.mapDef.expansion
        ? buildExpansion(this.mapDef.expansion, this.quality, { indoor: !!this.mapDef.indoor }).then((v) => { this.expansion = v; this.scene.add(v.group); this.addExpansionLights(); })
        : Promise.resolve(),
    ]);
    if (this.mapDef.model) {
      if (this.mapDef.indoor) {
        // Interior: luz artificial fría, algo de bruma y el cielo estrellado solo visible por la ventana del hangar
        this.scene.environmentIntensity = 2.2;
        this.renderer.toneMappingExposure = 1.35;
        this.env.group.children.forEach((c, i) => { c.visible = i === 0; });
        this.scene.background = new THREE.Color(0x05070c);
        this.scene.fog = new THREE.FogExp2(0x0b1018, 0.014);
        this.hemi.color.set(0xbfd4ff);
        this.hemi.groundColor.set(0x3a3f4a);
        this.hemi.intensity = 2.0;
        this.addPlanet();
        // Luz del planeta que entra por la ventana del hangar (sin sombras se filtraría por todos lados)
        this.sunDir.set(0.86, 0.42, 0.28).normalize();
        this.sun.color.set(0xc6dcff);
        this.sun.intensity = this.quality === "low" ? 0 : 4;
      }
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
    loader.setKTX2Loader(ktx2Loader);
    const g = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/maps/${m.file}`);
    const root = g.scene;
    root.scale.setScalar(m.scale);
    root.position.y = m.groundOffset;
    const shadows = this.quality !== "low";
    const sunset = !this.mapDef.indoor;
    for (const name of m.hide ?? []) { const o = root.getObjectByName(name); if (o) o.visible = false; }
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
        if (/Windows/i.test(sm.name)) { sm.emissive = new THREE.Color(0x4a3418); sm.emissiveIntensity = sunset ? 0.18 : 0.55; sm.emissiveMap = sm.map; }
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
    root.name = "mapa";
    this.scene.add(root);
    this.addMapLights();
  }

  /** Luz cálida en cada farola y foco del escenario (solo en calidad media y alta). */
  private addMapLights() {
    const lights = this.mapDef.lights ?? [];
    const taken: THREE.Vector3[] = [];
    const glowTex = softSprite(this.mapDef.indoor ? "rgba(190,215,255,0.5)" : "rgba(255,200,130,0.65)");
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
        const l = new THREE.PointLight(this.mapDef.indoor ? 0xcfe0ff : 0xffb870, lamp ? 60 : this.mapDef.indoor ? 45 : 25, lamp ? 24 : 16, 2);
        l.position.copy(p);
        this.scene.add(l);
      }
    }
  }

  /**
   * Atardecer: el cielo es una foto HDR (Poly Haven, CC0). Se busca el píxel más brillante para
   * orientar el sol exactamente donde está en la foto, con su color, y la niebla toma el tono del horizonte.
   */
  private async loadSunsetSky(url: string) {
    try {
      const loader = new HDRLoader();
      loader.setDataType(THREE.FloatType);
      const hdr = await loader.loadAsync(url);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const { width: W, height: H, data } = hdr.image as { width: number; height: number; data: Float32Array };
      const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      let best = 0, bx = 0, by = 0;
      for (let y = 0; y < H / 2; y += 2) for (let x = 0; x < W; x += 2) { const l = lum((y * W + x) * 4); if (l > best) { best = l; bx = x; by = y; } }
      const u = (bx + 0.5) / W, v = 1 - (by + 0.5) / H;
      const phi = (u - 0.5) * Math.PI * 2;
      let lat = (v - 0.5) * Math.PI;
      lat = Math.max(lat, THREE.MathUtils.degToRad(16)); // sol muy bajo = todo en sombra: se sube un poco
      this.sunDir.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)).normalize();
      // color del sol: promedio alrededor del píxel más brillante, normalizado
      const col = new THREE.Color(0, 0, 0);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const i = (Math.min(H - 1, Math.max(0, by + dy)) * W + ((bx + dx + W) % W)) * 4;
        col.r += data[i]; col.g += data[i + 1]; col.b += data[i + 2];
      }
      const mx = Math.max(col.r, col.g, col.b) || 1;
      col.multiplyScalar(1 / mx);
      this.sun.color.copy(col).lerp(new THREE.Color(0xffd2a0), 0.35);
      this.sun.intensity = 3.4;
      // niebla: color medio del horizonte
      const hz = new THREE.Color(0, 0, 0);
      const row = Math.floor(H * 0.5) - 3;
      for (let x = 0; x < W; x += 4) { const i = (row * W + x) * 4; hz.r += data[i]; hz.g += data[i + 1]; hz.b += data[i + 2]; }
      const hm = Math.max(hz.r, hz.g, hz.b) || 1;
      hz.multiplyScalar(0.5 / hm);
      this.scene.fog = new THREE.FogExp2(hz, 0.0024);
      this.scene.background = hdr;
      this.scene.backgroundIntensity = 1;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      this.scene.environmentIntensity = 0.85;
      this.renderer.toneMappingExposure = 1.0;
      this.hemi.color.set(0xa8b8d8);
      this.hemi.groundColor.set(0x4a3a30);
      this.hemi.intensity = 0.35;
      this.env.group.visible = false;
    } catch (e) {
      console.warn("Sin cielo de atardecer; se usa la noche.", e);
    }
  }

  /** Planeta que se ve por la ventana del hangar. */
  private addPlanet() {
    const mat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() } },
      vertexShader: "varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
        float h(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          vec3 p = normalize(vP) * 3.0;
          float c = n(p) * 0.5 + n(p * 2.1) * 0.3 + n(p * 4.3) * 0.2;
          float cl = smoothstep(0.55, 0.8, n(p * 1.7 + 7.0) * 0.6 + n(p * 5.0) * 0.4);
          vec3 sea = vec3(0.05, 0.16, 0.32), land = mix(vec3(0.32, 0.27, 0.18), vec3(0.18, 0.3, 0.16), n(p * 3.0));
          vec3 col = mix(sea, land, smoothstep(0.5, 0.56, c));
          col = mix(col, vec3(0.92), cl);
          float d = max(dot(vN, uSun), 0.0);
          float rim = pow(1.0 - abs(dot(vN, vec3(-1.0, 0.0, 0.0))), 3.0);
          gl_FragColor = vec4(col * (0.04 + d * 1.6) + vec3(0.3, 0.55, 1.0) * rim * (0.2 + d), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(260, 64, 32), mat);
    planet.position.set(820, -120, 60);
    planet.rotation.z = 0.4;
    this.scene.add(planet);
  }

  /** Luces de la ampliación: focos del patio (solo brillo) y tubos del hangar (luces reales). */
  private addExpansionLights() {
    const e = this.mapDef.expansion;
    if (!e) return;
    const max = this.quality === "high" ? 10 : this.quality === "medium" ? 6 : 0;
    const glowTex = softSprite(this.mapDef.indoor ? "rgba(200,225,255,0.45)" : "rgba(255,214,150,0.6)");
    let n = 0;
    for (const [x, y, z, kind] of e.lights) {
      if (kind !== 2) {
        // al atardecer los focos recién se encienden: brillo suave
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
        glow.position.set(x, y - 0.3, z);
        glow.scale.setScalar(kind === 1 ? 2.6 : 1.4);
        this.scene.add(glow);
        continue;
      }
      if (n++ >= max) continue;
      const l = new THREE.PointLight(0xdfe9ff, 110, 30, 1.5);
      l.position.set(x, y - 1.2, z);
      this.scene.add(l);
    }
  }

  /** Carga y coloca en primera persona el arma principal y la pistola elegidas. */
  async equip(loadout: string[]) {
    await Promise.all(loadout.map(async (id, slot) => {
      const def = weaponModel(id);
      if (def?.arms) {
        const arms = await ArmsViewModel.load(def);
        if (arms) { this.weapon.setSlotArms(slot, arms); return; }
      }
      const o = await weaponObject(id);
      if (o) this.weapon.setSlotModel(slot, o, weaponAnchors(o), { melee: def?.category === "melee" });
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
  setZoom(fov: number, extra = 0) {
    const target = (fov > 0 ? fov : this.baseFov) + (fov > 0 ? 0 : extra);
    if (Math.abs(this.camera.fov - target) < 0.01) return;
    this.camera.fov += (target - this.camera.fov) * 0.3;
    if (Math.abs(this.camera.fov - target) < 0.2) this.camera.fov = target;
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

  setView(x: number, y: number, z: number, yaw: number, pitch: number, roll = 0, lift = 0) {
    this.camera.position.set(x, y + EYE_HEIGHT + lift, z);
    this.camera.rotation.set(pitch, yaw, roll);
  }

  // ---------- Disparos ----------

  /** Disparo propio: fogonazo, casquillo, trazadora e impacto. */
  /** Disparo propio: fogonazo, humo, casquillo, trazadoras e impactos según el arma. */
  localShot(hits: { point: THREE.Vector3; normal: THREE.Vector3; kind: string | null }[], feetY: number, fx: WeaponFx) {
    this.weapon.fire(fx);
    this.camera.updateMatrixWorld(true);
    // El arma vive en el espacio de la cámara: lo pasamos al mundo para la trazadora
    const from = this.camera.localToWorld(this.weapon.muzzleWorld());
    for (const h of hits) this.tracerFx.add(from, h.point, fx, () => this.effects.impact(h.point, h.normal, h.kind, fx));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (fx.smoke) this.effects.muzzleSmoke(from, fwd, fx.smoke);
    if (fx.casing) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.effects.ejectShell(this.camera.localToWorld(this.weapon.ejectorWorld()), right, up, feetY);
    }
  }

  remoteShot(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3 | null, kind: string | null, fx: WeaponFx) {
    this.tracerFx.add(from, to, fx, normal ? () => this.effects.impact(to, normal, kind, fx) : undefined);
    if (fx.smoke) this.effects.muzzleSmoke(from, to.clone().sub(from).normalize(), Math.ceil(fx.smoke / 2));
    // destello breve en el cañón del otro jugador
    const l = this.remoteFlash;
    l.color.set(fx.energy ? fx.color : 0xffb05a);
    l.position.copy(from);
    l.intensity = fx.flashLight * 0.8;
    this.remoteFlashT = 0.06;
  }

  // ---------- Proyectiles de los cañones ----------

  private projectiles: { id: number; mesh: THREE.Mesh; glow: THREE.Sprite; pos: THREE.Vector3; dir: THREE.Vector3; speed: number; gravity: number; vy: number; left: number; fx: WeaponFx; trailT: number; mine: boolean }[] = [];
  private projLight = new THREE.PointLight(0xffb060, 0, 14, 2);
  private boomLight = new THREE.PointLight(0xffb060, 0, 30, 2);
  private boomT = 0;

  /** Proyectil en vuelo. `maxDist`: distancia hasta el primer obstáculo (se oculta al llegar; la explosión la manda el servidor). */
  spawnProjectile(id: number, from: THREE.Vector3, dir: THREE.Vector3, speed: number, gravity: number, maxDist: number, fx: WeaponFx, mine: boolean) {
    const plasma = fx.energy || fx.cannon === "plasma";
    const color = plasma ? fx.color : 0xffc070;
    const geo = plasma ? new THREE.SphereGeometry(0.11, 12, 8) : new THREE.CylinderGeometry(0.045, 0.06, 0.5, 8);
    if (!plasma) geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, plasma
      ? new THREE.MeshBasicMaterial({ color: 0xffffff })
      : new THREE.MeshStandardMaterial({ color: 0x4a4f48, roughness: 0.5, metalness: 0.6 }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite("rgba(255,255,255,1)"), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(plasma ? 1.1 : 0.7);
    mesh.add(glow);
    if (!plasma) glow.position.z = 0.3; // llama del motor, detrás del cohete
    mesh.position.copy(from);
    mesh.lookAt(from.clone().add(dir));
    this.scene.add(mesh);
    this.projectiles.push({ id, mesh, glow, pos: from.clone(), dir: dir.clone(), speed, gravity, vy: 0, left: maxDist, fx, trailT: 0, mine });
  }

  /** Quita un proyectil (al explotar). Si no se conoce el id y es propio, quita el más antiguo propio. */
  private removeProjectile(id: number, mine: boolean) {
    let i = this.projectiles.findIndex((p) => p.id === id);
    if (i < 0 && mine) i = this.projectiles.findIndex((p) => p.mine);
    if (i < 0) return;
    const p = this.projectiles[i];
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
    p.glow.material.dispose();
    this.projectiles.splice(i, 1);
  }

  explode(id: number, pos: THREE.Vector3, radius: number, fx: WeaponFx, mine: boolean) {
    this.removeProjectile(id, mine);
    const plasma = fx.energy || fx.cannon === "plasma";
    this.effects.explosion(pos, radius, { energy: plasma, color: fx.color });
    this.boomLight.color.set(plasma ? fx.color : 0xffb060);
    this.boomLight.position.copy(pos).add(new THREE.Vector3(0, 0.4, 0));
    this.boomLight.intensity = 160;
    this.boomT = 0.22;
  }

  private tmpV = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();

  private updateProjectiles(dt: number) {
    let lit = false;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vy -= p.gravity * dt;
      const v = this.tmpV.copy(p.dir).multiplyScalar(p.speed); v.y += p.vy;
      const step = v.length() * dt;
      p.left -= step;
      if (p.left <= -p.speed * 0.6) { this.removeProjectile(p.id, false); continue; } // el servidor no avisó: se descarta
      if (p.left <= 0) { p.mesh.visible = false; continue; }
      p.pos.addScaledVector(v, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.lookAt(this.tmpLook.copy(p.pos).add(v));
      p.trailT -= dt;
      if (p.trailT <= 0) { this.effects.trail(p.pos, { energy: p.fx.energy || p.fx.cannon === "plasma", color: p.fx.color }); p.trailT = 0.03; }
      if (!lit) { this.projLight.position.copy(p.pos); this.projLight.color.set(p.fx.energy || p.fx.cannon === "plasma" ? p.fx.color : 0xffb060); this.projLight.intensity = 30; lit = true; }
    }
    if (!lit) this.projLight.intensity = 0;
    if (this.boomT > 0) { this.boomT -= dt; this.boomLight.intensity = Math.max(0, 160 * (this.boomT / 0.22)); }
  }

  /** Golpe del arma blanca en primera persona. */
  swing(seconds: number) { this.weapon.swing(seconds); }

  /** Número de daño flotando sobre el jugador al que se acertó, y salpicadura. */
  damageNumber(victimId: number, damage: number, headshot: boolean, kill: boolean) {
    const av = this.avatars.get(victimId);
    if (!av) return;
    const pos = av.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, headshot ? 1.75 : 1.25, (Math.random() - 0.5) * 0.4));
    this.effects.bodyHit(pos, headshot);
    const c = document.createElement("canvas");
    c.width = 128; c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "800 46px 'Saira Condensed', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.85)";
    g.fillStyle = kill ? "#ff5a4a" : headshot ? "#ffd84a" : "#ffffff";
    g.strokeText(String(damage), 64, 34); g.fillText(String(damage), 64, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false });
    const sp = new THREE.Sprite(mat);
    const size = 0.05 + Math.min(0.035, damage / 2500) + (headshot ? 0.012 : 0);
    sp.scale.set(size * 2, size, 1);
    sp.position.copy(pos).add(new THREE.Vector3(0, 0.35, 0));
    sp.renderOrder = 50;
    this.scene.add(sp);
    this.numbers.push({ sp, mat, tex, life: 0.85, vx: (Math.random() - 0.5) * 0.8 });
  }

  // ---------- Jugadores ----------

  upsertAvatar(id: number, name: string, look?: Look): Avatar {
    let a = this.avatars.get(id);
    if (!a) {
      a = new Avatar(id, name, look);
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
    a.dispose();
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

  render(dt: number, view: { speed: number; onGround: boolean; lookDX: number; lookDY: number; reloading: boolean; alive: boolean; aiming: boolean; ads?: boolean; sprinting?: boolean; reloadSeconds?: number }) {
    this.time += dt;
    this.env.update(dt, this.time, this.camera.position);
    this.expansion?.update(this.time, this.camera.position);
    if (this.shadowHalf > 0) {
      // la caja de sombra sigue a la cámara, alineada a la grilla de píxeles de la sombra (sin parpadeo)
      const texel = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x;
      const c = this.camera.position;
      const tx = Math.round(c.x / texel) * texel, tz = Math.round(c.z / texel) * texel;
      this.sun.target.position.set(tx, 0, tz);
      this.sun.position.copy(this.sunDir).multiplyScalar(150).add(this.sun.target.position);
    }
    if (this.map.dome) this.map.dome.rotation.y += dt * 0.02;
    const blink = Math.sin(this.time * 3) > 0.2;
    for (const b of this.map.blinkers) b.visible = blink;
    for (const v of this.map.pickups.values()) {
      v.item.rotation.y += dt * 1.4;
      v.item.position.y = v.baseY + Math.sin(this.time * 2.2) * 0.07;
    }
    for (const a of this.avatars.values()) a.update(dt);

    this.tracerFx.update(dt);
    this.updateProjectiles(dt);
    if (this.remoteFlashT > 0) { this.remoteFlashT -= dt; if (this.remoteFlashT <= 0) this.remoteFlash.intensity = 0; }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.sp.position.y += dt * 1.1;
      n.sp.position.x += n.vx * dt;
      n.mat.opacity = Math.min(1, n.life / 0.3);
      if (n.life <= 0) { this.scene.remove(n.sp); n.mat.dispose(); n.tex.dispose(); this.numbers.splice(i, 1); }
    }
    this.effects.update(dt);
    this.weapon.update(dt, { ...view, visible: view.alive });

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    // Sin postprocesado (calidad baja): el arma se dibuja aquí en una segunda pasada
    if (!this.composer && this.weapon.root.visible) {
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
