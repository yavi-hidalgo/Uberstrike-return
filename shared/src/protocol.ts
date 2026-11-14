// Mensajes entre cliente y servidor.

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
  yaw: number; // solo lo usa el cliente al reaparecer
  seq: number; // último input procesado
  hp: number;
  alive: boolean;
  ammo: number;
  reloading: boolean;
  respawnIn: number; // ms, 0 si está vivo
  ping: number; // ms, medido por el servidor
}

/** Otro jugador: [id, x, y, z, yaw, pitch]. Solo se envían los que puedes ver. */
export type OtherSnapshot = [number, number, number, number, number, number];

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
}

/** Trazadora de un disparo (solo si ves al tirador o eres la víctima). */
export interface ShotMsg {
  id: number;
  from: [number, number, number];
  to: [number, number, number];
}

export interface KillMsg {
  killer: number;
  victim: number;
  headshot: boolean;
}

export interface HitMsg {
  damage: number;
  headshot: boolean;
  kill: boolean;
}

export interface DamagedMsg {
  /** dirección horizontal desde la que vino el disparo (radianes) */
  fromAngle: number;
}
