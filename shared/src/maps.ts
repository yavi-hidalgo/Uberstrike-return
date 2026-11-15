// Registro de mapas. Cada sala del servidor usa uno; el cliente carga el que le indica el servidor.
import {
  MAP_BOXES as OBS_BOXES, PICKUPS as OBS_PICKUPS, SPAWN_POINTS as OBS_SPAWNS, ARENA_HALF,
  type Box, type Pickup, type SpawnPoint,
} from "./map";
import factoryData from "./maps/factory.json";
import stationData from "./maps/station.json";
import { expansionBoxes, factoryExpansion, HANGAR, stationHangar, type Expansion } from "./layout";

export interface MapDef {
  id: string;
  name: string;
  boxes: Box[];
  spawns: SpawnPoint[];
  pickups: Pickup[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Luces del escenario: [x, y, z, tipo] (1 = farola, 0 = foco). */
  lights?: [number, number, number, number][];
  /** Interior (pasillos con techo): sin cielo ni montañas, luz artificial. */
  indoor?: boolean;
  /** Escenario modelado (glTF). Si no hay, el cliente construye el mapa por código. */
  model?: { file: string; scale: number; groundOffset: number; credit: string; source: string; hide?: string[] };
  /** Ampliación construida por código alrededor del escenario modelado. */
  expansion?: Expansion;
}

/** ¿El punto (x, z) tiene espacio libre para un jugador? */
function clear(boxes: Box[], x: number, z: number, r: number): boolean {
  for (const b of boxes) {
    if (b.min[1] > 2.2 || b.max[1] < 0.05) continue;
    if (x > b.min[0] - r && x < b.max[0] + r && z > b.min[2] - r && z < b.max[2] + r) return false;
  }
  return true;
}

/**
 * Elige `count` puntos libres dentro de las zonas dadas, lo más separados posible entre sí
 * y de los puntos ya existentes (muestreo del punto más lejano, determinista).
 */
function spreadPoints(boxes: Box[], zones: [number, number, number, number][], count: number, existing: [number, number][], r = 1.2): [number, number][] {
  const cand: [number, number][] = [];
  for (const [x0, z0, x1, z1] of zones) {
    for (let x = x0 + 1.5; x <= x1 - 1.5; x += 1.5) for (let z = z0 + 1.5; z <= z1 - 1.5; z += 1.5) if (clear(boxes, x, z, r)) cand.push([x, z]);
  }
  const chosen: [number, number][] = [];
  const all = [...existing];
  for (let i = 0; i < count && cand.length; i++) {
    let best = -1, bestD = -1;
    for (let j = 0; j < cand.length; j++) {
      let d = Infinity;
      for (const [px, pz] of all) d = Math.min(d, (cand[j][0] - px) ** 2 + (cand[j][1] - pz) ** 2);
      if (all.length === 0) d = -j;
      if (d > bestD) { bestD = d; best = j; }
    }
    const p = cand.splice(best, 1)[0];
    chosen.push(p); all.push(p);
  }
  return chosen;
}

/** Paredes invisibles alrededor de un rectángulo, para que nadie salga del mapa. */
function perimeter(b: MapDef["bounds"], height = 14): Box[] {
  const t = 1;
  const mk = (x0: number, z0: number, x1: number, z1: number): Box => ({ min: [x0, 0, z0], max: [x1, height, z1], kind: "invisible", hidden: true });
  return [
    mk(b.minX - t, b.minZ - t, b.maxX + t, b.minZ),
    mk(b.minX - t, b.maxZ, b.maxX + t, b.maxZ + t),
    mk(b.minX - t, b.minZ, b.minX, b.maxZ),
    mk(b.maxX, b.minZ, b.maxX + t, b.maxZ),
  ];
}

const observatory: MapDef = {
  id: "observatory",
  name: "Observatorio Andino",
  boxes: OBS_BOXES,
  spawns: OBS_SPAWNS,
  pickups: OBS_PICKUPS,
  bounds: { minX: -ARENA_HALF, maxX: ARENA_HALF, minZ: -ARENA_HALF, maxZ: ARENA_HALF },
};

const factoryExp = factoryExpansion();
const factoryBounds = factoryExp.bounds;
const fcx = (factoryBounds.minX + factoryBounds.maxX) / 2, fcz = (factoryBounds.minZ + factoryBounds.maxZ) / 2;
const factoryBoxes: Box[] = [
  ...factoryData.boxes.map(([a, b, c, d, e, f]): Box => ({ min: [a, b, c], max: [d, e, f], kind: "concrete", hidden: true })),
  ...expansionBoxes(factoryExp),
];
const factorySpawns: [number, number][] = [
  ...(factoryData.spawns as [number, number][]),
  ...spreadPoints(factoryBoxes, [[27, -37, 76, 86], [-34, 37, 27, 86]], 12, factoryData.spawns as [number, number][]),
];
const factoryPickups: [number, number][] = [
  ...(factoryData.pickups as [number, number][]),
  ...spreadPoints(factoryBoxes, [[27, -37, 76, 86], [-34, 37, 27, 86]], 5, [...factorySpawns, ...(factoryData.pickups as [number, number][])], 1.0),
];

const factory: MapDef = {
  id: "factory",
  name: "Fábrica abandonada",
  boxes: factoryBoxes,
  // Cada punto de aparición mira hacia el centro del mapa
  spawns: factorySpawns.map(([x, z]) => ({ x, z, yaw: Math.atan2(x - fcx, z - fcz) })),
  pickups: factoryPickups.map(([x, z], i) => ({
    id: i + 1, type: "health" as const, x, y: 0, z, amount: i === 0 ? 50 : 30, respawnMs: i === 0 ? 20000 : 15000,
  })),
  bounds: factoryBounds,
  lights: ((factoryData as { lights?: number[][] }).lights ?? []).map((l) => [l[0], l[1], l[2], l[3]] as [number, number, number, number]),
  model: {
    file: "factory.glb", scale: factoryData.scale, groundOffset: factoryData.groundOffset,
    credit: "Abandoned factory de Pasha", source: "https://sketchfab.com/3d-models/none-c08537c06acd46bba24ad8251bcdf941",
  },
  expansion: factoryExp,
};

const hangarExp = stationHangar();
const sb = stationData.bounds;
const stationBounds = { minX: sb[0][0], maxX: HANGAR.x1 + 1, minZ: sb[0][1], maxZ: Math.max(sb[1][1], HANGAR.z1 + 1) };
const scx = (stationBounds.minX + stationBounds.maxX) / 2, scz = (stationBounds.minZ + stationBounds.maxZ) / 2;
// La puerta este de la estación (x ≈ 10.3, z 19.9..23.3) se abre hacia el pasillo del hangar
const isDoor = (b: Box) => b.max[0] > 9.6 && b.min[0] < 11.2 && b.max[2] > HANGAR.door.z0 && b.min[2] < HANGAR.door.z1 && b.min[1] < 4;
const stationBoxes: Box[] = [
  ...stationData.boxes.map(([a, b, c, d, e, f]): Box => ({ min: [a, b, c], max: [d, e, f], kind: "metal", hidden: true })).filter((b) => !isDoor(b)),
  ...perimeter({ minX: sb[0][0], maxX: sb[1][0], minZ: sb[0][1], maxZ: sb[1][1] }).filter((b) => b.min[0] < sb[1][0] - 0.5),
  // pared este de la estación original, con el hueco del pasillo
  { min: [sb[1][0], 0, sb[0][1] - 1], max: [sb[1][0] + 1, 14, HANGAR.door.z0], kind: "invisible", hidden: true },
  { min: [sb[1][0], 0, HANGAR.door.z1], max: [sb[1][0] + 1, 14, sb[1][1] + 1], kind: "invisible", hidden: true },
  ...expansionBoxes(hangarExp),
];
// Puntos de aparición: los originales que siguen conectados, más algunos en el hangar
const stationOld = (stationData.spawns as [number, number][]).filter(([, z]) => z > -14);
const stationSpawns: [number, number][] = [
  ...stationOld,
  ...spreadPoints(stationBoxes, [[HANGAR.x0, HANGAR.z0 + 5.5, HANGAR.x1, HANGAR.z1]], 6, stationOld),
];
const stationPickups: [number, number][] = [
  ...(stationData.pickups as [number, number][]),
  ...spreadPoints(stationBoxes, [[HANGAR.x0, HANGAR.z0 + 5.5, HANGAR.x1, HANGAR.z1]], 2, [...stationSpawns, ...(stationData.pickups as [number, number][])], 1.0),
];

const station: MapDef = {
  id: "station",
  name: "Estación orbital",
  boxes: stationBoxes,
  spawns: stationSpawns.map(([x, z]) => ({ x, z, yaw: Math.atan2(x - scx, z - scz) })),
  pickups: stationPickups.map(([x, z], i) => ({
    id: i + 1, type: "health" as const, x, y: 0, z, amount: i === 0 ? 50 : 30, respawnMs: i === 0 ? 20000 : 15000,
  })),
  bounds: stationBounds,
  lights: stationData.lights.map((l) => [l[0], l[1], l[2], l[3]] as [number, number, number, number]),
  indoor: true,
  model: {
    file: "station.glb", scale: stationData.scale, groundOffset: stationData.groundOffset,
    credit: "Space Station Modular Assets de Josh", source: "https://sketchfab.com/3d-models/none-538f1b2403da4074ad7424f29974bae3",
    hide: ["Object_7"],
  },
  expansion: hangarExp,
};

export const MAPS: Record<string, MapDef> = { factory, station, observatory };
/** Mapas que se pueden elegir en el menú. */
export const PLAYABLE_MAPS = ["factory", "station"];
export const DEFAULT_MAP = "factory";

export function mapById(id: unknown): MapDef {
  return (typeof id === "string" && MAPS[id]) || MAPS[DEFAULT_MAP];
}
