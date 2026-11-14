// Pruebas de integración: levantan un servidor real y conectan clientes por WebSocket.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { ArenaRoom } from "../src/ArenaRoom";
import { DT, KEY, MOVE_SPEED, SWITCH_TICKS } from "../../shared/src/constants";
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, weaponStats } from "../../shared/src/weapons";
const WEAPON = weaponStats(DEFAULT_PRIMARY);
const PISTOL = weaponStats(DEFAULT_SECONDARY);
import type { SnapshotMsg } from "../../shared/src/protocol";

const PORT = 2600 + Math.floor(Math.random() * 300);
let server: Server;

before(async () => {
  server = new Server({ transport: new WebSocketTransport() });
  server.define("arena", ArenaRoom);
  await server.listen(PORT);
});

after(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot {
  room: Room;
  id: number;
  last: SnapshotMsg | null;
  events: { type: string; msg: any }[];
}

async function join(name: string, roomId?: string, extra: Record<string, unknown> = {}): Promise<Bot> {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = roomId
    ? await client.joinById(roomId, { name, ...extra })
    : await client.create("arena", { name, ...extra });
  const bot: Bot = { room, id: 0, last: null, events: [] };
  room.onMessage("welcome", (m) => (bot.id = m.id));
  room.onMessage("snap", (m) => (bot.last = m));
  room.onMessage("ping", (m) => room.send("pong", m));
  for (const t of ["hit", "kill", "shot", "damaged", "roster", "picked", "pickups"]) {
    room.onMessage(t, (m) => bot.events.push({ type: t, msg: m }));
  }
  await sleep(150);
  return bot;
}

function serverRoom(bot: Bot): any {
  return matchMaker.getLocalRoomById(bot.room.roomId);
}

function serverPlayer(bot: Bot): any {
  return serverRoom(bot).players.get(bot.room.sessionId);
}

test("un jugador entra, recibe su id y su estado", async () => {
  const a = await join("Ana");
  assert.ok(a.id > 0);
  assert.ok(a.last, "debe recibir snapshots");
  assert.equal(a.last!.you.hp, 100);
  assert.equal(a.last!.you.alive, true);
  await a.room.leave();
});

test("los nombres se limpian en el servidor", async () => {
  const a = await join("<script>alert(1)</script>Ana_con_un_nombre_larguisimo");
  const p = serverPlayer(a);
  assert.ok(!p.name.includes("<"));
  assert.ok(p.name.length <= 16);
  await a.room.leave();
});

test("anti speed-hack: mandar 300 inputs de golpe no te hace ir más rápido", async () => {
  const a = await join("Rapido");
  const p = serverPlayer(a);
  // Lo ponemos en un sitio despejado mirando a lo largo de un pasillo libre.
  Object.assign(p.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true });
  const start = { x: p.move.x, z: p.move.z };

  for (let i = 1; i <= 300; i++) {
    a.room.send("input", { seq: i, keys: KEY.FORWARD, yaw: Math.PI, pitch: 0 }); // hacia +z
  }
  await sleep(1000);

  const dist = Math.hypot(p.move.x - start.x, p.move.z - start.z);
  const honestMax = MOVE_SPEED * 1.2; // ~1 s de movimiento honesto, con margen
  assert.ok(dist <= honestMax, `se movió ${dist.toFixed(1)} m; máximo honesto ${honestMax}`);
  await a.room.leave().catch(() => {});
});

test("movimiento normal: 30 inputs por segundo avanzan ~MOVE_SPEED metros", async () => {
  const a = await join("Normal");
  const p = serverPlayer(a);
  Object.assign(p.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true });
  for (let i = 1; i <= 30; i++) {
    a.room.send("input", { seq: i, keys: KEY.FORWARD, yaw: Math.PI, pitch: 0 });
    await sleep(DT * 1000);
  }
  await sleep(200);
  const dist = Math.abs(p.move.z - -12);
  assert.ok(Math.abs(dist - MOVE_SPEED) < 0.6, `avanzó ${dist.toFixed(2)} m`);
  await a.room.leave();
});

test("inputs basura acaban en expulsión", async () => {
  const a = await join("Basura");
  let closedCode = 0;
  a.room.onLeave((code) => (closedCode = code));
  for (let i = 0; i < 10; i++) a.room.send("input", { seq: "x", keys: {}, yaw: NaN });
  await sleep(300);
  assert.equal(closedCode, 4001);
});

test("disparo autoritativo: el servidor calcula el impacto y la muerte", async () => {
  const a = await join("Tirador");
  const b = await join("Blanco", a.room.roomId);
  const pa = serverPlayer(a), pb = serverPlayer(b);
  // Frente a frente en campo abierto, a 10 m, sin nada entre medio.
  Object.assign(pa.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true });
  Object.assign(pb.move, { x: -27, y: 0, z: -2, vy: 0, onGround: true });
  await sleep(500); // llenar el historial de posiciones

  const shotsToKill = Math.ceil(100 / WEAPON.damage);
  let seq = 1;
  for (let i = 0; i < shotsToKill * WEAPON.fireIntervalTicks + 2; i++) {
    a.room.send("input", { seq: seq++, keys: KEY.FIRE, yaw: Math.PI, pitch: -0.02 });
    await sleep(DT * 1000);
  }
  await sleep(200);

  const kill = a.events.find((e) => e.type === "kill");
  assert.ok(kill, "debe haber una muerte");
  assert.equal(kill!.msg.killer, a.id);
  assert.equal(kill!.msg.victim, b.id);
  assert.equal(pb.alive, false);
  assert.ok(b.events.some((e) => e.type === "damaged"));
  await a.room.leave();
  await b.room.leave();
});

test("anti wallhack: no recibes la posición de enemigos detrás de una pared", async () => {
  const a = await join("Ojo");
  const b = await join("Escondido", a.room.roomId);
  const pa = serverPlayer(a), pb = serverPlayer(b);
  // La cabaña de (-18, -20) mide 5 x 4 m y 3 m de alto: tapa por completo.
  Object.assign(pa.move, { x: -25, y: 0, z: -20, vy: 0, onGround: true });
  Object.assign(pb.move, { x: -11, y: 0, z: -20, vy: 0, onGround: true });
  await sleep(600);
  assert.equal(a.last!.others.length, 0, "detrás de la cabaña no debe llegar nada");

  // Sale de detrás de la cabaña: ahora sí debe aparecer.
  Object.assign(pb.move, { x: -11, y: 0, z: -12 });
  await sleep(200);
  assert.equal(a.last!.others.length, 1);
  assert.equal(a.last!.others[0][0], b.id);
  await a.room.leave();
  await b.room.leave();
});

test("botiquín: lo recoge el servidor y desaparece hasta reaparecer", async () => {
  const a = await join("Herido");
  const p = serverPlayer(a);
  const room = serverRoom(a);
  p.hp = 40;
  // Botiquín 4 en (0, 0, -27), +25 de vida
  Object.assign(p.move, { x: 0, y: 0, z: -27, vy: 0, onGround: true });
  await sleep(200);
  assert.equal(p.hp, 65);
  assert.ok(a.events.some((e) => e.type === "picked"));
  assert.ok(room.pickupRespawn.get(4) > 0, "debe quedar en espera de reaparición");
  await a.room.leave();
});

test("cadencia de disparo limitada aunque se mande FIRE en cada input", async () => {
  const a = await join("Metralla");
  const p = serverPlayer(a);
  Object.assign(p.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true });
  for (let i = 1; i <= 200; i++) a.room.send("input", { seq: i, keys: KEY.FIRE, yaw: 0, pitch: 0 });
  await sleep(1000);
  const used = WEAPON.magazine - p.ammo[0];
  const maxShots = Math.ceil((1.2 * 30) / WEAPON.fireIntervalTicks) + 1;
  assert.ok(used <= maxShots, `gastó ${used} balas en ~1 s (máximo ${maxShots})`);
  await a.room.leave().catch(() => {});
});

test("cambio de arma y pistola semiautomática: mantener el gatillo dispara solo una vez", async () => {
  const a = await join("Pistolero");
  const p = serverPlayer(a);
  Object.assign(p.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true });
  let seq = 1;
  a.room.send("input", { seq: seq++, keys: KEY.WEAPON2, yaw: 0, pitch: 0 });
  for (let i = 0; i < SWITCH_TICKS + 2; i++) {
    a.room.send("input", { seq: seq++, keys: 0, yaw: 0, pitch: 0 });
    await sleep(DT * 1000);
  }
  assert.equal(p.weapon, 1);
  // Gatillo mantenido 1 segundo: la pistola solo dispara una vez
  for (let i = 0; i < 30; i++) {
    a.room.send("input", { seq: seq++, keys: KEY.FIRE, yaw: 0, pitch: 0 });
    await sleep(DT * 1000);
  }
  await sleep(200);
  assert.equal(p.ammo[1], PISTOL.magazine - 1);
  assert.equal(p.ammo[0], WEAPON.magazine, "el rifle no se toca");
  assert.equal(a.last!.you.weapon, 1);
  await a.room.leave();
});

test("equipamiento: el servidor rechaza armas inventadas o en la ranura equivocada", async () => {
  const a = await join("Tramposo", undefined, { primary: "arma_inventada", secondary: "f32fe06215" });
  const p = serverPlayer(a);
  assert.equal(p.loadout[0], DEFAULT_PRIMARY, "arma desconocida -> la predeterminada");
  assert.equal(p.loadout[1], DEFAULT_SECONDARY, "un rifle no puede ir en la ranura de pistola");
  await a.room.leave();
});

test("escopeta: un disparo lanza varios perdigones y suma su daño", async () => {
  const a = await join("Escopetero", undefined, { primary: "6db0ad4764" }); // Remington 870
  const b = await join("Blanco2", a.room.roomId);
  const pa = serverPlayer(a), pb = serverPlayer(b);
  const sg = weaponStats("6db0ad4764");
  assert.equal(sg.pellets, 8);
  Object.assign(pa.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true });
  Object.assign(pb.move, { x: -27, y: 0, z: -9, vy: 0, onGround: true }); // a 3 m
  await sleep(500);
  a.room.send("input", { seq: 1, keys: KEY.FIRE, yaw: Math.PI, pitch: -0.05 });
  await sleep(300);
  const hit = a.events.find((e) => e.type === "hit");
  assert.ok(hit, "debe impactar");
  assert.ok(hit!.msg.damage > sg.damage, `a 3 m varios perdigones deben acertar (daño ${hit!.msg.damage})`);
  assert.equal(pa.ammo[0], sg.magazine - 1, "un disparo gasta un solo cartucho");
  await a.room.leave();
  await b.room.leave();
});
