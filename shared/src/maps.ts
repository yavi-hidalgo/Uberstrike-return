// Registro de mapas. Cada sala del servidor usa uno; el cliente carga el que le indica el servidor.
import {
  MAP_BOXES as OBS_BOXES, PICKUPS as OBS_PICKUPS, SPAWN_POINTS as OBS_SPAWNS, ARENA_HALF,
  type Box, type Pickup, type SpawnPoint,
} from "./map";
import factoryData from "./maps/factory.json";
import stationData from "./maps/station.json";

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
  model?: { file: string; scale: number; groundOffset: number; credit: string; source: string };
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

const fb = factoryData.bounds;
const factoryBounds = { minX: fb[0][0], maxX: fb[1][0], minZ: fb[0][1], maxZ: fb[1][1] };
const fcx = (factoryBounds.minX + factoryBounds.maxX) / 2, fcz = (factoryBounds.minZ + factoryBounds.maxZ) / 2;

const factory: MapDef = {
  id: "factory",
  name: "Fábrica abandonada",
  boxes: [
    ...factoryData.boxes.map(([a, b, c, d, e, f]): Box => ({ min: [a, b, c], max: [d, e, f], kind: "concrete", hidden: true })),
    ...perimeter(factoryBounds),
  ],
  // Cada punto de aparición mira hacia el centro del mapa
  spawns: factoryData.spawns.map(([x, z]) => ({ x, z, yaw: Math.atan2(x - fcx, z - fcz) })),
  pickups: factoryData.pickups.map(([x, z], i) => ({
    id: i + 1, type: "health" as const, x, y: 0, z, amount: i === 0 ? 50 : 30, respawnMs: i === 0 ? 20000 : 15000,
  })),
  bounds: factoryBounds,
  lights: ((factoryData as { lights?: number[][] }).lights ?? []).map((l) => [l[0], l[1], l[2], l[3]] as [number, number, number, number]),
  model: {
    file: "factory.glb", scale: factoryData.scale, groundOffset: factoryData.groundOffset,
    credit: "Abandoned factory de Pasha", source: "https://sketchfab.com/3d-models/none-c08537c06acd46bba24ad8251bcdf941",
  },
};

const sb = stationData.bounds;
const stationBounds = { minX: sb[0][0], maxX: sb[1][0], minZ: sb[0][1], maxZ: sb[1][1] };
const scx = (stationBounds.minX + stationBounds.maxX) / 2, scz = (stationBounds.minZ + stationBounds.maxZ) / 2;

const station: MapDef = {
  id: "station",
  name: "Estación orbital",
  boxes: [
    ...stationData.boxes.map(([a, b, c, d, e, f]): Box => ({ min: [a, b, c], max: [d, e, f], kind: "metal", hidden: true })),
    ...perimeter(stationBounds),
  ],
  spawns: stationData.spawns.map(([x, z]) => ({ x, z, yaw: Math.atan2(x - scx, z - scz) })),
  pickups: stationData.pickups.map(([x, z], i) => ({
    id: i + 1, type: "health" as const, x, y: 0, z, amount: i === 0 ? 50 : 30, respawnMs: i === 0 ? 20000 : 15000,
  })),
  bounds: stationBounds,
  lights: stationData.lights.map((l) => [l[0], l[1], l[2], l[3]] as [number, number, number, number]),
  indoor: true,
  model: {
    file: "station.glb", scale: stationData.scale, groundOffset: stationData.groundOffset,
    credit: "Space Station Modular Assets de Josh", source: "https://sketchfab.com/3d-models/none-538f1b2403da4074ad7424f29974bae3",
  },
};

export const MAPS: Record<string, MapDef> = { factory, station, observatory };
/** Mapas que se pueden elegir en el menú. */
export const PLAYABLE_MAPS = ["factory", "station"];
export const DEFAULT_MAP = "factory";

export function mapById(id: unknown): MapDef {
  return (typeof id === "string" && MAPS[id]) || MAPS[DEFAULT_MAP];
}
