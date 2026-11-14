// Mapa "Observatorio Andino": estación científica en una cumbre nevada, de noche.
//
// Hay dos capas:
//  - MAP_BOXES: cajas de colisión (AABB). Es lo único que usa el servidor para
//    movimiento, disparos y visibilidad. Deben ser simples.
//  - MAP_FEATURES: piezas decorativas detalladas que dibuja el cliente encima
//    (cúpula, base octogonal, cabañas, antena...). No afectan al juego.
// Las cajas con `hidden: true` chocan pero no se dibujan como bloque genérico,
// porque una pieza decorativa ya las representa.
// El suelo es el plano y = 0.

export type Material = "concrete" | "rock" | "wood" | "metal" | "crate" | "invisible";

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  kind: Material;
  hidden?: boolean;
}

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

export type Feature =
  | { type: "observatory"; x: number; z: number; baseRadius: number; baseHeight: number; domeRadius: number }
  | { type: "stairs"; x: number; z: number; dir: "n" | "s"; steps: number; stepH: number; width: number }
  | { type: "hut"; x: number; z: number; w: number; d: number; h: number; door: "n" | "s" | "e" | "w" }
  | { type: "antenna"; x: number; z: number; h: number }
  | { type: "dish"; x: number; z: number; yaw: number }
  | { type: "lamp"; x: number; z: number }
  | { type: "terrace"; x: number; z: number; w: number; d: number; h: number };

export interface Pickup {
  id: number;
  type: "health";
  x: number;
  y: number;
  z: number;
  amount: number;
  respawnMs: number;
}

const HALF = 30; // arena de 60 x 60 m

function box(
  x: number, y: number, z: number, // centro de la base
  w: number, h: number, d: number,
  kind: Material,
  hidden = false,
): Box {
  return { min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], kind, hidden };
}

// ---------- Observatorio central ----------
const OBS_R = 6.5; // radio de la base
const OBS_H = 3.2; // altura del techo de la base
const DOME_R = 4.5;

const observatoryBoxes: Box[] = [
  // La base octogonal se aproxima con tres cajas superpuestas.
  box(0, 0, 0, OBS_R * 2, OBS_H, 6, "concrete", true),
  box(0, 0, 0, 6, OBS_H, OBS_R * 2, "concrete", true),
  box(0, 0, 0, 9.2, OBS_H, 9.2, "concrete", true),
  // La cúpula: no se puede subir encima.
  box(0, OBS_H, 0, DOME_R * 2 - 0.4, 2.6, 4.6, "metal", true),
  box(0, OBS_H, 0, 4.6, 2.6, DOME_R * 2 - 0.4, "metal", true),
  box(0, OBS_H, 0, 6.6, 3.4, 6.6, "metal", true),
];

// Escaleras al techo de la base (norte y sur): 4 escalones de 0.8 m.
function stairBoxes(dir: 1 | -1): Box[] {
  const out: Box[] = [];
  const steps = 4, stepH = OBS_H / steps, depth = 1.0, width = 3;
  for (let k = 1; k <= steps; k++) {
    const len = (steps + 1 - k) * depth;
    const zStart = OBS_R - 0.3;
    const zc = dir * (zStart + len / 2);
    out.push(box(0, 0, zc, width, stepH * k, len, "concrete", true));
  }
  return out;
}

// ---------- Terrazas laterales ----------
const TERRACE_H = 1.6;
function terraceBoxes(sx: 1 | -1): Box[] {
  return [
    box(sx * 19, 0, 0, 8, TERRACE_H, 16, "rock", true),
    box(sx * 14.25, 0, 0, 1.5, TERRACE_H / 2, 6, "rock", true), // escalón
    box(sx * 22.2, TERRACE_H, 0, 1, 1.1, 8, "concrete"), // parapeto en la terraza
  ];
}

export const MAP_BOXES: Box[] = [
  // Límites: paredes invisibles al borde del acantilado.
  box(0, 0, -HALF - 0.5, HALF * 2 + 2, 8, 1, "invisible", true),
  box(0, 0, HALF + 0.5, HALF * 2 + 2, 8, 1, "invisible", true),
  box(-HALF - 0.5, 0, 0, 1, 8, HALF * 2, "invisible", true),
  box(HALF + 0.5, 0, 0, 1, 8, HALF * 2, "invisible", true),

  ...observatoryBoxes,
  ...stairBoxes(1),
  ...stairBoxes(-1),
  ...terraceBoxes(1),
  ...terraceBoxes(-1),

  // Cabañas de madera (dormitorio y laboratorio)
  box(-18, 0, -20, 5, 3, 4, "wood", true),
  box(18, 0, 20, 5, 3, 4, "wood", true),

  // Antena y antena parabólica
  box(-22, 0, 22, 1.4, 12, 1.4, "metal", true),
  box(22, 0, -22, 2.2, 2.4, 2.2, "metal", true),

  // Muros de cobertura de hormigón
  box(-8, 0, -16, 8, 2.2, 1, "concrete"),
  box(8, 0, 16, 8, 2.2, 1, "concrete"),
  box(-26, 0, 12, 1, 2.2, 7, "concrete"),
  box(26, 0, -12, 1, 2.2, 7, "concrete"),

  // Rocas
  box(10, 0, -14, 3, 1.8, 3, "rock"),
  box(-10, 0, 14, 3, 1.8, 3, "rock"),
  box(-25, 0, -4, 3, 2.5, 4, "rock"),
  box(25, 0, 4, 3, 2.5, 4, "rock"),
  box(4, 0, 24, 2.4, 1.4, 2.4, "rock"),
  box(-4, 0, -24, 2.4, 1.4, 2.4, "rock"),

  // Contenedores de equipo científico
  box(14, 0, -24, 4, 2.4, 2.2, "metal"),
  box(-14, 0, 24, 4, 2.4, 2.2, "metal"),

  // Cajas de suministros
  box(5, 0, -9, 1.4, 1.4, 1.4, "crate"),
  box(-5, 0, 9, 1.4, 1.4, 1.4, "crate"),
  box(-24, 0, -24, 2, 1.2, 2, "crate"),
  box(24, 0, 24, 2, 1.2, 2, "crate"),
  box(-22.6, 0, -24.2, 1, 1, 1, "crate"),
  box(22.6, 0, 24.2, 1, 1, 1, "crate"),
];

// ---------- Objetos (modelos CC0 de Poly Haven) ----------
// `size` es el tamaño real del modelo (m) y se usa para la colisión.
// Los que tienen `solid: false` son solo decoración (fuera de la arena o muy pequeños).
export interface Prop {
  model: string;
  x: number; y?: number; z: number;
  rot?: number;
  scale?: number | [number, number, number];
  size?: [number, number, number];
  solid?: boolean;
  light?: boolean; // luz cálida (faroles, farolas)
}

export const PROPS: Prop[] = [
  // Barriles junto a los contenedores
  { model: "Barrel_01", x: 11.3, z: -24.5, size: [0.6, 0.9, 0.6] },
  { model: "Barrel_01", x: 11.35, z: -23.75, rot: 1.2, size: [0.6, 0.9, 0.6] },
  { model: "Barrel_01", x: 10.6, z: -24.15, rot: 2.4, size: [0.6, 0.9, 0.6] },
  { model: "barrel_03", x: -11.35, z: 24.45, size: [0.66, 0.95, 0.66] },
  { model: "barrel_03", x: -11.4, z: 23.65, rot: 0.8, size: [0.66, 0.95, 0.66] },
  // Generador y bidones junto a la antena
  { model: "portable_generator", x: -19.7, z: 22.6, rot: 1.9, size: [0.85, 0.6, 0.85] },
  { model: "metal_jerrycan", x: -19.6, z: 21.5, rot: 0.3, size: [0.4, 0.46, 0.4] },
  { model: "metal_jerrycan", x: -19.05, z: 21.65, rot: -0.4, size: [0.4, 0.46, 0.4] },
  // Armarios eléctricos contra la base del observatorio
  { model: "utility_box_01", x: 6.75, z: 2.2, rot: Math.PI / 2, size: [0.5, 1.12, 0.56] },
  { model: "utility_box_02", x: -6.75, z: -2.2, rot: -Math.PI / 2, size: [0.5, 1.12, 0.96] },
  // Caja de herramientas junto al contenedor azul
  { model: "metal_tool_chest", x: -15, z: 22.4, size: [0.72, 0.66, 0.44] },
  // Estufas de barril junto a las puertas de las cabañas
  { model: "barrel_stove", x: -14.9, z: -21.4, size: [0.62, 0.86, 0.62] },
  { model: "barrel_stove", x: 14.9, z: 21.4, size: [0.62, 0.86, 0.62] },
  // Cajas de madera apiladas (decoración pequeña)
  { model: "wooden_crate_01", x: 6.2, z: -9.6, rot: 0.3, size: [0.86, 0.36, 0.44] },
  { model: "wooden_crate_01", x: -6.2, z: 9.6, rot: -0.3, size: [0.86, 0.36, 0.44] },
  // Faroles sobre las cajas de las esquinas
  { model: "Lantern_01", x: -23.55, y: 1.2, z: -23.6, solid: false, light: true },
  { model: "Lantern_01", x: 23.55, y: 1.2, z: 23.6, solid: false, light: true },
];

/** Árboles y rocas fuera de la valla: solo decoración, alrededor de la cumbre. */
export const SCENERY: Prop[] = (() => {
  const out: Prop[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  // Abetos: el modelo trae 3 variantes (a, b, c); `scale` es la altura deseada en metros.
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rnd() * 0.12;
    const r = 33.5 + rnd() * 9;
    out.push({ model: `fir_sapling#${i % 3}`, x: Math.cos(a) * r, z: Math.sin(a) * r, rot: rnd() * Math.PI * 2, scale: 5 + rnd() * 5, solid: false });
  }
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 32.5 + rnd() * 9;
    const sc = 18 + rnd() * 22;
    out.push({ model: i % 2 ? "rock_09" : "stone_01", x: Math.cos(a) * r, z: Math.sin(a) * r, rot: rnd() * Math.PI * 2, scale: sc, solid: false });
  }
  return out;
})();

for (const p of PROPS) {
  if (p.solid === false || !p.size) continue;
  const [w, h, d] = p.size;
  // si está girado ~90°, se intercambian ancho y fondo
  const turned = Math.abs(Math.sin(p.rot ?? 0)) > 0.7;
  MAP_BOXES.push(box(p.x, p.y ?? 0, p.z, turned ? d : w, h, turned ? w : d, "metal", true));
}

export const MAP_FEATURES: Feature[] = [
  { type: "observatory", x: 0, z: 0, baseRadius: OBS_R, baseHeight: OBS_H, domeRadius: DOME_R },
  { type: "stairs", x: 0, z: OBS_R - 0.3, dir: "s", steps: 4, stepH: OBS_H / 4, width: 3 },
  { type: "stairs", x: 0, z: -(OBS_R - 0.3), dir: "n", steps: 4, stepH: OBS_H / 4, width: 3 },
  { type: "terrace", x: 19, z: 0, w: 8, d: 16, h: TERRACE_H },
  { type: "terrace", x: -19, z: 0, w: 8, d: 16, h: TERRACE_H },
  { type: "hut", x: -18, z: -20, w: 5, d: 4, h: 3, door: "e" },
  { type: "hut", x: 18, z: 20, w: 5, d: 4, h: 3, door: "w" },
  { type: "antenna", x: -22, z: 22, h: 12 },
  { type: "dish", x: 22, z: -22, yaw: Math.PI * 0.75 },
  { type: "lamp", x: -9, z: -9 },
  { type: "lamp", x: 9, z: 9 },
  { type: "lamp", x: 12, z: -6 },
  { type: "lamp", x: -12, z: 6 },
];

export const PICKUPS: Pickup[] = [
  { id: 1, type: "health", x: 0, y: OBS_H, z: OBS_R - 1, amount: 50, respawnMs: 20000 },
  { id: 2, type: "health", x: 19, y: TERRACE_H, z: 0, amount: 35, respawnMs: 15000 },
  { id: 3, type: "health", x: -19, y: TERRACE_H, z: 0, amount: 35, respawnMs: 15000 },
  { id: 4, type: "health", x: 0, y: 0, z: -27, amount: 25, respawnMs: 12000 },
  { id: 5, type: "health", x: 0, y: 0, z: 27, amount: 25, respawnMs: 12000 },
];

export const SPAWN_POINTS: SpawnPoint[] = [
  { x: -27, z: -27, yaw: (-3 * Math.PI) / 4 },
  { x: 27, z: 27, yaw: Math.PI / 4 },
  { x: 27, z: -27, yaw: (3 * Math.PI) / 4 },
  { x: -27, z: 27, yaw: -Math.PI / 4 },
  { x: 8, z: -27, yaw: Math.PI },
  { x: -8, z: 27, yaw: 0 },
  { x: -27, z: 4, yaw: -Math.PI / 2 },
  { x: 27, z: -4, yaw: Math.PI / 2 },
];

export const ARENA_HALF = HALF;
