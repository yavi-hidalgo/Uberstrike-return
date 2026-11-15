// Mensajes entre cliente y servidor.
import type { Look } from "./gear";

/** Cliente -> servidor, ~30 por segundo. */
export interface InputMsg {
  seq: number;
  keys: number;
  yaw: number;
  pitch: number;
}

/** Estado propio que el servidor manda a cada jugador. */
export interface SelfSnapshot {
  x: number; y: number; z: number; vy: number; g: boolean;
  vx: number; vz: number; // velocidad horizontal (para repetir la predicción)
  yaw: number; // solo lo usa el cliente al reaparecer
  seq: number; // último input procesado
  hp: number;
  maxHp: number; // 100 + lo que suma el equipo
  alive: boolean;
  ammo: number; // del arma en mano (-1 = arma blanca, sin munición)
  weapon: number; // 0 = principal, 1 = pistola, 2 = arma blanca
  switching: boolean;
  reloading: boolean;
  respawnIn: number; // ms, 0 si está vivo
  ping: number; // ms, medido por el servidor
}

/** Otro jugador: [id, x, y, z, yaw, pitch, hp, arma en mano (0/1)]. Solo se envían los que puedes ver. */
export type OtherSnapshot = [number, number, number, number, number, number, number, number];

export interface SnapshotMsg {
  tick: number;
  you: SelfSnapshot;
  others: OtherSnapshot[];
}

export interface RosterEntry {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  alive: boolean;
  loadout: [string, string, string]; // ids de arma principal, pistola y arma blanca
  look: Look; // skin y equipo
  maxHp: number;
}

export interface RosterMsg {
  players: RosterEntry[];
  fragLimit: number;
  /** ms restantes de la pantalla de fin de ronda, 0 si se está jugando */
  intermission: number;
  winner: string | null;
}

export interface WelcomeMsg {
  id: number;
  tickRate: number;
  map: string; // id del mapa de esta sala
}

/** Trazadora de un disparo (solo si ves al tirador o eres la víctima). */
export interface ShotMsg {
  id: number;
  from: [number, number, number];
  to: [number, number, number];
  /** Arma con la que disparó (0 = principal, 1 = pistola): define el efecto visual. */
  slot: number;
}

export interface KillMsg {
  killer: number;
  victim: number;
  headshot: boolean;
}

export interface HitMsg {
  /** A quién le diste (para mostrar el número de daño sobre él). */
  victim: number;
  damage: number;
  headshot: boolean;
  kill: boolean;
}

export interface DamagedMsg {
  /** dirección horizontal desde la que vino el disparo (radianes) */
  fromAngle: number;
}

/** Proyectil de un cañón: sale de `from` en dirección `dir`. */
export interface ProjMsg {
  id: number;
  owner: number;
  slot: number;
  from: [number, number, number];
  dir: [number, number, number];
  speed: number;
  gravity: number;
}

/** Explosión de un proyectil. */
export interface BoomMsg {
  id: number;
  owner: number;
  slot: number;
  pos: [number, number, number];
  radius: number;
}

/** Golpe con arma blanca de otro jugador (para el sonido y la animación). */
export interface SwingMsg {
  id: number;
  hit: boolean;
}

/** Estado de los botiquines: ids de los que están disponibles ahora. */
export interface PickupsMsg {
  active: number[];
}

/** Al jugador que recoge un objeto. */
export interface PickedMsg {
  id: number;
  amount: number;
}
