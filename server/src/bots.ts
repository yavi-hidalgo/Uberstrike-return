// Bots para probar el juego sin otros jugadores. Viven en el servidor y juegan con las mismas reglas
// que una persona: cada tick generan un input (teclas + hacia dónde miran) que pasa por la misma
// simulación, así que no pueden moverse ni disparar más rápido que nadie.
//
// Comportamiento:
//  - Sin enemigos a la vista: caminan hacia puntos de aparición al azar y, si se atascan, saltan y cambian de rumbo.
//  - Con un enemigo a la vista: tardan un poco en reaccionar, giran hacia él con un error de puntería
//    que se va corrigiendo, disparan cuando lo tienen más o menos centrado y se mueven de lado a lado.
import { EYE_HEIGHT, KEY, MAX_PITCH } from "../../shared/src/constants";
import { lineOfSight, type InputCmd } from "../../shared/src/physics";
import type { Box } from "../../shared/src/map";
import { WEAPON_MODELS } from "../../shared/src/weapons";

export const BOT_NAMES = ["Vega", "Orión", "Nova", "Kilo", "Raptor", "Cobalto", "Sombra", "Atlas", "Lince", "Zafiro", "Halcón"];
export const MAX_BOTS = 8;

/** Arma principal al azar para cada bot (rifles, subfusiles y escopetas; sin cañones ni francotiradores). */
export function randomBotPrimary(): string {
  const pool = WEAPON_MODELS.filter((w) => w.category === "rifle" || w.category === "smg" || w.category === "shotgun");
  return pool[Math.floor(Math.random() * pool.length)]?.id ?? "";
}

export interface BotSelf {
  id: number;
  alive: boolean;
  hp: number;
  yaw: number;
  pitch: number;
  move: { x: number; y: number; z: number };
  ammo: number[];
  weapon: number;
}
export interface BotOther { id: number; alive: boolean; move: { x: number; y: number; z: number } }

const TICK_S = 1 / 30;
const SIGHT = 55; // metros
const TURN_RATE = 5.5; // rad/s
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class BotBrain {
  private seq = 0;
  private target = -1;
  private reactUntil = 0;
  private errYaw = 0;
  private errPitch = 0;
  private strafe: 0 | 4 | 8 = 0;
  private strafeUntil = 0;
  private waypoint: { x: number; z: number } | null = null;
  private stuckCheckAt = 0;
  private stuckFrom = { x: 0, z: 0 };
  private jumpUntil = 0;
  private lastHp = 0;
  private lookAroundUntil = 0;
  private lookAroundYaw = 0;

  constructor(private readonly skill = rand(0.55, 0.85)) {}

  think(me: BotSelf, others: BotOther[], boxes: Box[], spawns: { x: number; z: number }[], now: number): InputCmd {
    this.seq++;
    let keys = 0;
    let yaw = me.yaw, pitch = me.pitch;
    if (!me.alive) { this.target = -1; this.waypoint = null; this.lastHp = 0; return { seq: this.seq, keys, yaw, pitch }; }

    // ¿A quién veo? El más cercano con línea de visión
    const ex = me.move.x, ey = me.move.y + EYE_HEIGHT, ez = me.move.z;
    let best: BotOther | null = null, bestD = SIGHT;
    for (const o of others) {
      if (!o.alive || o.id === me.id) continue;
      const d = Math.hypot(o.move.x - ex, o.move.z - ez);
      if (d >= bestD) continue;
      if (!lineOfSight(ex, ey, ez, o.move.x, o.move.y + 1.2, o.move.z, boxes)) continue;
      best = o; bestD = d;
    }

    // Si me dispararon y no veo a nadie, miro alrededor un momento
    if (this.lastHp && me.hp < this.lastHp && !best && now > this.lookAroundUntil) {
      this.lookAroundUntil = now + 900;
      this.lookAroundYaw = me.yaw + Math.PI + rand(-0.6, 0.6);
    }
    this.lastHp = me.hp;

    if (best) {
      if (best.id !== this.target) {
        // nuevo objetivo: tiempo de reacción y error inicial de puntería
        this.target = best.id;
        this.reactUntil = now + rand(280, 620) / this.skill;
        this.errYaw = rand(-0.35, 0.35);
        this.errPitch = rand(-0.12, 0.12);
      }
      // el error se corrige poco a poco, más rápido cuanto más hábil es el bot
      const fix = 1 - 0.06 * this.skill;
      this.errYaw = this.errYaw * fix + rand(-0.012, 0.012);
      this.errPitch = this.errPitch * fix + rand(-0.006, 0.006);
      const dx = best.move.x - ex, dz = best.move.z - ez;
      const aimY = best.move.y + 1.15 + (Math.random() < 0.15 * this.skill ? 0.45 : 0); // a veces a la cabeza
      const wantYaw = Math.atan2(-dx, -dz) + this.errYaw;
      const wantPitch = Math.atan2(aimY - ey, Math.hypot(dx, dz)) + this.errPitch;
      yaw = this.turn(me.yaw, wantYaw);
      pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, me.pitch + (wantPitch - me.pitch) * 0.35));
      const off = Math.abs(wrap(wantYaw - this.errYaw - yaw));
      if (now > this.reactUntil && off < 0.12 + 1.5 / Math.max(bestD, 4) * 0.1) keys |= KEY.FIRE;
      // distancia: acercarse si está lejos, retroceder si está muy cerca
      if (bestD > 20) keys |= KEY.FORWARD;
      else if (bestD < 6) keys |= KEY.BACK;
      // esquivar de lado a lado
      if (now > this.strafeUntil) {
        this.strafe = Math.random() < 0.15 ? 0 : Math.random() < 0.5 ? KEY.LEFT : KEY.RIGHT;
        this.strafeUntil = now + rand(500, 1300);
      }
      keys |= this.strafe;
      this.waypoint = null;
    } else {
      this.target = -1;
      if (now < this.lookAroundUntil) {
        yaw = this.turn(me.yaw, this.lookAroundYaw);
      } else {
        // deambular hacia un punto de aparición al azar
        if (!this.waypoint || Math.hypot(this.waypoint.x - me.move.x, this.waypoint.z - me.move.z) < 3) {
          const s = spawns[Math.floor(Math.random() * spawns.length)];
          this.waypoint = s ? { x: s.x + rand(-4, 4), z: s.z + rand(-4, 4) } : null;
        }
        if (this.waypoint) {
          const want = Math.atan2(-(this.waypoint.x - me.move.x), -(this.waypoint.z - me.move.z));
          yaw = this.turn(me.yaw, want);
          if (Math.abs(wrap(want - yaw)) < 0.6) keys |= KEY.FORWARD | (Math.random() < 0.5 ? KEY.SPRINT : 0);
        }
        pitch = me.pitch * 0.9;
      }
      // recargar con calma si el cargador está a medias
      if (me.ammo[me.weapon] !== undefined && me.ammo[me.weapon] < 6) keys |= KEY.RELOAD;
    }

    // ¿atascado contra algo? saltar y buscar otro rumbo
    if (now > this.stuckCheckAt) {
      const moved = Math.hypot(me.move.x - this.stuckFrom.x, me.move.z - this.stuckFrom.z);
      if ((keys & KEY.FORWARD) && moved < 0.6) {
        this.jumpUntil = now + 250;
        this.waypoint = null;
      }
      this.stuckFrom = { x: me.move.x, z: me.move.z };
      this.stuckCheckAt = now + 1000;
    }
    if (now < this.jumpUntil) keys |= KEY.JUMP;
    if (me.weapon !== 0) keys |= KEY.WEAPON1;

    return { seq: this.seq, keys, yaw: wrap(yaw), pitch };
  }

  /** Gira hacia `want` sin pasar de la velocidad máxima de giro. */
  private turn(from: number, want: number): number {
    const d = wrap(want - from);
    const max = TURN_RATE * TICK_S * (0.7 + this.skill * 0.5);
    return from + Math.max(-max, Math.min(max, d));
  }
}
