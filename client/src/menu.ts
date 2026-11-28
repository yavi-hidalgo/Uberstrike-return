// Menú principal "vestíbulo": el personaje en 3D sosteniendo su arma a la derecha, tu nombre, equipo y
// bots a la izquierda, y abajo tres fichas grandes (Jugar, Arsenal, Ajustes). Todo se guarda en el navegador.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  CATEGORY_NAMES, WEAPON_MODELS, validLoadout, weaponModel, weaponStats, type Category, type Loadout, type WeaponStats,
} from "../../shared/src/weapons";
import { validLook, type Look } from "../../shared/src/gear";
import { MAX_HP } from "../../shared/src/constants";
import { MAPS, PLAYABLE_MAPS } from "../../shared/src/maps";
import { buildCharacter, loadSkin, type Character } from "./skins";
import { weaponObject } from "./weaponmodels";
import { initKTX2 } from "./ktx";

export interface Settings { sens: number; volume: number; music: number; bots: number }
export interface MenuState { name: string; loadout: Loadout; look: Look; settings: Settings }

const store = {
  get: (k: string) => { try { return localStorage.getItem(`arena.${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`arena.${k}`, v); } catch { /* sin almacenamiento */ } },
};
const num = (k: string, d: number) => { const v = parseFloat(store.get(k) ?? ""); return Number.isFinite(v) ? v : d; };

export function loadState(): MenuState {
  return {
    name: store.get("name") ?? "",
    loadout: validLoadout(store.get("primary"), store.get("secondary"), store.get("melee")),
    look: validLook({ skin: store.get("skin"), helmet: store.get("helmet"), vest: store.get("vest"), pack: store.get("pack") }),
    settings: { sens: num("sens", 1), volume: num("volume", 0.8), music: num("music", 0.5), bots: num("bots", 3) },
  };
}

function saveState(s: MenuState) {
  store.set("name", s.name);
  store.set("primary", s.loadout[0]); store.set("secondary", s.loadout[1]); store.set("melee", s.loadout[2]);
  store.set("skin", s.look.skin); store.set("helmet", s.look.helmet); store.set("vest", s.look.vest); store.set("pack", s.look.pack);
  store.set("sens", String(s.settings.sens)); store.set("volume", String(s.settings.volume)); store.set("music", String(s.settings.music)); store.set("bots", String(s.settings.bots));
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else n.setAttribute(k, v); }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};

// ---------- Estadísticas en barras ----------
function bars(st: WeaponStats): [string, number][] {
  const dmg = st.projectile ? st.projectile.splash + st.damage * 0.3 : st.damage * st.pellets;
  const reach = st.meleeRange > 0 ? st.meleeRange / 3.2 * 0.12 : Math.min(1, (st.falloffMin >= 0.9 ? st.range : st.falloffEnd) / 220);
  return [
    ["Daño", Math.min(1, dmg / 130)],
    ["Cadencia", Math.min(1, (30 / st.fireIntervalTicks) / 16)],
    ["Alcance", reach],
    ["Movilidad", Math.min(1, Math.max(0.05, (st.speedK - 0.75) / 0.42))],
  ];
}

function describe(id: string): string {
  const m = weaponModel(id);
  if (!m) return "";
  const st = weaponStats(id);
  const rate = Math.round(30 / st.fireIntervalTicks * 10) / 10;
  if (st.meleeRange > 0) return `Arma blanca ${m.melee === "light" ? "ligera" : m.melee === "heavy" ? "pesada" : "media"}. Daño ${st.damage}, ${rate} golpes por segundo, alcance ${st.meleeRange} m. Corres un ${Math.round((st.speedK - 1) * 100)} % más rápido con ella en la mano.`;
  if (st.projectile) return `Cañón de ${m.cannon === "plasma" ? "plasma" : "cohetes"}. Impacto directo ${st.damage}; la explosión hace hasta ${st.projectile.splash} en ${st.projectile.radius} m (también a ti). Cargador ${st.magazine}.`;
  if (m.cannon === "minigun") return `Minigun. Daño ${st.damage} por bala, ${rate} disparos por segundo, cargador ${st.magazine}. Te vuelve un ${Math.round((1 - st.speedK) * 100)} % más lento.`;
  if (m.cannon === "rail") return `Cañón de riel. Rayo instantáneo de ${st.damage} de daño (${st.headshotDamage} a la cabeza). Cargador ${st.magazine}, recarga lenta.`;
  const dmg = st.pellets > 1 ? `${st.pellets}×${st.damage}` : `${st.damage}`;
  const reach = st.energy ? "De energía: casi no pierde daño con la distancia y tiene poco retroceso."
    : st.falloffMin >= 1 ? "Daño completo a cualquier distancia." : `Daño completo hasta ${st.falloffStart} m; baja al ${Math.round(st.falloffMin * 100)} % desde ${st.falloffEnd} m.`;
  return `${CATEGORY_NAMES[m.category]}. Daño ${dmg}, ${rate} disparos por segundo, cargador ${st.magazine}. ${reach}${st.scope ? " Mira telescópica." : ""}`;
}

// ---------- Vista 3D (personaje o arma) ----------
class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  private pivot = new THREE.Group();
  private char: Character | null = null;
  private charSkin = "";
  private weaponOnly = new THREE.Group();
  private spin = 0.5;
  private dragging = false;
  private token = 0;
  private mode: "character" | "weapon" = "character";
  private last = performance.now();
  running = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    initKTX2(this.renderer);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMappingExposure = 1.05;
    // sombras suaves del personaje sobre la plataforma
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
    // Iluminación de estudio: luz principal cálida arriba a la izquierda (con sombra), relleno frío
    // tenue al frente y dos luces de contorno detrás que separan la silueta del fondo
    const key = new THREE.DirectionalLight(0xfff1e0, 3.0); key.position.set(-1.6, 3.2, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.1, right: 1.1, top: 2.1, bottom: -0.3, near: 0.5, far: 8 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.55); fill.position.set(2.4, 1.1, 2.6);
    const rimL = new THREE.DirectionalLight(0x8fd8ff, 1.9); rimL.position.set(-2.6, 2.2, -2.4);
    const rimR = new THREE.DirectionalLight(0xa8cfff, 1.7); rimR.position.set(2.6, 2.6, -2.2);
    this.scene.add(key, key.target, fill, rimL, rimR, new THREE.HemisphereLight(0x8fa8c8, 0x0c1220, 0.35));
    // plataforma
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.78, 0.05, 48), new THREE.MeshStandardMaterial({ color: 0x0f1c30, roughness: 0.55, metalness: 0.5 }));
    disc.position.y = -0.03;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.73, 0.01, 8, 64), new THREE.MeshBasicMaterial({ color: 0x3cc4ff }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.005;
    this.pivot.add(disc, ring);
    this.scene.add(this.pivot, this.weaponOnly);
    canvas.addEventListener("pointerdown", (e) => { this.dragging = true; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointerup", () => { this.dragging = false; });
    canvas.addEventListener("pointermove", (e) => { if (this.dragging) this.spin += e.movementX * 0.01; });
  }

  async setCharacter(look: Look, weaponId: string) {
    const token = ++this.token;
    if (this.charSkin !== look.skin) {
      await loadSkin(look.skin);
      if (token !== this.token) return;
      if (this.char) this.pivot.remove(this.char.body);
      this.char = buildCharacter(look.skin);
      this.charSkin = look.skin;
      if (this.char) {
        this.char.body.rotation.y = Math.PI; // de frente a la cámara
        this.pivot.add(this.char.body);
      }
    }
    const w = await weaponObject(weaponId);
    if (token !== this.token) return;
    const cat = weaponModel(weaponId)?.category;
    this.char?.holdWeapon(w, cat === "melee" ? "melee" : cat === "pistol" ? "pistol" : "rifle");
  }

  async setWeapon(id: string) {
    const token = ++this.token;
    const w = await weaponObject(id);
    if (token !== this.token || !w) return;
    this.weaponOnly.clear();
    const size = new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3());
    const k = 1.7 / Math.max(size.z, size.y * 2.2, 0.3);
    // el modelo va dentro de un soporte: así el giro "de lado" no se mezcla con los giros propios del modelo
    const holder = new THREE.Group();
    holder.add(w);
    holder.scale.setScalar(k);
    holder.rotation.y = Math.PI / 2;
    this.weaponOnly.add(holder);
  }

  setMode(mode: "character" | "weapon") { this.mode = mode; }

  private frame = () => {
    if (!this.running) return;
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      const char = this.mode === "character";
      if (!this.dragging) {
        // el personaje se balancea de tres cuartos mirando a la cámara; el arma gira entera
        if (char) this.spin += (0.45 + Math.sin(now / 2600) * 0.3 - this.spin) * Math.min(1, dt * 1.5);
        else this.spin += dt * 0.35;
      }
      this.pivot.visible = char;
      this.weaponOnly.visible = !char;
      // la cámara se aleja si la vista es estrecha, para que el personaje o el arma quepan a lo ancho
      const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
      if (char) {
        this.pivot.rotation.y = this.spin;
        this.char?.update(dt, 0, false);
        const d = Math.max(3.7, 0.95 / halfW);
        this.camera.position.set(0, 1.15, d);
        this.camera.lookAt(0, 0.93, 0);
      } else {
        this.weaponOnly.rotation.y = this.spin;
        // lo más cerca posible sin que el arma (1,7 m de largo al girar) se salga por los lados ni por arriba
        const d = Math.max(2.1, 1.0 / halfW, 0.62 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
        this.camera.position.set(0, 0.35 * d / 3.2, d);
        this.camera.lookAt(0, 0, 0);
      }
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame(this.frame);
  };

  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
}

// ---------- Miniaturas (se dibujan una a una cuando la ficha entra en pantalla) ----------
class Thumbs {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cache = new Map<string, string>();
  private queue: { key: string; make: () => Promise<THREE.Object3D | null>; view: "side" | "front"; done: (url: string) => void }[] = [];
  private busy = false;
  private io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { this.io.unobserve(e.target); (e.target as HTMLElement & { _load?: () => void })._load?.(); }
  }, { rootMargin: "200px" });

  attach(img: HTMLImageElement, key: string, make: () => Promise<THREE.Object3D | null>, view: "side" | "front") {
    const hit = this.cache.get(key);
    if (hit) { img.src = hit; return; }
    (img as HTMLImageElement & { _load?: () => void })._load = () => {
      this.queue.push({ key, make, view, done: (url) => { img.src = url; } });
      void this.pump();
    };
    this.io.observe(img);
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      let url = this.cache.get(job.key);
      if (!url) {
        try { url = await this.render(job); } catch { url = ""; }
        if (url) this.cache.set(job.key, url);
      }
      if (url) job.done(url);
      await new Promise((r) => setTimeout(r, 0)); // deja respirar a la página
    }
    this.busy = false;
  }

  private async render(job: { make: () => Promise<THREE.Object3D | null>; view: "side" | "front" }): Promise<string> {
    if (!this.renderer) {
      const c = document.createElement("canvas");
      c.width = 240; c.height = 150;
      this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
      initKTX2(this.renderer);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-1, 2, 2);
      this.scene.add(key);
    }
    const o = await job.make();
    if (!o) return "";
    const holder = new THREE.Group();
    holder.add(o);
    this.scene.add(holder);
    holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
    const dir = job.view === "side" ? new THREE.Vector3(1, 0.12, 0.25).normalize() : new THREE.Vector3(0.35, 0.15, 1).normalize();
    const span = job.view === "side" ? Math.max(size.z, size.y * 1.6) : Math.max(size.x * 1.6, size.y, size.z);
    const half = span * (job.view === "side" ? 0.35 : 0.56);
    const cam = new THREE.OrthographicCamera(-half * 1.6, half * 1.6, half, -half, 0.001, span * 40);
    cam.position.copy(ctr).addScaledVector(dir, span * 8);
    cam.lookAt(ctr);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL("image/webp", 0.85);
    this.scene.remove(holder);
    return url;
  }
}

// ---------- Menú ----------
export interface MenuOptions {
  mapId: string;
  quality: string;
  state: MenuState;
  onPlay(state: MenuState): Promise<void>;
  onMap(id: string): void;
  onQuality(q: string): void;
  onSettings(s: Settings): void;
}

type Tab = "jugar" | "armas" | "ajustes";
const SLOT_NAMES = ["Principal", "Pistola", "Arma blanca"];
const SLOT_CATS: Category[][] = [["rifle", "smg", "shotgun", "sniper", "cannon"], ["pistol"], ["melee"]];
const BOT_STEPS = [0, 1, 2, 3, 4, 6, 8];
const QUALITY_NAMES: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta" };
const MAP_MODE = "Todos contra todos";

const icon = (paths: string, size = 22) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", String(size)); s.setAttribute("height", String(size));
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = paths;
  return s;
};
const GEAR_ICON = '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"></path>';

/**
 * Menú "vestíbulo": a la izquierda tu nombre en grande, tu equipo y los bots; a la derecha el personaje
 * en 3D sosteniendo su arma; abajo tres fichas grandes (Jugar con el mapa, Arsenal y Ajustes).
 * Arsenal y Ajustes abren su panel a la izquierda sin salir del vestíbulo.
 */
export function createMenu(root: HTMLElement, opts: MenuOptions) {
  const state = opts.state;
  const thumbs = new Thumbs();
  let tab: Tab = "jugar";
  let slot = 0;
  let focusWeapon = state.loadout[0];

  root.replaceChildren();
  const canvas = el("canvas", { id: "preview", "aria-label": "Vista 3D: arrastra para girar" });
  const preview = new Preview(canvas);
  const stage = el("div", { class: "m-stage" }, canvas);
  const stageInfo = el("div", { class: "m-stage-info" });
  stage.append(stageInfo);

  // barra superior
  const qualityChip = el("button", { type: "button", class: "m-chipbtn" });
  const gearBtn = el("button", { type: "button", class: "m-iconbtn", "aria-label": "Ajustes" }, icon(GEAR_ICON, 20));
  const top = el("header", { class: "m-top" },
    el("h1", { class: "m-logo" }, "NEON", el("span", {}, "STRIKE")),
    el("div", { class: "m-top-right" }, qualityChip, gearBtn));

  // panel izquierdo (cambia según la sección)
  const left = el("section", { class: "m-left" });

  // fichas inferiores
  const error = el("div", { id: "menu-error", role: "alert" });
  const playBtn = el("button", { id: "join-btn", type: "button", class: "m-play" });
  const playLabel = el("span", { class: "m-play-label" }, "Jugar");
  const playMap = el("span", { class: "m-play-map" });
  playBtn.append(playLabel, playMap);
  const mapImg = el("img", { class: "m-tile-img", alt: "", src: `${import.meta.env.BASE_URL}assets/ui/map_${opts.mapId}.jpg` });
  mapImg.addEventListener("error", () => mapImg.remove());
  const mapBtn = el("button", { type: "button", class: "m-mapbtn", "aria-haspopup": "true" }, "Cambiar mapa");
  const mapMenu = el("div", { class: "m-mapmenu hidden", role: "menu" });
  for (const id of PLAYABLE_MAPS) {
    const b = el("button", { type: "button", role: "menuitem", class: id === opts.mapId ? "on" : "" },
      el("img", { alt: "", src: `${import.meta.env.BASE_URL}assets/ui/map_${id}.jpg` }), el("span", {}, MAPS[id].name));
    b.addEventListener("click", () => { mapMenu.classList.add("hidden"); if (id !== opts.mapId) opts.onMap(id); });
    mapMenu.append(b);
  }
  mapBtn.addEventListener("click", (e) => { e.stopPropagation(); mapMenu.classList.toggle("hidden"); });
  document.addEventListener("click", () => mapMenu.classList.add("hidden"));
  const playTile = el("div", { class: "m-tile m-tile-play" }, mapImg, playBtn, mapBtn, mapMenu);

  const armsImg = el("img", { class: "m-tile-weapon", alt: "", width: "240", height: "150" });
  const armsSub = el("span", { class: "m-tile-sub" });
  const armsTile = el("button", { type: "button", class: "m-tile m-tile-nav", "data-tab": "armas" },
    armsImg, el("span", { class: "m-tile-text" }, el("span", { class: "m-tile-title" }, "Arsenal"), armsSub));
  const setTile = el("button", { type: "button", class: "m-tile m-tile-nav", "data-tab": "ajustes" },
    el("span", { class: "m-tile-icon" }, icon(GEAR_ICON, 54)),
    el("span", { class: "m-tile-text" }, el("span", { class: "m-tile-title" }, "Ajustes"), el("span", { class: "m-tile-sub" }, "Ratón, volumen y gráficos")));
  const tiles = el("nav", { class: "m-tiles", "aria-label": "Menú principal" }, playTile, armsTile, setTile);

  root.append(stage, top, left, tiles, error);

  const go = (t: Tab) => { tab = tab === t && t !== "jugar" ? "jugar" : t; render(); };
  armsTile.addEventListener("click", () => go("armas"));
  setTile.addEventListener("click", () => go("ajustes"));
  gearBtn.addEventListener("click", () => go("ajustes"));
  qualityChip.addEventListener("click", () => go("ajustes"));

  const refreshPreview = () => {
    if (tab === "armas") { preview.setMode("weapon"); void preview.setWeapon(focusWeapon); }
    else { preview.setMode("character"); void preview.setCharacter(state.look, state.loadout[slot] ?? state.loadout[0]); }
  };
  const refreshTiles = () => {
    playMap.textContent = `${MAPS[opts.mapId]?.name ?? ""} · ${MAP_MODE}`;
    thumbs.attach(armsImg, `w:${state.loadout[0]}`, () => weaponObject(state.loadout[0]), "side");
    armsSub.textContent = state.loadout.map((id) => weaponModel(id)?.name ?? "").join(" · ");
    qualityChip.replaceChildren("Calidad ", el("b", {}, QUALITY_NAMES[opts.quality] ?? opts.quality));
    tiles.querySelectorAll<HTMLElement>(".m-tile-nav").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };
  const change = () => { saveState(state); refreshPreview(); refreshTiles(); };

  function statBars(id: string) {
    const box = el("div", { class: "m-bars" });
    for (const [label, v] of bars(weaponStats(id))) {
      const fill = el("i"); fill.style.width = `${Math.round(v * 100)}%`;
      box.append(el("div", { class: "m-bar" }, el("span", {}, label), el("b", {}, fill)));
    }
    return box;
  }

  function weaponCard(id: string, selected: boolean) {
    const m = weaponModel(id)!;
    const img = el("img", { alt: "", width: "240", height: "150", loading: "lazy" });
    thumbs.attach(img, `w:${id}`, () => weaponObject(id), "side");
    const b = el("button", { type: "button", class: "m-card" + (selected ? " on" : ""), "aria-pressed": selected ? "true" : "false" },
      img, el("span", { class: "m-card-name" }, m.name),
      el("span", { class: "m-card-sub" }, `${CATEGORY_NAMES[m.category]}${m.futuristic ? " · energía" : ""}`));
    b.addEventListener("click", () => { state.loadout[slot] = id; focusWeapon = id; change(); render(); });
    b.addEventListener("mouseenter", () => { if (focusWeapon !== id) { focusWeapon = id; void preview.setWeapon(id); showWeaponInfo(); } });
    return b;
  }

  function showWeaponInfo() {
    const m = weaponModel(focusWeapon);
    stageInfo.replaceChildren();
    if (tab !== "armas" || !m) return;
    stageInfo.append(
      el("h2", {}, m.name),
      el("p", { class: "m-info-sub" }, `${CATEGORY_NAMES[m.category]}${m.author ? ` · modelo de ${m.author}` : ""}`),
      statBars(focusWeapon),
      el("p", { class: "m-info-text" }, describe(focusWeapon)),
    );
  }

  const back = () => {
    const b = el("button", { type: "button", class: "m-back" }, "← Volver");
    b.addEventListener("click", () => { tab = "jugar"; render(); });
    return b;
  };

  function renderLobby() {
    const name = el("input", { id: "name", class: "m-bigname", maxlength: "16", autocomplete: "nickname", placeholder: "Jugador", value: state.name, "aria-label": "Tu nombre" });
    name.addEventListener("input", () => { state.name = name.value; saveState(state); });
    const chips = el("div", { class: "m-chips" }, el("span", { class: "m-chip" }, "Vida ", el("b", {}, String(MAX_HP))));
    state.loadout.forEach((id, i) => {
      const c = el("button", { type: "button", class: "m-chip m-chip-btn", title: `Cambiar ${SLOT_NAMES[i].toLowerCase()}` }, `${i + 1} · ${weaponModel(id)?.name ?? ""}`);
      c.addEventListener("click", () => { slot = i; focusWeapon = id; tab = "armas"; render(); });
      chips.append(c);
    });
    const count = el("output", { class: "m-bots-n" }, String(state.settings.bots));
    const step = (d: number) => {
      const i = BOT_STEPS.findIndex((n) => n >= state.settings.bots);
      const next = BOT_STEPS[Math.max(0, Math.min(BOT_STEPS.length - 1, (i < 0 ? BOT_STEPS.length - 1 : i) + d))];
      state.settings.bots = next; count.textContent = String(next); saveState(state);
    };
    const minus = el("button", { type: "button", class: "m-step", "aria-label": "Menos bots" }, "−");
    const plus = el("button", { type: "button", class: "m-step", "aria-label": "Más bots" }, "+");
    minus.addEventListener("click", () => step(-1));
    plus.addEventListener("click", () => step(1));
    left.append(
      el("p", { class: "m-eyebrow" }, "Listo para combatir"),
      name,
      chips,
      el("div", { class: "m-bots" }, el("span", { class: "m-label" }, "Bots"), minus, count, plus,
        el("span", { class: "m-bots-hint" }, "rivales controlados por el juego")),
    );
  }

  function renderArsenal() {
    const slots = el("div", { class: "m-seg" });
    SLOT_NAMES.forEach((n, i) => {
      const b = el("button", { type: "button", class: i === slot ? "on" : "" }, `${i + 1} · ${n}`);
      b.addEventListener("click", () => { slot = i; focusWeapon = state.loadout[i]; render(); });
      slots.append(b);
    });
    const list = el("div", { class: "m-panel" });
    for (const cat of SLOT_CATS[slot]) {
      for (const fut of [false, true]) {
        const ws = WEAPON_MODELS.filter((w) => w.category === cat && w.futuristic === fut);
        if (!ws.length) continue;
        list.append(el("h3", {}, `${CATEGORY_NAMES[cat]}${fut ? " · futuristas" : ""}`));
        const grid = el("div", { class: "m-grid" });
        for (const w of ws) grid.append(weaponCard(w.id, state.loadout[slot] === w.id));
        list.append(grid);
      }
    }
    left.append(el("div", { class: "m-panel-head" }, back(), el("h2", {}, "Arsenal")), slots, list);
  }

  function renderSettings() {
    const range = (label: string, key: "sens" | "volume" | "music", min: number, max: number, stepv: number, fmt: (v: number) => string) => {
      const input = el("input", { type: "range", min: String(min), max: String(max), step: String(stepv), value: String(state.settings[key]) });
      const out = el("output", {}, fmt(state.settings[key]));
      input.addEventListener("input", () => { state.settings[key] = parseFloat(input.value); out.textContent = fmt(state.settings[key]); saveState(state); opts.onSettings(state.settings); });
      return el("label", { class: "m-field" }, el("span", {}, label), el("div", { class: "m-range" }, input, out));
    };
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const q = el("select", { id: "quality" });
    q.append(new Option("Baja: PCs modestos y portátiles", "low"), new Option("Media: sombras y brillo", "medium"), new Option("Alta: sombras suaves y antialiasing", "high"));
    q.value = opts.quality;
    q.addEventListener("change", () => opts.onQuality(q.value));
    left.append(
      el("div", { class: "m-panel-head" }, back(), el("h2", {}, "Ajustes")),
      el("div", { class: "m-panel" },
        range("Sensibilidad del ratón", "sens", 0.3, 2.5, 0.05, (v) => `${v.toFixed(2)}×`),
        range("Volumen de efectos", "volume", 0, 1, 0.05, pct),
        range("Volumen de música", "music", 0, 1, 0.05, pct),
        el("label", { class: "m-field" }, el("span", {}, "Calidad gráfica"), q),
        el("h3", {}, "Controles"),
        el("div", { class: "controls" },
          el("div", {}, "W A S D moverse · Shift correr · Espacio saltar"),
          el("div", {}, "Clic disparar · Clic derecho apuntar · R recargar"),
          el("div", {}, "1 2 3 o rueda del ratón: cambiar de arma"),
          el("div", {}, "Tab marcador · Esc pausa")),
        el("p", { class: "m-note" }, "Estos ajustes también están en el menú de pausa (Esc) durante la partida.")),
    );
  }

  function render() {
    root.dataset.tab = tab;
    left.replaceChildren();
    if (tab === "armas") renderArsenal();
    else if (tab === "ajustes") renderSettings();
    else renderLobby();
    refreshPreview();
    refreshTiles();
    showWeaponInfo();
  }

  playBtn.addEventListener("click", async () => {
    if (!state.name.trim()) state.name = "Jugador";
    saveState(state);
    error.textContent = "";
    playBtn.disabled = true;
    try { await opts.onPlay(state); }
    catch (e) { console.error(e); error.textContent = "No se pudo conectar al servidor. ¿Está encendido?"; }
    finally { playBtn.disabled = false; playLabel.textContent = "Jugar"; }
  });

  render();

  return {
    show() { root.classList.remove("hidden"); preview.start(); },
    hide() { root.classList.add("hidden"); preview.stop(); },
    setError(msg: string) { error.textContent = msg; },
    setBusy(text: string | null) { playBtn.disabled = text !== null; playLabel.textContent = text ?? "Jugar"; },
    start() { preview.start(); },
  };
}
