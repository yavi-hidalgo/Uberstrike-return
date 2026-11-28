// Perfil de efectos de cada arma: cómo se ve y suena su disparo y cuánto patea.
// Sale del tipo de arma, de si es de energía y, para el color y el tono, de su propio id,
// así que dos armas del mismo tipo tampoco se sienten iguales.
import { weaponModel, type CannonKind, type Category } from "../../shared/src/weapons";

export type TracerStyle = "bullet" | "pellet" | "vapor" | "beam" | "bolt" | "rail";

export interface WeaponFx {
  category: Category;
  energy: boolean;
  /** Color del fogonazo, la trazadora y las chispas. */
  color: number;
  flashSize: number;
  flashLight: number;
  flashTime: number;
  tracer: TracerStyle;
  /** Grosor de la trazadora (m). */
  width: number;
  /** Tamaño del impacto (1 = bala de rifle). */
  impact: number;
  /** Humo en la boca del cañón (cantidad de volutas). */
  smoke: number;
  casing: boolean;
  /** Retroceso real de la mira: subida por disparo y desvío lateral máximo (radianes). */
  recoilUp: number;
  recoilSide: number;
  /** Golpe visual del arma en pantalla (1 = normal). */
  kick: number;
  /** Sacudida de la cámara (radianes de balanceo). */
  shake: number;
  /** Tono del sonido (1 = normal). */
  pitch: number;
  /** Elige qué grabación de disparo usa este modelo (0..1), para que cada arma suene distinta. */
  soundVariant: number;
  /** Tipo de cañón (solo en cañones). */
  cannon?: CannonKind;
}

const ENERGY_COLORS = [0x4fd8ff, 0x7dff6a, 0xff5ad6, 0xffa23a, 0x9a7bff, 0xff4a3a, 0x52ffd0];

function hash(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const BALLISTIC: Record<Category, Omit<WeaponFx, "category" | "energy" | "color" | "pitch" | "soundVariant">> = {
  rifle: { flashSize: 1, flashLight: 26, flashTime: 0.05, tracer: "bullet", width: 0.018, impact: 1, smoke: 0, casing: true, recoilUp: 0.011, recoilSide: 0.005, kick: 1, shake: 0.004 },
  smg: { flashSize: 0.7, flashLight: 16, flashTime: 0.035, tracer: "bullet", width: 0.012, impact: 0.7, smoke: 0, casing: true, recoilUp: 0.0055, recoilSide: 0.004, kick: 0.6, shake: 0.002 },
  shotgun: { flashSize: 1.9, flashLight: 45, flashTime: 0.07, tracer: "pellet", width: 0.01, impact: 0.6, smoke: 5, casing: true, recoilUp: 0.05, recoilSide: 0.012, kick: 2.2, shake: 0.02 },
  sniper: { flashSize: 1.7, flashLight: 40, flashTime: 0.06, tracer: "vapor", width: 0.03, impact: 2.2, smoke: 4, casing: true, recoilUp: 0.07, recoilSide: 0.01, kick: 2.6, shake: 0.028 },
  melee: { flashSize: 0, flashLight: 0, flashTime: 0, tracer: "bullet", width: 0, impact: 0.8, smoke: 0, casing: false, recoilUp: 0, recoilSide: 0, kick: 0, shake: 0.006 },
  cannon: { flashSize: 2.2, flashLight: 55, flashTime: 0.09, tracer: "bullet", width: 0.03, impact: 2.5, smoke: 7, casing: false, recoilUp: 0.06, recoilSide: 0.012, kick: 2.4, shake: 0.03 },
  pistol: { flashSize: 0.75, flashLight: 18, flashTime: 0.04, tracer: "bullet", width: 0.012, impact: 0.8, smoke: 0, casing: true, recoilUp: 0.02, recoilSide: 0.006, kick: 1.5, shake: 0.006 },
};

// Las armas de energía patean menos, no sueltan casquillos y dejan rayos de color
const ENERGY: Record<Category, Partial<WeaponFx>> = {
  rifle: { tracer: "bolt", width: 0.05, flashSize: 0.9, flashTime: 0.07, impact: 1.2 },
  smg: { tracer: "bolt", width: 0.035, flashSize: 0.6, flashTime: 0.05, impact: 0.8 },
  shotgun: { tracer: "beam", width: 0.03, flashSize: 1.7, flashTime: 0.1, impact: 0.8, smoke: 0 },
  sniper: { tracer: "rail", width: 0.09, flashSize: 1.6, flashTime: 0.12, impact: 2.6, smoke: 0 },
  pistol: { tracer: "bolt", width: 0.04, flashSize: 0.7, flashTime: 0.06, impact: 1 },
  melee: {},
  cannon: {},
};

// Cada tipo de cañón tiene su propio carácter
const CANNON: Record<CannonKind, Partial<WeaponFx>> = {
  rocket: {},
  plasma: { flashSize: 1.4, flashLight: 40, smoke: 0, recoilUp: 0.03, kick: 1.6, shake: 0.014, impact: 1.6 },
  rail: { tracer: "rail", width: 0.11, flashSize: 1.8, flashTime: 0.14, smoke: 0, recoilUp: 0.07, kick: 2.6, shake: 0.03, impact: 2.8 },
  minigun: { flashSize: 0.9, flashLight: 22, flashTime: 0.03, tracer: "bullet", width: 0.014, impact: 0.7, smoke: 0, casing: true, recoilUp: 0.003, recoilSide: 0.004, kick: 0.45, shake: 0.003 },
};

const cache = new Map<string, WeaponFx>();

export function weaponFx(id: string): WeaponFx {
  let fx = cache.get(id);
  if (fx) return fx;
  const m = weaponModel(id);
  const category = m?.category ?? "rifle";
  const energy = !!m?.futuristic;
  const b = BALLISTIC[category];
  fx = {
    ...b,
    category, energy,
    color: energy ? ENERGY_COLORS[Math.floor(hash(id, 3) * ENERGY_COLORS.length)] : 0xffc37a,
    pitch: 0.88 + hash(id, 11) * 0.26,
    soundVariant: hash(id, 17),
    ...(energy ? ENERGY[category] : {}),
  };
  if (m?.cannon) {
    Object.assign(fx, CANNON[m.cannon]);
    fx.cannon = m.cannon;
    // el riel siempre deja un rayo de color; cohetes y miniguns reales usan tonos cálidos
    if (m.cannon === "rail" && !energy) fx.color = 0x9fd0ff;
    if (m.cannon === "plasma" && !energy) fx.color = 0x7dff6a;
    if (m.cannon === "minigun" && energy) fx.tracer = "bolt";
  } else if (energy) {
    fx.casing = false;
    fx.recoilUp = b.recoilUp * 0.55;
    fx.recoilSide = b.recoilSide * 0.5;
    fx.kick = b.kick * 0.7;
    fx.shake = b.shake * 0.6;
  }
  cache.set(id, fx);
  return fx;
}
