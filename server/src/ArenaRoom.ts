import { Room, type Client } from "@colyseus/core";
import {
  DT, EYE_HEIGHT, IDLE_INPUT_MS, KEY, KEY_MASK, MAX_ABUSE_STRIKES, MAX_HP,
  MAX_INPUT_CREDITS, MAX_MESSAGES_PER_SECOND, MAX_PITCH, MAX_PLAYERS,
  MAX_QUEUED_INPUTS, NAME_MAX_LEN, PLAYER_HEIGHT, RESPAWN_MS, TICK_RATE,
  SWITCH_TICKS, VISIBILITY_GRACE_MS,
} from "../../shared/src/constants";
import { mapById, type MapDef } from "../../shared/src/maps";
import { BLOOM_RECOVERY, damageFalloff, effectiveSpread, validLoadout, weaponStats, type WeaponStats } from "../../shared/src/weapons";
import {
  aimDirection, hitboxes, lineOfSight, rayBox, rayMap, stepMove,
  type InputCmd, type MoveState,
} from "../../shared/src/physics";
import type {
  DamagedMsg, HitMsg, KillMsg, OtherSnapshot, PickedMsg, PickupsMsg, RosterMsg, ShotMsg,
  SnapshotMsg, WelcomeMsg,
} from "../../shared/src/protocol";

export const FRAG_LIMIT = 20;
export const INTERMISSION_MS = 8000;
/** Retraso con el que el cliente dibuja a los demás jugadores (interpolación). */
export const CLIENT_INTERP_MS = 100;
const HISTORY_TICKS = 15; // 0.5 s de historial para compensar la latencia
const MAX_REWIND_TICKS = 9; // nunca se retrocede más de ~300 ms

interface PastPos { tick: number; x: number; y: number; z: number; alive: boolean }

class Player {
  readonly move: MoveState = { x: 0, y: 0, z: 0, vy: 0, onGround: true };
  yaw = 0;
  pitch = 0;
  hp = MAX_HP;
  alive = false;
  respawnAt = 0;
  weapon = 0; // 0 = principal, 1 = pistola
  loadout: [string, string];
  stats: [WeaponStats, WeaponStats];
  ammo: number[];
  reloadTicks = 0;
  fireCooldown = 0;
  switchTicks = 0;
  prevFire = false;
  /** Apertura de la mira por disparos seguidos (0..1). */
  bloom = 0;

  queue: InputCmd[] = [];
  lastSeq = 0;
  credits = 1;
  lastInputAt = Date.now();

  kills = 0;
  deaths = 0;

  msgCount = 0;
  msgWindowStart = Date.now();
  strikes = 0;

  rttMs = 100;
  /** id de jugador -> última vez (ms) que este jugador lo vio */
  lastSeen = new Map<number, number>();
  history: PastPos[] = [];

  constructor(
    readonly id: number,
    readonly client: Client,
    readonly name: string,
    loadout: [string, string],
  ) {
    this.loadout = loadout;
    this.stats = [weaponStats(loadout[0]), weaponStats(loadout[1])];
    this.ammo = this.stats.map((w) => w.magazine);
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const clean = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _\-.]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LEN);
  return clean.length > 0 ? clean : fallback;
}

/** Normaliza un ángulo a (-PI, PI]. */
function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

export class ArenaRoom extends Room {
  maxClients = MAX_PLAYERS;

  private players = new Map<string, Player>(); // sessionId -> Player
  private nextId = 1;
  private tick = 0;
  private intermissionUntil = 0;
  private winner: string | null = null;
  /** id del botiquín -> momento (ms) en que vuelve a aparecer; 0 = disponible */
  private map: MapDef = mapById(undefined);
  private pickupRespawn = new Map<number, number>();

  onCreate(options: { map?: unknown } = {}) {
    this.map = mapById(options?.map);
    this.pickupRespawn = new Map(this.map.pickups.map((p) => [p.id, 0]));
    this.setMetadata({ map: this.map.id });
    this.setSimulationInterval(() => this.update(), 1000 / TICK_RATE);

    this.onMessage("input", (client, msg: unknown) => {
      const p = this.players.get(client.sessionId);
      if (!p || !this.countMessage(p)) return;
      const cmd = this.validateInput(p, msg);
      if (!cmd) return;
      if (p.queue.length >= MAX_QUEUED_INPUTS) return; // demasiados: se descarta
      p.queue.push(cmd);
      p.lastInputAt = Date.now();
    });

    this.onMessage("pong", (client, msg: unknown) => {
      const p = this.players.get(client.sessionId);
      if (!p || !this.countMessage(p)) return;
      const t = (msg as { t?: unknown })?.t;
      if (!isFiniteNumber(t)) return this.strike(p, "pong inválido");
      const rtt = Date.now() - t;
      if (rtt >= 0 && rtt < 5000) p.rttMs = p.rttMs * 0.7 + rtt * 0.3;
    });

    this.onMessage("*", (client) => {
      const p = this.players.get(client.sessionId);
      if (p) this.strike(p, "tipo de mensaje desconocido");
    });

    // Medimos la latencia nosotros: nunca confiamos en lo que diga el cliente.
    this.clock.setInterval(() => {
      const t = Date.now();
      for (const p of this.players.values()) p.client.send("ping", { t });
    }, 1000);
  }

  onJoin(client: Client, options: { name?: unknown; primary?: unknown; secondary?: unknown } = {}) {
    const id = this.nextId++;
    const name = sanitizeName(options?.name, `Jugador${id}`);
    const p = new Player(id, client, name, validLoadout(options?.primary, options?.secondary));
    this.players.set(client.sessionId, p);
    this.respawn(p);
    client.send("welcome", { id, tickRate: TICK_RATE, map: this.map.id } satisfies WelcomeMsg);
    client.send("pickups", this.pickupsMsg());
    this.sendRoster();
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    this.sendRoster();
  }

  // ---------- Validación y anti-abuso ----------

  /** Cuenta mensajes por segundo. Devuelve false si el mensaje debe ignorarse. */
  private countMessage(p: Player): boolean {
    const now = Date.now();
    if (now - p.msgWindowStart >= 1000) {
      p.msgWindowStart = now;
      p.msgCount = 0;
    }
    p.msgCount++;
    if (p.msgCount === MAX_MESSAGES_PER_SECOND + 1) {
      this.strike(p, "demasiados mensajes por segundo");
    }
    return p.msgCount <= MAX_MESSAGES_PER_SECOND;
  }

  private strike(p: Player, reason: string) {
    p.strikes++;
    if (p.strikes >= MAX_ABUSE_STRIKES) {
      console.warn(`[anti-abuso] expulsando a ${p.name} (#${p.id}): ${reason}`);
      p.client.leave(4001, "comportamiento sospechoso");
    }
  }

  private validateInput(p: Player, msg: unknown): InputCmd | null {
    const m = msg as Partial<InputCmd> | null;
    if (
      !m || typeof m !== "object" ||
      !Number.isInteger(m.seq) || !Number.isInteger(m.keys) ||
      !isFiniteNumber(m.yaw) || !isFiniteNumber(m.pitch)
    ) {
      this.strike(p, "input con formato inválido");
      return null;
    }
    const seq = m.seq as number;
    // Los inputs deben llegar en orden; los repetidos o viejos se ignoran.
    const lastQueued = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
    if (seq <= lastQueued) return null;
    return {
      seq,
      keys: (m.keys as number) & KEY_MASK,
      yaw: wrapAngle(m.yaw as number),
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, m.pitch as number)),
    };
  }

  // ---------- Simulación ----------

  private update() {
    this.tick++;
    const now = Date.now();

    if (this.intermissionUntil && now >= this.intermissionUntil) this.startRound();

    for (const p of this.players.values()) {
      // Cada tick da 1 "crédito" para procesar 1 input. Así, aunque un tramposo
      // envíe 300 inputs por segundo, nunca se mueve ni dispara más rápido de lo normal.
      p.credits = Math.min(p.credits + 1, MAX_INPUT_CREDITS);
      let processed = 0;
      while (p.queue.length > 0 && p.credits >= 1) {
        const cmd = p.queue.shift()!;
        p.credits--;
        this.simulate(p, cmd);
        processed++;
      }
      // Si deja de enviar inputs (lag switch), no se queda flotando: cae y se detiene.
      if (processed === 0 && now - p.lastInputAt > IDLE_INPUT_MS) {
        this.simulate(p, { seq: p.lastSeq, keys: 0, yaw: p.yaw, pitch: p.pitch });
      }

      if (!p.alive && !this.intermissionUntil && now >= p.respawnAt) {
        this.respawn(p);
        this.sendRoster();
      }

      p.history.push({ tick: this.tick, x: p.move.x, y: p.move.y, z: p.move.z, alive: p.alive });
      if (p.history.length > HISTORY_TICKS) p.history.shift();
    }

    this.updatePickups(now);

    this.sendSnapshots(now);
  }

  private simulate(p: Player, cmd: InputCmd) {
    p.lastSeq = cmd.seq;
    p.yaw = cmd.yaw;
    p.pitch = cmd.pitch;
    if (!p.alive) return;

    stepMove(p.move, cmd.keys, cmd.yaw, DT, this.map.boxes);

    const w = p.stats[p.weapon];
    if (p.fireCooldown > 0) p.fireCooldown--;
    p.bloom = Math.max(0, p.bloom - BLOOM_RECOVERY);
    if (p.switchTicks > 0) p.switchTicks--;
    if (p.reloadTicks > 0) {
      p.reloadTicks--;
      if (p.reloadTicks === 0) p.ammo[p.weapon] = w.magazine;
    }
    // Cambio de arma: cancela la recarga y tarda un momento en estar lista
    const want = (cmd.keys & KEY.WEAPON1) ? 0 : (cmd.keys & KEY.WEAPON2) ? 1 : p.weapon;
    if (want !== p.weapon) {
      p.weapon = want;
      p.reloadTicks = 0;
      p.switchTicks = SWITCH_TICKS;
      p.prevFire = (cmd.keys & KEY.FIRE) !== 0;
      return;
    }
    const firing = (cmd.keys & KEY.FIRE) !== 0;
    const trigger = w.semiAuto ? firing && !p.prevFire : firing;
    p.prevFire = firing;
    if ((cmd.keys & KEY.RELOAD) && p.ammo[p.weapon] < w.magazine && p.reloadTicks === 0 && p.switchTicks === 0) {
      p.reloadTicks = w.reloadTicks;
    }
    if (trigger && p.fireCooldown === 0 && p.reloadTicks === 0 && p.switchTicks === 0 && p.ammo[p.weapon] > 0) {
      p.ammo[p.weapon]--;
      p.fireCooldown = w.fireIntervalTicks;
      this.fire(p, (cmd.keys & KEY.AIM) !== 0);
      p.bloom = Math.min(1, p.bloom + w.bloom);
      if (p.ammo[p.weapon] === 0) p.reloadTicks = w.reloadTicks;
    }
  }

  /** Posición de un jugador en el pasado, para la compensación de latencia. */
  private pastPosition(q: Player, ticksAgo: number): PastPos {
    const target = this.tick - ticksAgo;
    for (let i = q.history.length - 1; i >= 0; i--) {
      if (q.history[i].tick <= target) return q.history[i];
    }
    return q.history[0] ?? { tick: this.tick, ...q.move, alive: q.alive };
  }

  private fire(p: Player, aiming: boolean) {
    const ox = p.move.x, oy = p.move.y + EYE_HEIGHT, oz = p.move.z;
    const [adx, ady, adz] = aimDirection(p.yaw, p.pitch);
    const w = p.stats[p.weapon];

    // El tirador vio a los demás con retraso (su ping + interpolación), así que
    // comprobamos el impacto contra donde estaban en ese momento, con un límite.
    const rewind = Math.min(
      MAX_REWIND_TICKS,
      Math.round((p.rttMs / 2 + CLIENT_INTERP_MS) / (DT * 1000)),
    );
    const targets = this.intermissionUntil ? [] : [...this.players.values()]
      .filter((q) => q !== p && q.alive)
      .map((q) => ({ q, past: this.pastPosition(q, rewind) }))
      .filter((t) => t.past.alive);

    // Daño acumulado por víctima (una escopeta lanza varios perdigones)
    const damageTo = new Map<Player, { damage: number; headshot: boolean }>();
    // Dispersión según el arma y la situación: apuntar la cierra; correr, saltar y las ráfagas la abren
    const spread = effectiveSpread(w, { aiming, bloom: p.bloom, speed: Math.hypot(p.move.vx ?? 0, p.move.vz ?? 0), onGround: p.move.onGround });
    for (let k = 0; k < w.pellets; k++) {
      // Dispersión calculada en el servidor: el cliente no la puede "corregir"
      const yawJ = (Math.random() * 2 - 1) * spread, pitchJ = (Math.random() * 2 - 1) * spread;
      const [dx, dy, dz] = spread > 0 ? aimDirection(p.yaw + yawJ, p.pitch + pitchJ) : [adx, ady, adz];
      let best = rayMap(ox, oy, oz, dx, dy, dz, w.range, this.map.boxes);
      let victim: Player | null = null;
      let headshot = false;
      for (const { q, past } of targets) {
        const hb = hitboxes(past.x, past.y, past.z);
        const tHead = rayBox(ox, oy, oz, dx, dy, dz, hb.head.min, hb.head.max);
        const tBody = rayBox(ox, oy, oz, dx, dy, dz, hb.body.min, hb.body.max);
        const t = Math.min(tHead, tBody);
        if (t < best) { best = t; victim = q; headshot = tHead <= tBody; }
      }
      const from: [number, number, number] = [ox, oy - 0.15, oz];
      const to: [number, number, number] = [ox + dx * best, oy + dy * best, oz + dz * best];
      const shot: ShotMsg = { id: p.id, from, to, slot: p.weapon };
      for (const r of this.players.values()) {
        if (r === p) continue; // el tirador dibuja su propia trazadora al instante
        const canSee = (r.lastSeen.get(p.id) ?? 0) > Date.now() - VISIBILITY_GRACE_MS;
        if (canSee || r === victim) r.client.send("shot", shot);
      }
      if (victim) {
        const prev = damageTo.get(victim) ?? { damage: 0, headshot: false };
        // El daño baja con la distancia según el tipo de arma
        prev.damage += (headshot ? w.headshotDamage : w.damage) * damageFalloff(w, best);
        prev.headshot ||= headshot;
        damageTo.set(victim, prev);
      }
    }

    for (const [victim, { damage: rawDamage, headshot }] of damageTo) {
      if (!victim.alive) continue;
      const damage = Math.max(1, Math.round(rawDamage));
      victim.hp = Math.max(0, victim.hp - damage);
      const killed = victim.hp === 0;
      p.client.send("hit", { victim: victim.id, damage, headshot, kill: killed } satisfies HitMsg);
      victim.client.send("damaged", {
        fromAngle: Math.atan2(p.move.x - victim.move.x, p.move.z - victim.move.z),
      } satisfies DamagedMsg);
      if (killed) {
        victim.alive = false;
        victim.deaths++;
        victim.respawnAt = Date.now() + RESPAWN_MS;
        p.kills++;
        this.broadcast("kill", { killer: p.id, victim: victim.id, headshot } satisfies KillMsg);
        if (p.kills >= FRAG_LIMIT) this.endRound(p);
        this.sendRoster();
      }
    }
  }

  // ---------- Botiquines ----------

  private pickupsMsg(): PickupsMsg {
    return { active: this.map.pickups.filter((k) => this.pickupRespawn.get(k.id) === 0).map((k) => k.id) };
  }

  /** El servidor decide quién recoge un botiquín: basta con estar encima. */
  private updatePickups(now: number) {
    let changed = false;
    for (const k of this.map.pickups) {
      const at = this.pickupRespawn.get(k.id)!;
      if (at !== 0) {
        if (now >= at) { this.pickupRespawn.set(k.id, 0); changed = true; }
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.hp >= MAX_HP) continue;
        const dx = p.move.x - k.x, dz = p.move.z - k.z, dy = p.move.y - k.y;
        if (dx * dx + dz * dz < 1.1 * 1.1 && dy > -0.5 && dy < 1.5) {
          const before = p.hp;
          p.hp = Math.min(MAX_HP, p.hp + k.amount);
          p.client.send("picked", { id: k.id, amount: p.hp - before } satisfies PickedMsg);
          this.pickupRespawn.set(k.id, now + k.respawnMs);
          changed = true;
          break;
        }
      }
    }
    if (changed) this.broadcast("pickups", this.pickupsMsg());
  }

  private respawn(p: Player) {
    const others = [...this.players.values()].filter((q) => q !== p && q.alive);
    // Elegimos el punto de aparición más lejano a los demás jugadores vivos.
    let bestSpawn = this.map.spawns[0];
    let bestScore = -Infinity;
    for (const s of this.map.spawns) {
      const minDist = others.length
        ? Math.min(...others.map((q) => Math.hypot(q.move.x - s.x, q.move.z - s.z)))
        : 1000;
      const score = minDist + Math.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        bestSpawn = s;
      }
    }
    Object.assign(p.move, { x: bestSpawn.x, y: 0, z: bestSpawn.z, vy: 0, onGround: true });
    p.yaw = bestSpawn.yaw;
    p.pitch = 0;
    p.hp = MAX_HP;
    p.alive = true;
    p.ammo = p.stats.map((x) => x.magazine);
    p.weapon = 0;
    p.switchTicks = 0;
    p.reloadTicks = 0;
    p.fireCooldown = 0;
    p.bloom = 0;
    p.move.vx = 0;
    p.move.vz = 0;
    p.history = [];
  }

  private endRound(winner: Player) {
    this.winner = winner.name;
    this.intermissionUntil = Date.now() + INTERMISSION_MS;
  }

  private startRound() {
    this.intermissionUntil = 0;
    this.winner = null;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      this.respawn(p);
    }
    this.sendRoster();
  }

  // ---------- Envío de estado ----------

  private sendRoster() {
    const msg: RosterMsg = {
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, alive: p.alive, loadout: p.loadout,
      })),
      fragLimit: FRAG_LIMIT,
      intermission: this.intermissionUntil ? Math.max(0, this.intermissionUntil - Date.now()) : 0,
      winner: this.winner,
    };
    this.broadcast("roster", msg);
  }

  /**
   * Cada jugador recibe SOLO la posición de los enemigos que puede ver.
   * Así un "wallhack" no tiene nada que mostrar: el dato nunca llega al navegador.
   */
  private sendSnapshots(now: number) {
    const all = [...this.players.values()];
    for (const r of all) {
      const ex = r.move.x, ey = r.move.y + EYE_HEIGHT, ez = r.move.z;
      const others: OtherSnapshot[] = [];
      for (const q of all) {
        if (q === r || !q.alive) continue;
        const close = Math.hypot(q.move.x - ex, q.move.z - ez) < 3;
        const visible =
          close ||
          lineOfSight(ex, ey, ez, q.move.x, q.move.y + PLAYER_HEIGHT - 0.1, q.move.z, this.map.boxes) ||
          lineOfSight(ex, ey, ez, q.move.x, q.move.y + 0.9, q.move.z, this.map.boxes) ||
          lineOfSight(ex, ey, ez, q.move.x, q.move.y + 0.2, q.move.z, this.map.boxes);
        if (visible) r.lastSeen.set(q.id, now);
        if (now - (r.lastSeen.get(q.id) ?? 0) <= VISIBILITY_GRACE_MS) {
          others.push([
            q.id,
            round2(q.move.x), round2(q.move.y), round2(q.move.z),
            round3(q.yaw), round3(q.pitch), q.hp, q.weapon,
          ]);
        }
      }
      const snap: SnapshotMsg = {
        tick: this.tick,
        you: {
          x: r.move.x, y: r.move.y, z: r.move.z, vy: r.move.vy, g: r.move.onGround,
          vx: r.move.vx ?? 0, vz: r.move.vz ?? 0,
          yaw: r.yaw,
          seq: r.lastSeq,
          hp: r.hp,
          alive: r.alive,
          ammo: r.ammo[r.weapon],
          weapon: r.weapon,
          switching: r.switchTicks > 0,
          reloading: r.reloadTicks > 0,
          respawnIn: r.alive ? 0 : Math.max(0, r.respawnAt - now),
          ping: Math.round(r.rttMs),
        },
        others,
      };
      r.client.send("snap", snap);
    }
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
