// Física determinista compartida. El servidor la usa como autoridad y el cliente
// la usa para "predecir" su propio movimiento sin esperar al servidor.

import {
  EYE_HEIGHT, GRAVITY, JUMP_VELOCITY, KEY, MOVE_SPEED,
  PLAYER_HEIGHT, PLAYER_RADIUS,
} from "./constants";
import { MAP_BOXES, type Box } from "./map";

export interface MoveState {
  x: number;
  y: number; // pies
  z: number;
  vy: number;
  onGround: boolean;
}

export interface InputCmd {
  seq: number;
  keys: number;
  yaw: number;
  pitch: number;
}

export function forwardVector(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

export function aimDirection(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

function overlaps(s: MoveState, b: Box): boolean {
  return (
    s.x + PLAYER_RADIUS > b.min[0] && s.x - PLAYER_RADIUS < b.max[0] &&
    s.y + PLAYER_HEIGHT > b.min[1] && s.y < b.max[1] &&
    s.z + PLAYER_RADIUS > b.min[2] && s.z - PLAYER_RADIUS < b.max[2]
  );
}

const EPS = 1e-4;

/** Avanza un tick de simulación. Modifica `s` en el lugar. */
export function stepMove(s: MoveState, keys: number, yaw: number, dt: number, boxes: Box[] = MAP_BOXES): void {
  let fx = 0, fz = 0;
  if (keys & KEY.FORWARD) fz += 1;
  if (keys & KEY.BACK) fz -= 1;
  if (keys & KEY.RIGHT) fx += 1;
  if (keys & KEY.LEFT) fx -= 1;

  const [fwdX, fwdZ] = forwardVector(yaw);
  // derecha = adelante rotado -90° alrededor de Y
  const rightX = -fwdZ, rightZ = fwdX;
  let vx = fwdX * fz + rightX * fx;
  let vz = fwdZ * fz + rightZ * fx;
  const len = Math.hypot(vx, vz);
  if (len > 0) {
    vx = (vx / len) * MOVE_SPEED;
    vz = (vz / len) * MOVE_SPEED;
  }

  if ((keys & KEY.JUMP) && s.onGround) {
    s.vy = JUMP_VELOCITY;
  }
  s.vy -= GRAVITY * dt;
  s.onGround = false;

  // Eje X
  s.x += vx * dt;
  for (const b of boxes) {
    if (overlaps(s, b)) {
      s.x = vx > 0 ? b.min[0] - PLAYER_RADIUS - EPS : b.max[0] + PLAYER_RADIUS + EPS;
    }
  }
  // Eje Z
  s.z += vz * dt;
  for (const b of boxes) {
    if (overlaps(s, b)) {
      s.z = vz > 0 ? b.min[2] - PLAYER_RADIUS - EPS : b.max[2] + PLAYER_RADIUS + EPS;
    }
  }
  // Eje Y
  s.y += s.vy * dt;
  for (const b of boxes) {
    if (overlaps(s, b)) {
      if (s.vy <= 0) {
        s.y = b.max[1];
        s.onGround = true;
      } else {
        s.y = b.min[1] - PLAYER_HEIGHT - EPS;
      }
      s.vy = 0;
    }
  }
  if (s.y <= 0) {
    s.y = 0;
    s.vy = 0;
    s.onGround = true;
  }
}

/**
 * Intersección rayo-caja (método de slabs). Devuelve la distancia t >= 0 o Infinity.
 * `dir` debe estar normalizado.
 */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  min: readonly number[], max: readonly number[],
): number {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/** Distancia hasta la primera pared del mapa a lo largo del rayo. */
export function rayMap(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number, boxes: Box[] = MAP_BOXES,
): number {
  let best = maxDist;
  for (const b of boxes) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b.min, b.max);
    if (t < best) best = t;
  }
  // suelo
  if (dy < 0) {
    const t = -oy / dy;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/** Como rayMap, pero también devuelve la normal de la superficie golpeada (para efectos). */
export function rayMapHit(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number, boxes: Box[] = MAP_BOXES,
): { t: number; normal: [number, number, number]; kind: string | null } {
  let best = maxDist;
  let hitBox: Box | null = null;
  for (const b of boxes) {
    if (b.kind === "invisible") continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, b.min, b.max);
    if (t < best) { best = t; hitBox = b; }
  }
  let normal: [number, number, number] = [0, 0, 0];
  let kind: string | null = hitBox ? hitBox.kind : null;
  if (dy < 0) {
    const t = -oy / dy;
    if (t >= 0 && t < best) { best = t; hitBox = null; normal = [0, 1, 0]; kind = "ground"; }
  }
  if (hitBox) {
    const p = [ox + dx * best, oy + dy * best, oz + dz * best];
    let bestD = Infinity;
    for (let i = 0; i < 3; i++) {
      const dMin = Math.abs(p[i] - hitBox.min[i]);
      const dMax = Math.abs(p[i] - hitBox.max[i]);
      if (dMin < bestD) { bestD = dMin; normal = [0, 0, 0]; normal[i] = -1; }
      if (dMax < bestD) { bestD = dMax; normal = [0, 0, 0]; normal[i] = 1; }
    }
  }
  return { t: best, normal, kind };
}

/** ¿Hay línea de visión directa entre dos puntos? */
export function lineOfSight(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  boxes: Box[] = MAP_BOXES,
): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const t = rayMap(ax, ay, az, dx / dist, dy / dist, dz / dist, dist, boxes);
  return t >= dist - 1e-3;
}

export const HEAD_SIZE = 0.3; // la cabeza ocupa los últimos 30 cm del cuerpo

/** Caja de impacto del cuerpo y la cabeza de un jugador con pies en (x, y, z). */
export function hitboxes(x: number, y: number, z: number) {
  const r = PLAYER_RADIUS;
  return {
    body: { min: [x - r, y, z - r], max: [x + r, y + PLAYER_HEIGHT - HEAD_SIZE, z + r] },
    head: {
      min: [x - r * 0.7, y + PLAYER_HEIGHT - HEAD_SIZE, z - r * 0.7],
      max: [x + r * 0.7, y + PLAYER_HEIGHT, z + r * 0.7],
    },
  };
}

export { EYE_HEIGHT };
