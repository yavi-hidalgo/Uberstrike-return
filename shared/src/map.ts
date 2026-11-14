// Mapa de la arena: una lista de cajas sólidas (AABB) y puntos de aparición.
// El suelo es el plano y = 0.

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  color: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

const HALF = 30; // arena de 60 x 60 m
const WALL_H = 6;
const WALL_T = 1;

function box(
  x: number, y: number, z: number, // centro de la base
  w: number, h: number, d: number,
  color: number,
): Box {
  return {
    min: [x - w / 2, y, z - d / 2],
    max: [x + w / 2, y + h, z + d / 2],
    color,
  };
}

const WALL = 0x4a5568;
const CRATE = 0xc2763a;
const BLOCK = 0x5a7d9a;
const PLATFORM = 0x7a8b5a;

export const MAP_BOXES: Box[] = [
  // Muros exteriores
  box(0, 0, -HALF - WALL_T / 2, HALF * 2 + WALL_T * 2, WALL_H, WALL_T, WALL),
  box(0, 0, HALF + WALL_T / 2, HALF * 2 + WALL_T * 2, WALL_H, WALL_T, WALL),
  box(-HALF - WALL_T / 2, 0, 0, WALL_T, WALL_H, HALF * 2, WALL),
  box(HALF + WALL_T / 2, 0, 0, WALL_T, WALL_H, HALF * 2, WALL),

  // Estructura central: plataforma con escalones
  box(0, 0, 0, 8, 2.4, 8, PLATFORM),
  box(0, 0, 5, 4, 0.8, 2, PLATFORM),
  box(0, 0, 6.5, 4, 0.4, 1, PLATFORM),
  box(0, 0, -5, 4, 0.8, 2, PLATFORM),
  box(0, 0, -6.5, 4, 0.4, 1, PLATFORM),
  box(0, 0, 4.25, 4, 1.6, 0.5, PLATFORM),
  box(0, 0, -4.25, 4, 1.6, 0.5, PLATFORM),

  // Muros de cobertura
  box(-14, 0, -10, 1, 3, 10, BLOCK),
  box(14, 0, 10, 1, 3, 10, BLOCK),
  box(-10, 0, 16, 10, 3, 1, BLOCK),
  box(10, 0, -16, 10, 3, 1, BLOCK),
  box(-20, 0, 6, 6, 3, 1, BLOCK),
  box(20, 0, -6, 6, 3, 1, BLOCK),

  // Cajas
  box(-8, 0, -6, 2, 2, 2, CRATE),
  box(-6.5, 0, -7.5, 1.4, 1.4, 1.4, CRATE),
  box(8, 0, 6, 2, 2, 2, CRATE),
  box(6.5, 0, 7.5, 1.4, 1.4, 1.4, CRATE),
  box(-22, 0, -22, 3, 3, 3, CRATE),
  box(-19.5, 0, -22, 2, 1.2, 2, CRATE),
  box(22, 0, 22, 3, 3, 3, CRATE),
  box(19.5, 0, 22, 2, 1.2, 2, CRATE),
  box(22, 0, -22, 2.5, 1.2, 2.5, CRATE),
  box(-22, 0, 22, 2.5, 1.2, 2.5, CRATE),
  box(0, 0, -22, 2, 1.2, 2, CRATE),
  box(0, 0, 22, 2, 1.2, 2, CRATE),
  box(-24, 0, 0, 2, 1.2, 2, CRATE),
  box(24, 0, 0, 2, 1.2, 2, CRATE),
];

export const SPAWN_POINTS: SpawnPoint[] = [
  { x: -26, z: -26, yaw: (-3 * Math.PI) / 4 },
  { x: 26, z: 26, yaw: Math.PI / 4 },
  { x: 26, z: -26, yaw: (3 * Math.PI) / 4 },
  { x: -26, z: 26, yaw: -Math.PI / 4 },
  { x: 0, z: -27, yaw: Math.PI },
  { x: 0, z: 27, yaw: 0 },
  { x: -27, z: 10, yaw: -Math.PI / 2 },
  { x: 27, z: -10, yaw: Math.PI / 2 },
];

export const ARENA_HALF = HALF;
