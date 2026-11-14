// Constantes compartidas entre servidor y cliente.
// El servidor es la autoridad: si el cliente las cambia, solo se engaña a sí mismo.

export const TICK_RATE = 30; // simulaciones por segundo
export const DT = 1 / TICK_RATE; // segundos por tick

export const MOVE_SPEED = 7.5; // m/s
export const JUMP_VELOCITY = 8;
export const GRAVITY = 24;

export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;

export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
export const MAX_PLAYERS = 12;

export const WEAPON = {
  name: "Rifle",
  damage: 20,
  headshotDamage: 40,
  fireIntervalTicks: 4, // 1 disparo cada 4 ticks = 7.5 disparos/s
  range: 120,
  magazine: 30,
  reloadTicks: 45, // 1.5 s
} as const;

// Bits del campo "keys" de cada input.
export const KEY = {
  FORWARD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  JUMP: 16,
  FIRE: 32,
  RELOAD: 64,
} as const;
export const KEY_MASK = 127;

export const MAX_PITCH = 1.5; // ~86 grados
export const NAME_MAX_LEN = 16;

// Anti-trampas
export const MAX_INPUT_CREDITS = 4; // ticks que un cliente puede "adelantar" por jitter de red
export const MAX_QUEUED_INPUTS = 8; // inputs en cola por jugador; el resto se descarta
export const MAX_MESSAGES_PER_SECOND = 90; // ~3x lo normal; por encima se cuenta como abuso
export const MAX_ABUSE_STRIKES = 5; // segundos abusivos antes de expulsar
export const IDLE_INPUT_MS = 250; // sin inputs durante este tiempo => el servidor simula "quieto"
export const VISIBILITY_GRACE_MS = 300; // un enemigo que deja de verse se sigue enviando este tiempo
