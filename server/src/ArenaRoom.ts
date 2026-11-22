import { Room, type Client } from "@colyseus/core";
import {
  DT, EYE_HEIGHT, IDLE_INPUT_MS, KEY, KEY_MASK, MAX_ABUSE_STRIKES, MAX_HP,
  MAX_INPUT_CREDITS, MAX_MESSAGES_PER_SECOND, MAX_PITCH, MAX_PLAYERS,
  MAX_QUEUED_INPUTS, NAME_MAX_LEN, PLAYER_HEIGHT, RESPAWN_MS, TICK_RATE,
  SWITCH_TICKS, VISIBILITY_GRACE_MS,
} from "../../shared/src/constants";
import { mapById, type MapDef } from "../../shared/src/maps";
import { BLOOM_RECOVERY, damageFalloff, effectiveSpread, validLoadout, weaponStats, type Loadout, type WeaponStats } from "../../shared/src/weapons";
import { gearHp, validLook, type Look } from "../../shared/src/gear";
import { BOT_NAMES, BotBrain, MAX_BOTS, randomBotPrimary } from "./bots";
import {
  aimDirection, hitboxes, lineOfSight, rayBox, rayMap, stepMove,
  type InputCmd, type MoveState,
} from "../../shared/src/physics";
import type {
  BoomMsg, DamagedMsg, HitMsg, KillMsg, OtherSnapshot, PickedMsg, PickupsMsg, ProjMsg, RosterMsg, ShotMsg, SwingMsg,
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
  weapon = 0; // 0 = principal, 1 = pistola, 2 = arma blanca
  loadout: Loadout;
  stats: WeaponStats[];
  /** Vida máxima: 100 más lo que suma el equipo. */
  maxHp: number;
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
  /** Cerebro del bot (null en jugadores de verdad). */
  bot: BotBrain | null = null;
  /** id de jugador -> última vez (ms) que este jugador lo vio */
  lastSeen = new Map<number, number>();
  history: PastPos[] = [];

  constructor(
    readonly id: number,
    readonly client: Client,
    readonly name: string,
    loadout: Loadout,
    readonly look: Look,
  ) {
    this.loadout = loadout;
    this.stats = loadout.map((id) => weaponStats(id));
    this.maxHp = MAX_HP + gearHp(look);
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

/** "Cliente" de un bot: no tiene conexión, así que lo que se le envía se descarta. */
function botClient(sessionId: string): Client {
  return { sessionId, send() {}, leave() {} } as unknown as Client;
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
  /** Cuántos bots quiere la sala (lo elige en el menú la última persona que entró). */
  private botTarget = 0;

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

  onJoin(client: Client, options: { name?: unknown; primary?: unknown; secondary?: unknown; melee?: unknown; skin?: unknown; helmet?: unknown; vest?: unknown; pack?: unknown; bots?: unknown } = {}) {
    const id = this.nextId++;
    const name = sanitizeName(options?.name, `Jugador${id}`);
    const p = new Player(id, client, name, validLoadout(options?.primary, options?.secondary, options?.melee), validLook(options));
    this.players.set(client.sessionId, p);
    this.respawn(p);
    client.send("welcome", { id, tickRate: TICK_RATE, map: this.map.id } satisfies WelcomeMsg);
    client.send("pickups", this.pickupsMsg());
    if (isFiniteNumber(options?.bots)) this.botTarget = Math.max(0, Math.min(MAX_BOTS, Math.round(options.bots)));
    this.syncBots();
    this.sendRoster();
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    this.syncBots();
    this.sendRoster();
  }

  // ---------- Bots ----------

  /** Ajusta los bots: tantos como pidió la sala mientras haya alguna persona jugando, y ninguno si no. */
  private syncBots() {
    const all = [...this.players.entries()];
    const humans = all.filter(([, p]) => !p.bot).length;
    const bots = all.filter(([, p]) => p.bot);
    const want = humans > 0 ? Math.min(this.botTarget, MAX_PLAYERS - humans) : 0;
    for (let i = bots.length; i < want; i++) {
      const id = this.nextId++;
      const used = new Set(bots.map(([, p]) => p.name));
      const name = `BOT ${BOT_NAMES.find((n) => !used.has(`BOT ${n}`)) ?? id}`;
      const sid = `bot-${id}`;
      const p = new Player(id, botClient(sid), name, validLoadout(randomBotPrimary(), undefined, undefined), validLook());
      p.bot = new BotBrain();
      this.players.set(sid, p);
      bots.push([sid, p]);
      this.respawn(p);
    }
    for (const [sid] of bots.slice(want)) this.players.delete(sid);
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

    // Los bots deciden su input de este tick con lo que ven ahora
    const everyone = [...this.players.values()];
    for (const p of everyone) {
      if (!p.bot) continue;
      p.queue.length = 0;
      p.queue.push(p.bot.think(p, everyone, this.map.boxes, this.map.spawns, now));
      p.lastInputAt = now;
    }

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

    this.updateProjectiles();
    this.updatePickups(now);

    this.sendSnapshots(now);
  }

  private simulate(p: Player, cmd: InputCmd) {
    p.lastSeq = cmd.seq;
    p.yaw = cmd.yaw;
    p.pitch = cmd.pitch;
    if (!p.alive) return;

    stepMove(p.move, cmd.keys, cmd.yaw, DT, this.map.boxes, p.stats[p.weapon].speedK);

    const w = p.stats[p.weapon];
    if (p.fireCooldown > 0) p.fireCooldown--;
    p.bloom = Math.max(0, p.bloom - BLOOM_RECOVERY);
    if (p.switchTicks > 0) p.switchTicks--;
    if (p.reloadTicks > 0) {
      p.reloadTicks--;
      if (p.reloadTicks === 0) p.ammo[p.weapon] = w.magazine;
    }
    // Cambio de arma: cancela la recarga y tarda un momento en estar lista
    const want = (cmd.keys & KEY.WEAPON1) ? 0 : (cmd.keys & KEY.WEAPON2) ? 1 : (cmd.keys & KEY.WEAPON3) ? 2 : p.weapon;
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
    // Arma blanca: sin munición ni recarga
    if (w.meleeRange > 0) {
      if (trigger && p.fireCooldown === 0 && p.switchTicks === 0) {
        p.fireCooldown = w.fireIntervalTicks;
        this.meleeAttack(p);
      }
      return;
    }
    if ((cmd.keys & KEY.RELOAD) && p.ammo[p.weapon] < w.magazine && p.reloadTicks === 0 && p.switchTicks === 0) {
      p.reloadTicks = w.reloadTicks;
    }
    if (trigger && p.fireCooldown === 0 && p.reloadTicks === 0 && p.switchTicks === 0 && p.ammo[p.weapon] > 0) {
      p.ammo[p.weapon]--;
      p.fireCooldown = w.fireIntervalTicks;
      if (w.projectile) this.launch(p);
      else this.fire(p, (cmd.keys & KEY.AIM) !== 0);
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

    for (const [victim, { damage, headshot }] of damageTo) this.applyDamage(p, victim, damage, headshot);
  }

  /** Aplica daño de `p` a `victim`: avisa a ambos y, si muere, cuenta la baja. */
  private applyDamage(p: Player, victim: Player, rawDamage: number, headshot: boolean) {
    if (!victim.alive || this.intermissionUntil) return;
    const damage = Math.max(1, Math.round(rawDamage));
    victim.hp = Math.max(0, victim.hp - damage);
    const killed = victim.hp === 0;
    if (victim !== p) {
      p.client.send("hit", { victim: victim.id, damage, headshot, kill: killed } satisfies HitMsg);
      victim.client.send("damaged", {
        fromAngle: Math.atan2(p.move.x - victim.move.x, p.move.z - victim.move.z),
      } satisfies DamagedMsg);
    } else {
      victim.client.send("damaged", { fromAngle: victim.yaw + Math.PI } satisfies DamagedMsg);
    }
    if (killed) {
      victim.alive = false;
      victim.deaths++;
      victim.respawnAt = Date.now() + RESPAWN_MS;
      // Matarse con el propio cohete resta una baja
      if (victim === p) p.kills = Math.max(0, p.kills - 1);
      else p.kills++;
      this.broadcast("kill", { killer: p.id, victim: victim.id, headshot } satisfies KillMsg);
      if (p.kills >= FRAG_LIMIT) this.endRound(p);
      this.sendRoster();
    }
  }

  /** Golpe con arma blanca: acierta al rival más cercano dentro del alcance y delante del jugador. */
  private meleeAttack(p: Player) {
    const w = p.stats[p.weapon];
    const ox = p.move.x, oy = p.move.y + EYE_HEIGHT, oz = p.move.z;
    const [dx, dy, dz] = aimDirection(p.yaw, p.pitch);
    const rewind = Math.min(MAX_REWIND_TICKS, Math.round((p.rttMs / 2 + CLIENT_INTERP_MS) / (DT * 1000)));
    let best: Player | null = null, bestD = Infinity;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || this.intermissionUntil) continue;
      const past = this.pastPosition(q, rewind);
      if (!past.alive) continue;
      // punto del cuerpo del rival más cercano a la altura de los ojos del atacante
      const ty = Math.min(past.y + PLAYER_HEIGHT - 0.1, Math.max(past.y + 0.3, oy));
      const vx = past.x - ox, vy = ty - oy, vz = past.z - oz;
      const d = Math.hypot(vx, vy, vz);
      if (d > w.meleeRange + 0.45 || d >= bestD) continue;
      // dentro de un cono de ~40° (más abierto si está pegado)
      const cos = d > 0.01 ? (vx * dx + vy * dy + vz * dz) / d : 1;
      if (cos < (d < 1.2 ? 0.3 : 0.76)) continue;
      if (!lineOfSight(ox, oy, oz, past.x, ty, past.z, this.map.boxes)) continue;
      best = q; bestD = d;
    }
    for (const r of this.players.values()) {
      if (r === p) continue;
      const canSee = (r.lastSeen.get(p.id) ?? 0) > Date.now() - VISIBILITY_GRACE_MS;
      if (canSee || r === best) r.client.send("swing", { id: p.id, hit: !!best } satisfies SwingMsg);
    }
    if (best) this.applyDamage(p, best, w.damage, false);
  }

  // ---------- Proyectiles de los cañones ----------

  private projectiles: { id: number; owner: Player; slot: number; w: WeaponStats; x: number; y: number; z: number; dx: number; dy: number; dz: number; vy: number; life: number; age: number }[] = [];
  private nextProjId = 1;

  /** Lanza un proyectil desde los ojos del jugador. */
  private launch(p: Player) {
    const w = p.stats[p.weapon];
    const pr = w.projectile!;
    const [dx, dy, dz] = aimDirection(p.yaw, p.pitch);
    const proj = {
      id: this.nextProjId++, owner: p, slot: p.weapon, w,
      x: p.move.x + dx * 0.5, y: p.move.y + EYE_HEIGHT - 0.12 + dy * 0.5, z: p.move.z + dz * 0.5,
      dx, dy, dz, vy: 0, life: w.range / pr.speed, age: 0,
    };
    this.projectiles.push(proj);
    this.broadcast("proj", {
      id: proj.id, owner: p.id, slot: p.weapon, from: [proj.x, proj.y, proj.z], dir: [dx, dy, dz], speed: pr.speed, gravity: pr.gravity,
    } satisfies ProjMsg);
  }

  private updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const cfg = pr.w.projectile!;
      // velocidad de este tick (la gravedad curva la trayectoria)
      pr.vy -= cfg.gravity * DT;
      let vx = pr.dx * cfg.speed, vy = pr.dy * cfg.speed + pr.vy, vz = pr.dz * cfg.speed;
      const step = Math.hypot(vx, vy, vz) * DT;
      vx /= step / DT; vy /= step / DT; vz /= step / DT;
      let t = rayMap(pr.x, pr.y, pr.z, vx, vy, vz, step, this.map.boxes);
      let direct: Player | null = null;
      for (const q of this.players.values()) {
        if (!q.alive || (q === pr.owner && pr.age < 6)) continue;
        const hb = hitboxes(q.move.x, q.move.y, q.move.z);
        const tq = Math.min(
          rayBox(pr.x, pr.y, pr.z, vx, vy, vz, hb.head.min, hb.head.max),
          rayBox(pr.x, pr.y, pr.z, vx, vy, vz, hb.body.min, hb.body.max),
        );
        if (tq < t) { t = tq; direct = q; }
      }
      pr.age++;
      pr.life -= DT;
      if (t < step || pr.life <= 0 || !this.players.has(pr.owner.client.sessionId)) {
        const d = Math.min(t, step);
        this.explode(pr, pr.x + vx * d, pr.y + vy * d, pr.z + vz * d, direct, -vx, -vy, -vz);
        this.projectiles.splice(i, 1);
      } else {
        pr.x += vx * step; pr.y += vy * step; pr.z += vz * step;
      }
    }
  }

  /** Explosión: daño completo al impacto directo y decreciente con la distancia para los demás. */
  private explode(pr: { id: number; owner: Player; slot: number; w: WeaponStats }, x: number, y: number, z: number, direct: Player | null, bx: number, by: number, bz: number) {
    const cfg = pr.w.projectile!;
    this.broadcast("boom", { id: pr.id, owner: pr.owner.id, slot: pr.slot, pos: [x, y, z], radius: cfg.radius } satisfies BoomMsg);
    // el punto de la explosión se separa un poco de la pared para comprobar la línea de visión
    const ex = x + bx * 0.15, ey = y + by * 0.15, ez = z + bz * 0.15;
    for (const q of [...this.players.values()]) {
      if (!q.alive) continue;
      if (q === direct) { this.applyDamage(pr.owner, q, pr.w.damage, false); continue; }
      const cy = q.move.y + 0.9;
      const d = Math.hypot(q.move.x - ex, cy - ey, q.move.z - ez);
      if (d > cfg.radius) continue;
      if (!lineOfSight(ex, ey, ez, q.move.x, cy, q.move.z, this.map.boxes) &&
          !lineOfSight(ex, ey, ez, q.move.x, q.move.y + PLAYER_HEIGHT - 0.1, q.move.z, this.map.boxes)) continue;
      const k = 1 - 0.8 * (d / cfg.radius);
      // el propio tirador recibe la mitad
      this.applyDamage(pr.owner, q, cfg.splash * k * (q === pr.owner ? 0.5 : 1), false);
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
        if (!p.alive || p.hp >= p.maxHp) continue;
        const dx = p.move.x - k.x, dz = p.move.z - k.z, dy = p.move.y - k.y;
        if (dx * dx + dz * dz < 1.1 * 1.1 && dy > -0.5 && dy < 1.5) {
          const before = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + k.amount);
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
    p.hp = p.maxHp;
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
    this.projectiles = [];
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
        id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, alive: p.alive, loadout: p.loadout, look: p.look, maxHp: p.maxHp,
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
      if (r.bot) continue; // los bots no tienen pantalla: no necesitan snapshot
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
          maxHp: r.maxHp,
          alive: r.alive,
          ammo: r.stats[r.weapon].meleeRange > 0 ? -1 : r.ammo[r.weapon],
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
