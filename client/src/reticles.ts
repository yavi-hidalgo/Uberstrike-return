// Miras: la cruz al disparar desde la cadera (distinta por tipo de arma y abierta según la
// dispersión real), la mira holográfica al apuntar con clic derecho y la mira telescópica de los
// francotiradores (óptica en las armas normales, digital en las de energía, con la distancia).
import type { WeaponFx } from "./fx";

export type Reticle = "rifle" | "smg" | "pistol" | "shotgun" | "sniper" | "launcher" | "plasma" | "rail" | "minigun" | "melee";

export function reticleOf(fx: Pick<WeaponFx, "category" | "cannon">): Reticle {
  if (fx.cannon === "rocket") return "launcher";
  if (fx.cannon === "plasma") return "plasma";
  if (fx.cannon === "rail") return "rail";
  if (fx.cannon === "minigun") return "minigun";
  switch (fx.category) {
    case "melee": return "melee";
    case "shotgun": return "shotgun";
    case "smg": return "smg";
    case "pistol": return "pistol";
    case "sniper": return "sniper";
    default: return "rifle";
  }
}

const NS = "http://www.w3.org/2000/svg";
const svg = (viewBox: string, body: string, cls: string) => {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = body;
  return s;
};

/** Anillo de radio `r` partido en `n` arcos, con huecos de `gap` radianes centrados en los ejes. */
function arcs(r: number, n: number, gap: number): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + gap / 2, a1 = ((i + 1) / n) * Math.PI * 2 - gap / 2;
    const p = (a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    d += `M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} `;
  }
  return `<path d="${d}" class="s thin"/>`;
}

/** Mira holográfica al apuntar (se dibuja en el centro, sobre el arma). Coordenadas -60..60. */
function adsBody(k: Reticle): string {
  switch (k) {
    case "smg": // punto con tres trazos a 120°
      return `<circle r="2.6" class="f"/><path d="M0 -16 V -9 M13.9 8 L7.8 4.5 M-13.9 8 L-7.8 4.5" class="s"/>`;
    case "pistol": // punto con dos barras laterales
      return `<circle r="2.8" class="f"/><path d="M-18 0 H-9 M9 0 H18" class="s"/>`;
    case "shotgun": // anillo grande en cuatro arcos (con cortes arriba, abajo y a los lados) y punto
      return arcs(40, 4, 0.22) + `<circle r="2.4" class="f"/>`;
    case "launcher": // chevrón con marcas de caída
      return `<path d="M-10 6 L0 -4 L10 6" class="s"/><path d="M-6 16 H6 M-4.5 25 H4.5 M-3 34 H3" class="s thin"/>`;
    case "plasma": // anillos concéntricos
      return `<circle r="22" class="s thin"/><circle r="9" class="s thin"/><circle r="2" class="f"/>`;
    case "rail": // rombo con punto
      return `<path d="M0 -16 L16 0 L0 16 L-16 0 Z" class="s thin"/><circle r="1.8" class="f"/><path d="M-30 0 H-22 M22 0 H30" class="s thin"/>`;
    case "minigun": // anillo con marcas
      return `<circle r="30" class="s thin"/><path d="M0 -36 V-26 M0 26 V36 M-36 0 H-26 M26 0 H36" class="s"/><circle r="2.4" class="f"/>`;
    default: // rifle: holográfico de anillo y punto con marca inferior
      return `<circle r="30" class="s"/><circle r="2.4" class="f"/><path d="M0 30 V38" class="s"/>`;
  }
}

/** Retícula óptica (armas normales): postes gruesos, cruz fina, puntos de mil y marcas de caída. Coordenadas -100..100. */
const OPTICAL =
  `<path d="M-100 0 H-34 M34 0 H100 M0 34 V100" class="post"/>` +
  `<path d="M-34 0 H34 M0 -100 V34" class="fine"/>` +
  [-28, -21, -14, -7, 7, 14, 21, 28].map((x) => `<circle cx="${x}" cy="0" r="1.15" class="mil"/><circle cx="0" cy="${x}" r="1.15" class="mil"/>`).join("") +
  `<path d="M-6 9 H6 M-4.5 16 H4.5 M-3.5 23 H3.5" class="fine"/>` +
  `<text x="8" y="10.5" class="lbl">2</text><text x="6.5" y="17.5" class="lbl">4</text><text x="5.5" y="24.5" class="lbl">6</text>` +
  `<circle r="0.9" class="dot"/>`;

/** Retícula digital (armas de energía): cruz con hueco, marcas numeradas y esquinas. */
const DIGITAL =
  `<path d="M-70 0 H-8 M8 0 H70 M0 -70 V-8 M0 8 V70" class="d"/>` +
  `<circle r="4" class="d"/>` +
  `<path d="M-40 -34 V-40 H-34 M34 -40 H40 V-34 M40 34 V40 H34 M-34 40 H-40 V34" class="d wide"/>` +
  [-60, -45, -30, -15, 15, 30, 45, 60].map((x) => `<path d="M${x} -2.5 V2.5" class="d"/>`).join("") +
  `<text x="-60" y="-6" class="dl">-4</text><text x="-30" y="-6" class="dl">-2</text><text x="30" y="-6" class="dl">2</text><text x="60" y="-6" class="dl">4</text>`;

export class Reticles {
  private hip: HTMLElement;
  private ads: HTMLElement;
  private scope: HTMLElement;
  private range: HTMLElement;
  private zoom: HTMLElement;
  private kind: Reticle | "" = "";
  private energy = false;

  constructor(hip: HTMLElement, ads: HTMLElement, scope: HTMLElement) {
    this.hip = hip; this.ads = ads; this.scope = scope;
    // cruz de la cadera: rayas, anillo, punto, chevrón y marcas de caída (cada tipo muestra lo suyo)
    hip.replaceChildren();
    for (const c of ["t t1", "t t2", "t t3", "t t4", "ring", "dot", "chev", "drop", "diam"]) {
      const e = document.createElement("i"); e.className = c; hip.append(e);
    }
    // mira telescópica
    scope.replaceChildren();
    const lens = document.createElement("div"); lens.className = "scope-lens";
    const info = document.createElement("div"); info.className = "scope-info";
    this.range = document.createElement("span"); this.range.className = "scope-range";
    this.zoom = document.createElement("span"); this.zoom.className = "scope-zoom";
    info.append(this.range, this.zoom);
    scope.append(lens, info);
  }

  /** Cambia las miras según el arma en la mano. */
  setWeapon(fx: Pick<WeaponFx, "category" | "cannon" | "energy">) {
    const k = reticleOf(fx);
    if (k === this.kind && fx.energy === this.energy) return;
    this.kind = k; this.energy = fx.energy;
    this.hip.className = `k-${k}${fx.energy ? " energy" : ""}`;
    this.ads.className = fx.energy ? "energy" : "";
    this.ads.replaceChildren(svg("-60 -60 120 120", adsBody(k), "ads-svg"));
    const lens = this.scope.querySelector(".scope-lens")!;
    lens.replaceChildren(svg("-100 -100 200 200", fx.energy ? DIGITAL : OPTICAL, "scope-svg"));
    this.scope.classList.toggle("digital", fx.energy);
  }

  /**
   * Estado de cada cuadro: `gap` apertura de la cruz (px), `ads` apuntando sin mira telescópica,
   * `scoped` con mira telescópica, `range` distancia al punto apuntado (m) y `zoom` aumentos.
   */
  update(s: { gap: number; ads: boolean; scoped: boolean; range: number | null; zoom: number }) {
    this.hip.style.setProperty("--gap", `${s.gap.toFixed(1)}px`);
    this.hip.classList.toggle("off", s.ads || s.scoped);
    this.ads.classList.toggle("on", s.ads);
    this.scope.classList.toggle("hidden", !s.scoped);
    if (s.scoped) {
      this.range.textContent = s.range == null ? "--- m" : `${Math.round(s.range)} m`;
      this.zoom.textContent = `×${s.zoom.toFixed(1)}`;
    }
  }
}
