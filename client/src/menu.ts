// Menú principal estilo vestuario: el personaje en 3D con su skin, equipo y arma, y pestañas para
// elegir armas (galería + visor 3D), skins, equipo y ajustes. Todo se guarda en el navegador.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  CATEGORY_NAMES, WEAPON_MODELS, validLoadout, weaponModel, weaponStats, type Category, type Loadout, type WeaponStats,
} from "../../shared/src/weapons";
import { GEAR, LEGACY_SKINS, SKINS, gearHp, validLook, type GearSlot, type Look } from "../../shared/src/gear";
import { MAX_HP } from "../../shared/src/constants";
import { MAPS, PLAYABLE_MAPS } from "../../shared/src/maps";
import { buildCharacter, loadGearModel, loadSkin, type Character } from "./skins";
import { weaponObject } from "./weaponmodels";
import { initKTX2 } from "./ktx";

export interface Settings { sens: number; volume: number; music: number }
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
    settings: { sens: num("sens", 1), volume: num("volume", 0.8), music: num("music", 0.5) },
  };
}

function saveState(s: MenuState) {
  store.set("name", s.name);
  store.set("primary", s.loadout[0]); store.set("secondary", s.loadout[1]); store.set("melee", s.loadout[2]);
  store.set("skin", s.look.skin); store.set("helmet", s.look.helmet); store.set("vest", s.look.vest); store.set("pack", s.look.pack);
  store.set("sens", String(s.settings.sens)); store.set("volume", String(s.settings.volume)); store.set("music", String(s.settings.music));
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
  private hand = new THREE.Group();
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
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    pm.dispose();
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6); key.position.set(-2, 3, 3);
    const rim = new THREE.DirectionalLight(0x8fb6ff, 2.2); rim.position.set(2.5, 2, -3);
    this.scene.add(key, rim, new THREE.AmbientLight(0x30384a, 0.8));
    // plataforma
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.02, 0.06, 48), new THREE.MeshStandardMaterial({ color: 0x1b222e, roughness: 0.5, metalness: 0.6 }));
    disc.position.y = -0.03;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffb547 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.005;
    this.pivot.add(disc, ring);
    this.scene.add(this.pivot, this.weaponOnly);
    canvas.addEventListener("pointerdown", (e) => { this.dragging = true; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointerup", () => { this.dragging = false; });
    canvas.addEventListener("pointermove", (e) => { if (this.dragging) this.spin += e.movementX * 0.01; });
  }

  async setCharacter(look: Look, weaponId: string) {
    const token = ++this.token;
    if (LEGACY_SKINS.includes(look.skin)) {
      // las skins anteriores no se muestran en el vestuario 3D: se usa su ficha
    }
    if (this.charSkin !== look.skin) {
      await loadSkin(look.skin);
      if (token !== this.token) return;
      if (this.char) this.pivot.remove(this.char.body);
      this.char = buildCharacter(look.skin);
      this.charSkin = look.skin;
      if (this.char) {
        this.char.body.rotation.y = Math.PI; // de frente a la cámara
        this.hand.position.set(0.15, 1.08, -0.15);
        this.char.body.add(this.hand);
        this.pivot.add(this.char.body);
      }
    }
    await this.char?.setGear(look);
    const w = await weaponObject(weaponId);
    if (token !== this.token) return;
    this.hand.clear();
    if (w) {
      const len = new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3()).z;
      const melee = weaponModel(weaponId)?.category === "melee";
      if (melee) { w.rotation.x = 1.1; w.position.set(0.05, 0.25, -0.2); }
      else w.position.z -= len * 0.3;
      this.hand.add(w);
    }
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
      if (!this.dragging) this.spin += dt * 0.35;
      const char = this.mode === "character";
      this.pivot.visible = char;
      this.weaponOnly.visible = !char;
      if (char) {
        this.pivot.rotation.y = this.spin;
        this.char?.update(dt, 0, false);
        this.camera.position.set(0, 1.15, 4.6);
        this.camera.lookAt(0, 0.92, 0);
      } else {
        this.weaponOnly.rotation.y = this.spin;
        // el arma queda en la mitad superior; debajo va su ficha
        this.camera.position.set(0, 0.1, 3.4);
        this.camera.lookAt(0, -0.42, 0);
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

const TABS = [["jugar", "Jugar"], ["armas", "Armas"], ["skins", "Skins"], ["equipo", "Equipo"], ["ajustes", "Ajustes"]] as const;
const SLOT_NAMES = ["Principal", "Pistola", "Arma blanca"];
const SLOT_CATS: Category[][] = [["rifle", "smg", "shotgun", "sniper", "cannon"], ["pistol"], ["melee"]];
const GEAR_NAMES: Record<GearSlot, string> = { helmet: "Casco", vest: "Chaleco", pack: "Mochila" };

export function createMenu(root: HTMLElement, opts: MenuOptions) {
  const state = opts.state;
  const thumbs = new Thumbs();
  let tab: (typeof TABS)[number][0] = "jugar";
  let slot = 0;
  let focusWeapon = state.loadout[0];

  root.replaceChildren();
  const canvas = el("canvas", { id: "preview", "aria-label": "Vista 3D del personaje" });
  const preview = new Preview(canvas);
  const tabsBar = el("nav", { class: "m-tabs", "aria-label": "Secciones" });
  const panel = el("div", { class: "m-panel" });
  const stage = el("div", { class: "m-stage" }, canvas);
  const stageInfo = el("div", { class: "m-stage-info" });
  stage.append(stageInfo);
  const error = el("div", { id: "menu-error", role: "alert" });
  const playBtn = el("button", { id: "join-btn", type: "button", class: "m-play" }, "Jugar");
  const summary = el("div", { class: "m-summary" });
  const foot = el("div", { class: "m-foot" }, summary, el("div", { class: "m-foot-right" }, error, playBtn));
  root.append(
    el("header", { class: "m-head" }, el("div", { class: "m-logo" }, "NEON", el("span", {}, "STRIKE")), tabsBar),
    el("div", { class: "m-body" }, panel, stage),
    foot,
  );

  for (const [id, label] of TABS) {
    const b = el("button", { type: "button", class: "m-tab", "data-tab": id }, label);
    b.addEventListener("click", () => { tab = id; render(); });
    tabsBar.append(b);
  }

  const refreshPreview = () => {
    if (tab === "armas") { preview.setMode("weapon"); void preview.setWeapon(focusWeapon); }
    else { preview.setMode("character"); void preview.setCharacter(state.look, state.loadout[tab === "equipo" || tab === "skins" ? 0 : slot] ?? state.loadout[0]); }
  };

  const hpTotal = () => MAX_HP + gearHp(state.look);
  const refreshSummary = () => {
    summary.replaceChildren(
      el("span", { class: "m-chip hp" }, `♥ ${hpTotal()} de vida`),
      ...state.loadout.map((id, i) => el("span", { class: "m-chip" }, `${i + 1} · ${weaponModel(id)?.name ?? ""}`)),
    );
  };

  const change = () => { saveState(state); refreshSummary(); refreshPreview(); };

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
    b.addEventListener("click", () => {
      state.loadout[slot] = id;
      focusWeapon = id;
      change(); render();
    });
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

  function field(label: string, control: HTMLElement, hint?: string) {
    return el("label", { class: "m-field" }, el("span", {}, label), control, hint ? el("small", {}, hint) : null);
  }

  function render() {
    tabsBar.querySelectorAll<HTMLElement>(".m-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    panel.replaceChildren();
    panel.scrollTop = 0;
    if (tab === "jugar") {
      const name = el("input", { id: "name", maxlength: "16", autocomplete: "nickname", placeholder: "Jugador", value: state.name });
      name.addEventListener("input", () => { state.name = name.value; saveState(state); });
      const map = el("select", { id: "map-select" });
      for (const id of PLAYABLE_MAPS) map.append(new Option(MAPS[id].name, id));
      map.value = opts.mapId;
      map.addEventListener("change", () => opts.onMap(map.value));
      const q = el("select", { id: "quality" });
      q.append(new Option("Baja: PCs modestos y portátiles", "low"), new Option("Media: sombras y brillo", "medium"), new Option("Alta: sombras suaves y antialiasing", "high"));
      q.value = opts.quality;
      q.addEventListener("change", () => opts.onQuality(q.value));
      const load = el("div", { class: "m-loadout" });
      state.loadout.forEach((id, i) => {
        const img = el("img", { alt: "", width: "240", height: "150" });
        thumbs.attach(img, `w:${id}`, () => weaponObject(id), "side");
        const b = el("button", { type: "button", class: "m-slot" }, el("span", { class: "m-slot-key" }, String(i + 1)), img,
          el("span", { class: "m-card-name" }, weaponModel(id)?.name ?? ""), el("span", { class: "m-card-sub" }, SLOT_NAMES[i]));
        b.addEventListener("click", () => { slot = i; focusWeapon = id; tab = "armas"; render(); });
        load.append(b);
      });
      panel.append(
        field("Tu nombre", name), field("Mapa", map), field("Calidad gráfica", q),
        el("h3", {}, "Tu equipo"), load,
        el("div", { class: "controls" },
          el("div", {}, "W A S D moverse · Shift correr · Espacio saltar"),
          el("div", {}, "Clic disparar · Clic derecho apuntar · R recargar · 1 2 3 arma"),
          el("div", {}, "Tab marcador · Esc pausa")),
      );
    } else if (tab === "armas") {
      const slots = el("div", { class: "m-seg" });
      SLOT_NAMES.forEach((n, i) => {
        const b = el("button", { type: "button", class: i === slot ? "on" : "" }, `${i + 1} · ${n}`);
        b.addEventListener("click", () => { slot = i; focusWeapon = state.loadout[i]; render(); });
        slots.append(b);
      });
      panel.append(slots);
      for (const cat of SLOT_CATS[slot]) {
        for (const fut of [false, true]) {
          const list = WEAPON_MODELS.filter((w) => w.category === cat && w.futuristic === fut);
          if (!list.length) continue;
          panel.append(el("h3", {}, `${CATEGORY_NAMES[cat]}${fut ? " · futuristas" : ""}`));
          const grid = el("div", { class: "m-grid" });
          for (const w of list) grid.append(weaponCard(w.id, state.loadout[slot] === w.id));
          panel.append(grid);
        }
      }
    } else if (tab === "skins") {
      const grid = el("div", { class: "m-grid" });
      for (const s of SKINS) {
        const legacy = LEGACY_SKINS.includes(s.id);
        const img = el("img", { alt: "", width: "240", height: "150", loading: "lazy" });
        if (!legacy) thumbs.attach(img, `s:${s.id}`, async () => { await loadSkin(s.id); const b = buildCharacter(s.id)?.body ?? null; if (b) b.rotation.y = Math.PI; return b; }, "front");
        const on = state.look.skin === s.id;
        const b = el("button", { type: "button", class: "m-card tall" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false" },
          legacy ? el("span", { class: "m-card-ph" }, "★") : img, el("span", { class: "m-card-name" }, s.name),
          el("span", { class: "m-card-sub" }, legacy ? "trae su propio equipo" : `modelo de ${s.author}`));
        b.addEventListener("click", () => { state.look.skin = s.id; change(); render(); });
        grid.append(b);
      }
      panel.append(el("p", { class: "m-note" }, "La skin es solo apariencia. La vida extra la da el equipo."), grid);
    } else if (tab === "equipo") {
      panel.append(el("p", { class: "m-note" }, `El equipo se ve puesto en el personaje y suma vida. Ahora tienes ${hpTotal()} de vida.`));
      for (const gs of ["helmet", "vest", "pack"] as GearSlot[]) {
        panel.append(el("h3", {}, GEAR_NAMES[gs]));
        const grid = el("div", { class: "m-grid" });
        const none = el("button", { type: "button", class: "m-card" + (state.look[gs] === "" ? " on" : "") }, el("span", { class: "m-card-ph" }, "∅"), el("span", { class: "m-card-name" }, "Ninguno"), el("span", { class: "m-card-sub" }, "+0 de vida"));
        none.addEventListener("click", () => { state.look[gs] = ""; change(); render(); });
        grid.append(none);
        for (const g of GEAR.filter((x) => x.slot === gs)) {
          const img = el("img", { alt: "", width: "240", height: "150", loading: "lazy" });
          thumbs.attach(img, `g:${g.id}`, async () => (await loadGearModel(g.id))?.clone(true) ?? null, "front");
          const on = state.look[gs] === g.id;
          const b = el("button", { type: "button", class: "m-card" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false" }, img,
            el("span", { class: "m-card-name" }, g.name), el("span", { class: "m-card-sub hp" }, `+${g.hp} de vida`));
          b.addEventListener("click", () => { state.look[gs] = g.id; change(); render(); });
          grid.append(b);
        }
        panel.append(grid);
      }
      if (LEGACY_SKINS.includes(state.look.skin)) panel.prepend(el("p", { class: "m-note warn" }, "Tu skin actual ya trae casco y chaleco modelados: el equipo suma vida pero no se dibuja encima. Elige otra skin para verlo puesto."));
    } else {
      const range = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
        const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(state.settings[key]) });
        const out = el("output", {}, fmt(state.settings[key]));
        input.addEventListener("input", () => { state.settings[key] = parseFloat(input.value); out.textContent = fmt(state.settings[key]); saveState(state); opts.onSettings(state.settings); });
        return el("label", { class: "m-field" }, el("span", {}, label), el("div", { class: "m-range" }, input, out));
      };
      const pct = (v: number) => `${Math.round(v * 100)} %`;
      panel.append(
        range("Sensibilidad del ratón", "sens", 0.3, 2.5, 0.05, (v) => `${v.toFixed(2)}×`),
        range("Volumen de efectos", "volume", 0, 1, 0.05, pct),
        range("Volumen de música", "music", 0, 1, 0.05, pct),
        el("p", { class: "m-note" }, "Estos ajustes también están en el menú de pausa (Esc) durante la partida."),
      );
    }
    refreshPreview();
    showWeaponInfo();
  }

  playBtn.addEventListener("click", async () => {
    if (!state.name.trim()) state.name = "Jugador";
    saveState(state);
    error.textContent = "";
    playBtn.disabled = true;
    try { await opts.onPlay(state); }
    catch (e) { console.error(e); error.textContent = "No se pudo conectar al servidor. ¿Está encendido?"; }
    finally { playBtn.disabled = false; playBtn.textContent = "Jugar"; }
  });

  refreshSummary();
  render();

  return {
    show() { root.classList.remove("hidden"); preview.start(); },
    hide() { root.classList.add("hidden"); preview.stop(); },
    setError(msg: string) { error.textContent = msg; },
    setBusy(text: string | null) { playBtn.disabled = text !== null; playBtn.textContent = text ?? "Jugar"; },
    start() { preview.start(); },
  };
}
