// Ampliaciones de los mapas modelados: piezas colocadas por código sobre el escenario de Sketchfab.
//
// Cada pieza tiene un centro (x, z), una altura base (y), un giro en múltiplos de 90° y un tamaño
// (w a lo largo de X local, h alto, d a lo largo de Z local). De ese tamaño sale su caja de colisión,
// que usa el servidor; el cliente dibuja el modelo correspondiente encajado en esa caja.
// Todo es determinista (semilla fija) para que servidor y cliente vean exactamente lo mismo.
import type { Box, Material } from "./map";

export type PieceKind =
  // patio industrial
  | "container" | "car" | "barrier" | "barrier2" | "crate" | "milcrate" | "drums" | "tyres" | "trash"
  | "shed" | "dock" | "step" | "gantryLeg" | "gantryBeam" | "lightmast" | "pallet"
  // hangar
  | "hangarFloor" | "hangarWall" | "hangarCeiling" | "column" | "catwalk" | "railing" | "stairs"
  | "dropship" | "scicrate" | "scicrate2" | "forcefield" | "corridor";

export interface Piece {
  kind: PieceKind;
  x: number;
  z: number;
  y: number;
  /** Giro en cuartos de vuelta (0..3). */
  rot: number;
  w: number;
  h: number;
  d: number;
  /** Variante visual (color, modelo...). */
  v: number;
  /** Sin colisión (solo decorado). */
  ghost?: boolean;
}

/** Fachada de edificios de ladrillo a lo largo de una línea, mirando hacia `facing`. */
export interface FacadeRun {
  /** Punto inicial y final de la línea (en el plano de la fachada). */
  x0: number; z0: number; x1: number; z1: number;
  /** Dirección hacia la que mira la fachada (hacia el área de juego). */
  facing: "n" | "s" | "e" | "w";
  /** Edificios: cantidad de módulos de 3 m, pisos y tipo de ventana. */
  buildings: { modules: number; floors: number; style: number; ground: number }[];
}

export interface Expansion {
  pieces: Piece[];
  facades: FacadeRun[];
  /** Zonas de suelo nuevo: [x0, z0, x1, z1, material]. */
  grounds: [number, number, number, number, "asphalt" | "yard" | "hangar"][];
  /** Líneas pintadas en el suelo: [x0, z0, x1, z1, ancho, color 0 = blanco, 1 = amarillo]. */
  lines: [number, number, number, number, number, number][];
  /** Muros invisibles que cierran el área de juego. */
  walls: Box[];
  /** Luces: [x, y, z, tipo] (1 = foco de patio, 2 = tubo de hangar, 3 = farola). */
  lights: [number, number, number, number][];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KIND_MATERIAL: Partial<Record<PieceKind, Material>> = {
  container: "metal", car: "metal", barrier: "concrete", barrier2: "concrete", crate: "wood", milcrate: "wood",
  drums: "metal", tyres: "rock", trash: "metal", shed: "metal", dock: "concrete", step: "concrete",
  gantryLeg: "metal", lightmast: "metal", pallet: "wood", hangarWall: "metal", column: "metal", catwalk: "metal",
  railing: "metal", stairs: "metal", dropship: "metal", scicrate: "metal", scicrate2: "metal", forcefield: "invisible",
  corridor: "metal",
};

/** Caja de colisión de una pieza (en el mundo). */
export function pieceBox(p: Piece): Box {
  const sw = p.rot % 2 ? p.d : p.w, sd = p.rot % 2 ? p.w : p.d;
  return {
    min: [p.x - sw / 2, p.y, p.z - sd / 2],
    max: [p.x + sw / 2, p.y + p.h, p.z + sd / 2],
    kind: KIND_MATERIAL[p.kind] ?? "concrete",
    hidden: true,
  };
}

function wall(x0: number, z0: number, x1: number, z1: number, h = 30): Box {
  return { min: [Math.min(x0, x1), 0, Math.min(z0, z1)], max: [Math.max(x0, x1), h, Math.max(z0, z1)], kind: "invisible", hidden: true };
}

const CONT = { w: 2.44, h: 2.59, d: 6.06 };

// ---------------------------------------------------------------------------------------------
// Fábrica: patio de contenedores al este y estacionamiento con muelle de carga al sur.
// La fábrica original ocupa x ∈ [-34, 27], z ∈ [-25, 37].
// ---------------------------------------------------------------------------------------------
export function factoryExpansion(): Expansion {
  const r = rng(7331);
  const pieces: Piece[] = [];
  const add = (kind: PieceKind, x: number, z: number, w: number, h: number, d: number, rot = 0, v = 0, y = 0, ghost = false) =>
    pieces.push({ kind, x, z, y, rot, w, h, d, v, ghost });

  // --- Patio de contenedores (x 27..76, z -37..86) ---
  // Dos bloques de 5 columnas; tramos de 2 contenedores en fila separados por pasillos de 6 m.
  const blocks = [38.6, 58.4];
  const segStarts = [-33, -14.6, 3.8, 22.3, 40.7, 59.1];
  for (const bx of blocks) {
    for (const sz of segStarts) {
      for (let c = 0; c < 5; c++) {
        for (let row = 0; row < 2; row++) {
          const roll = r();
          // 0 = hueco (pasillo interno), luego pilas de 1, 2 o 3
          const height = roll < 0.16 ? 0 : roll < 0.5 ? 1 : roll < 0.86 ? 2 : 3;
          const x = bx + c * (CONT.w + 0.28) + CONT.w / 2;
          const z = sz + row * (CONT.d + 0.3) + CONT.d / 2;
          for (let k = 0; k < height; k++) {
            // las cajas de arriba se desalinean un poco: se ve más real
            const jx = k ? (r() - 0.5) * 0.12 : 0, jz = k ? (r() - 0.5) * 0.3 : 0;
            // la puerta del modelo queda hacia el contenedor vecino (no hacia el pasillo)
            add("container", x + jx, z + jz, CONT.w, CONT.h, CONT.d, row ? 0 : 2, Math.floor(r() * 6), k * CONT.h);
          }
        }
      }
    }
  }
  // Grúa pórtico sobre los dos bloques, en el pasillo z 34.7..40.7
  for (const lx of [36.6, 55.2, 73.8]) for (const lz of [35.6, 39.8]) add("gantryLeg", lx, lz, 0.9, 16, 0.9);
  for (const lz of [35.6, 39.8]) add("gantryBeam", 55.2, lz, 38.6, 1.4, 1, 0, 0, 16, true);
  // Torres de iluminación
  for (const [x, z] of [[55.2, -17.6], [55.2, 0.8], [55.2, 56], [32, -30], [32, 18], [32, 64]] as const) add("lightmast", x, z, 0.5, 12, 0.5);
  // Galpón de chapa al fondo del patio
  add("shed", 52, 80, 26, 7, 10, 0, 0);
  // Barreras y bidones sueltos por el patio
  for (const [x, z, rot] of [[33, -8, 1], [33, -6.4, 1], [31, 30, 0], [44, 76, 0], [45.6, 76, 0], [64, 76.2, 0]] as const) add("barrier", x, z, 1.55, 0.83, 0.64, rot);
  add("drums", 34.5, 9, 1.4, 0.95, 1.4, 0, 0);
  add("drums", 70, 75, 1.4, 0.95, 1.4, 0, 1);
  add("pallet", 30.5, 46, 1.2, 1.1, 1.2, 0, 0);
  add("pallet", 30.2, 48, 1.2, 0.6, 1.2, 1, 1);

  // --- Estacionamiento y muelle de carga (x -34..27, z 37..86) ---
  // Dos filas de autos tapados (algunos lugares vacíos)
  for (const [rowZ, start] of [[57.5, -29], [70, -27.6]] as const) {
    for (let i = 0; i < 10; i++) {
      if (r() < 0.25) continue;
      const x = start + i * 2.9 + (r() - 0.5) * 0.3;
      add("car", x, rowZ + (r() - 0.5) * 0.4, 1.8, 1.41, 4.4, r() < 0.5 ? 0 : 2, Math.floor(r() * 4));
    }
  }
  // Barreras de concreto en zigzag (cobertura para cruzar el patio)
  const barrierRuns: [number, number, number, number][] = [
    [6, 50, 5, 1], [16, 56, 4, 0], [9, 64, 3, 1], [19, 70, 5, 1], [-6, 46, 3, 1], [22, 44, 3, 0],
  ];
  for (const [x, z, n, dir] of barrierRuns) {
    for (let i = 0; i < n; i++) {
      const kind = r() < 0.5 ? "barrier" : "barrier2";
      const len = kind === "barrier" ? 1.55 : 1.57;
      const h = kind === "barrier" ? 0.83 : 1.11, d = kind === "barrier" ? 0.64 : 0.44;
      if (dir) add(kind, x + i * (len + 0.05), z, len, h, d, 0);
      else add(kind, x, z + i * (len + 0.05), len, h, d, 1);
    }
  }
  // Muelle de carga contra la fachada sur, con un escalón para subir
  add("dock", 2, 83.25, 24, 1.0, 5.5);
  add("step", 2, 80.0, 24, 0.5, 1.0);
  // Cajas y bidones sobre el muelle
  add("crate", -6, 83.5, 1.17, 0.9, 1.06, 1, 0, 1.0);
  add("milcrate", -3, 84.4, 1.24, 0.46, 0.52, 0, 0, 1.0);
  add("milcrate", -3, 84.4, 1.24, 0.46, 0.52, 0, 1, 1.46);
  add("pallet", 4, 84, 1.2, 1.1, 1.2, 0, 0, 1.0);
  add("drums", 9, 84.2, 1.4, 0.95, 1.4, 0, 0, 1.0);
  add("crate", 12, 82.6, 1.17, 0.9, 1.06, 0, 1, 1.0);
  // Garita de chapa
  add("shed", 20.5, 79, 8, 4, 6, 0, 1);
  // Basureros y neumáticos junto a los muros
  for (const [x, z] of [[-32.5, 44], [-32.5, 46], [-32.5, 77], [25.5, 47], [-20, 84.6], [-18.6, 84.6]] as const) add("trash", x, z, 0.62, 0.92, 0.56, 0, Math.floor(r() * 2));
  for (const [x, z] of [[-31.5, 62], [-30.6, 63.4], [24, 60]] as const) add("tyres", x, z, 1.2, 0.7, 1.2, 0, 0);
  // Farolas a lo largo del camino
  for (const x of [-26, -10, 8]) add("lightmast", x, 47.5, 0.4, 8, 0.4, 0, 1);

  // --- Fachadas que cierran el área ---
  const B = (modules: number, floors: number, style: number, ground: number) => ({ modules, floors, style, ground });
  const facades: FacadeRun[] = [
    { x0: 27, z0: -37.3, x1: 76.3, z1: -37.3, facing: "s", buildings: [B(6, 5, 0, 0), B(5, 4, 1, 1), B(5, 6, 2, 0)] },
    { x0: 76.3, z0: -37.3, x1: 76.3, z1: 86.3, facing: "w", buildings: [B(9, 5, 3, 1), B(8, 4, 0, 0), B(9, 6, 1, 2), B(7, 4, 2, 0), B(8, 5, 0, 1)] },
    { x0: 76.3, z0: 86.3, x1: -34.3, z1: 86.3, facing: "n", buildings: [B(8, 4, 2, 0), B(9, 5, 0, 1), B(10, 4, 1, 2), B(10, 6, 3, 0)] },
    { x0: -34.3, z0: 86.3, x1: -34.3, z1: 37, facing: "e", buildings: [B(8, 5, 1, 0), B(8, 4, 2, 1)] },
    { x0: 26.7, z0: -25, x1: 26.7, z1: -37.3, facing: "e", buildings: [B(4, 5, 0, 0)] },
  ];

  const grounds: Expansion["grounds"] = [
    [27, -37, 76, 86, "yard"],
    [-34, 37, 27, 86, "asphalt"],
  ];
  const lines: Expansion["lines"] = [];
  // Líneas de estacionamiento
  for (const [rowZ, start] of [[57.5, -29], [70, -27.6]] as const) {
    for (let i = 0; i <= 10; i++) lines.push([start - 1.45 + i * 2.9, rowZ - 2.6, start - 1.45 + i * 2.9, rowZ + 2.6, 0.12, 0]);
  }
  // Carriles amarillos del patio de contenedores
  lines.push([35.2, -35, 35.2, 84, 0.18, 1], [54.8, -35, 54.8, 84, 0.18, 1], [74.6, -35, 74.6, 84, 0.18, 1]);
  lines.push([-30, 49.5, 25, 49.5, 0.15, 1], [-30, 76, 25, 76, 0.15, 1]);

  const walls: Box[] = [
    wall(-35, -26, 27, -25),         // norte de la fábrica (sin cambios)
    wall(-35, -25, -34, 37),         // oeste de la fábrica (sin cambios)
    wall(26, -38, 27, -25),          // corte entre la fábrica y el patio, al norte
    wall(27, -38, 77, -37),          // norte del patio
    wall(76, -37, 77, 87),           // este
    wall(-35, 86, 77, 87),           // sur
    wall(-35, 37, -34, 86),          // oeste del estacionamiento
  ];
  const lights: Expansion["lights"] = [];
  for (const p of pieces) if (p.kind === "lightmast") lights.push([p.x, p.h - 0.6, p.z, p.v ? 3 : 1]);
  return { pieces, facades, grounds, lines, walls, lights, bounds: { minX: -34, maxX: 76, minZ: -37, maxZ: 86 } };
}

// ---------------------------------------------------------------------------------------------
// Estación: hangar nuevo al este, unido por la puerta (que se abre) en x ≈ 10.3, z 19.9..23.3.
// ---------------------------------------------------------------------------------------------
export const HANGAR = { x0: 18, x1: 62, z0: -2, z1: 44, h: 14, door: { z0: 19.6, z1: 23.6 } };

export function stationHangar(): Expansion {
  const r = rng(4242);
  const pieces: Piece[] = [];
  const add = (kind: PieceKind, x: number, z: number, w: number, h: number, d: number, rot = 0, v = 0, y = 0, ghost = false) =>
    pieces.push({ kind, x, z, y, rot, w, h, d, v, ghost });
  const H = HANGAR, t = 0.6;
  const cx = (H.x0 + H.x1) / 2;

  // Pasillo de unión (x 10.6..18)
  const cz0 = H.door.z0, cz1 = H.door.z1, ch = 4.6;
  add("corridor", 14.3, (cz0 + cz1) / 2, 7.4, ch, cz1 - cz0, 0, 0, 0, true);
  add("hangarWall", 14.3, cz0 - t / 2, 7.4, ch, t);
  add("hangarWall", 14.3, cz1 + t / 2, 7.4, ch, t);
  add("hangarWall", 14.3, (cz0 + cz1) / 2, 7.4, 0.5, cz1 - cz0 + 2 * t, 0, 1, ch);

  // Paredes del hangar (la oeste tiene el hueco del pasillo; la este es una ventana al espacio)
  add("hangarWall", cx, H.z0 - t / 2, H.x1 - H.x0 + 2 * t, H.h, t);
  add("hangarWall", cx, H.z1 + t / 2, H.x1 - H.x0 + 2 * t, H.h, t);
  add("hangarWall", H.x0 - t / 2, (H.z0 + cz0) / 2, t, H.h, cz0 - H.z0);
  add("hangarWall", H.x0 - t / 2, (cz1 + H.z1) / 2, t, H.h, H.z1 - cz1);
  add("hangarWall", H.x0 - t / 2, (cz0 + cz1) / 2, t, H.h - ch, cz1 - cz0, 0, 0, ch);
  // Este: zócalo, ventana con campo de fuerza y dintel
  const wz0 = 6, wz1 = 36;
  add("hangarWall", H.x1 + t / 2, (H.z0 + wz0) / 2, t, H.h, wz0 - H.z0);
  add("hangarWall", H.x1 + t / 2, (wz1 + H.z1) / 2, t, H.h, H.z1 - wz1);
  add("hangarWall", H.x1 + t / 2, (wz0 + wz1) / 2, t, 1.2, wz1 - wz0);
  add("hangarWall", H.x1 + t / 2, (wz0 + wz1) / 2, t, H.h - 11, wz1 - wz0, 0, 0, 11);
  add("forcefield", H.x1 + 0.1, (wz0 + wz1) / 2, 0.2, 9.8, wz1 - wz0, 0, 0, 1.2);
  add("hangarFloor", cx, (H.z0 + H.z1) / 2, H.x1 - H.x0, 0.01, H.z1 - H.z0, 0, 0, 0, true);
  add("hangarCeiling", cx, (H.z0 + H.z1) / 2, H.x1 - H.x0, 0.4, H.z1 - H.z0, 0, 0, H.h, true);
  // Columnas contra las paredes norte y sur
  for (let x = H.x0 + 5.5; x < H.x1 - 2; x += 11) {
    add("column", x, H.z0 + 0.5, 1.2, H.h, 1);
    add("column", x, H.z1 - 0.5, 1.2, H.h, 1);
  }

  // Pasarela elevada a lo largo de la pared norte (y = 4), con baranda y escalera
  const cwY = 4, cwD = 4;
  add("catwalk", (H.x0 + 2 + H.x1 - 6) / 2, H.z0 + 1 + cwD / 2, H.x1 - 6 - (H.x0 + 2), 0.3, cwD, 0, 0, cwY - 0.3);
  add("railing", (H.x0 + 2 + H.x1 - 6) / 2, H.z0 + 1 + cwD + 0.05, H.x1 - 6 - (H.x0 + 2) - 6, 1.05, 0.1, 0, 0, cwY);
  // Escalera: 10 peldaños de 0.4 m, bajando hacia el sur desde el extremo oeste de la pasarela
  const stepH = 0.4, stepD = 0.45, sx = H.x0 + 2 + 2.2 + 0.2;
  for (let i = 0; i < 10; i++) {
    const top = cwY - i * stepH;
    add("stairs", sx, H.z0 + 1 + cwD + stepD / 2 + i * stepD, 2.2, top, stepD, 0, i, 0);
  }
  // Segunda escalera en el extremo este
  const sx2 = H.x1 - 6 - 2.2 / 2 - 0.2;
  for (let i = 0; i < 10; i++) {
    const top = cwY - i * stepH;
    add("stairs", sx2, H.z0 + 1 + cwD + stepD / 2 + i * stepD, 2.2, top, stepD, 0, i, 0);
  }

  // Nave de desembarco en la plataforma central
  add("dropship", cx + 1, 21.6, 7, 4.2, 12, 1);
  // Contenedores de carga (modelo de contenedor en tonos oscuros) y cajas
  const cont = (x: number, z: number, rot: number, stack: number) => {
    for (let k = 0; k < stack; k++) add("container", x, z, CONT.w, CONT.h, CONT.d, rot, 6 + Math.floor(r() * 2), k * CONT.h);
  };
  cont(24, 33, 0, 2); cont(26.8, 33, 0, 1); cont(24, 9, 0, 1);
  cont(52, 39.5, 1, 1); cont(52, 36.7, 1, 2);
  cont(30, 39.6, 1, 1);
  const crates: [number, number, number][] = [
    [33, 13, 0], [34.2, 14.1, 1], [47, 30, 0], [48.3, 29, 1], [27, 22.5, 0], [56, 15, 0], [56, 16.3, 1],
    [44.5, 9.5, 0], [21, 41, 1], [36, 38.5, 0], [59.5, 27, 0], [59.5, 24.5, 1],
  ];
  for (const [x, z, v] of crates) {
    if (v) add("scicrate2", x, z, 1.1, 0.85, 1.4, Math.floor(r() * 4), 0);
    else add("scicrate", x, z, 1.3, 1.0, 0.75, Math.floor(r() * 4), 0);
  }
  // Algunas cajas apiladas
  add("scicrate", 33, 13, 1.3, 1.0, 0.75, 1, 0, 1.0);
  add("scicrate2", 56, 15, 1.1, 0.85, 1.4, 0, 0, 1.0);

  const lights: Expansion["lights"] = [];
  for (let x = H.x0 + 5; x < H.x1; x += 9) for (const z of [8, 21.6, 35]) lights.push([x, H.h - 0.3, z, 2]);
  lights.push([14.3, ch - 0.2, (cz0 + cz1) / 2, 2]);

  const walls: Box[] = [];
  return {
    pieces, facades: [], grounds: [], lines: [
      // Marcas de la plataforma de aterrizaje
      [cx - 9, 13, cx + 11, 13, 0.25, 1], [cx - 9, 30, cx + 11, 30, 0.25, 1],
      [cx - 9, 13, cx - 9, 30, 0.25, 1], [cx + 11, 13, cx + 11, 30, 0.25, 1],
    ],
    walls, lights,
    bounds: { minX: H.x0 - 1, maxX: H.x1 + 1, minZ: H.z0 - 1, maxZ: H.z1 + 1 },
  };
}

export function expansionBoxes(e: Expansion): Box[] {
  return [...e.pieces.filter((p) => !p.ghost).map(pieceBox), ...e.walls];
}
