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
  server.define("arena", ArenaRoom).filterBy(["map"]);
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
    : await client.create("arena", { name, map: "observatory", ...extra });
  const bot: Bot = { room, id: 0, last: null, events: [] };
  room.onMessage("welcome", (m) => (bot.id = m.id));
  room.onMessage("snap", (m) => (bot.last = m));
  room.onMessage("ping", (m) => room.send("pong", m));
  for (const t of ["hit", "kill", "shot", "damaged", "roster", "picked", "pickups", "proj", "boom", "swing"]) {
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

test("mapa fábrica: se aparece en sitio libre, se camina y los muros tapan la vista", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.create("arena", { name: "Explorador", map: "factory" });
  room.onMessage("*", () => {});
  let welcome: any = null;
  room.onMessage("welcome", (m) => (welcome = m));
  await sleep(300);
  assert.equal(welcome?.map, "factory");
  const r: any = matchMaker.getLocalRoomById(room.roomId);
  const p: any = r.players.get(room.sessionId);
  const { MAPS } = await import("../../shared/src/maps");
  const boxes = MAPS.factory.boxes;
  const inside = boxes.some((b: any) =>
    p.move.x + 0.4 > b.min[0] && p.move.x - 0.4 < b.max[0] && p.move.z + 0.4 > b.min[2] && p.move.z - 0.4 < b.max[2] &&
    p.move.y + 1.8 > b.min[1] && p.move.y < b.max[1]);
  assert.equal(inside, false, "no debe aparecer dentro de una pared");
  const start = { x: p.move.x, z: p.move.z };
  for (let i = 1; i <= 15; i++) { room.send("input", { seq: i, keys: KEY.FORWARD, yaw: p.yaw, pitch: 0 }); await sleep(DT * 1000); }
  await sleep(200);
  assert.ok(Math.hypot(p.move.x - start.x, p.move.z - start.z) > 1, "debe poder caminar desde el punto de aparición");
  await room.leave();
});

test("mapas: cada mapa tiene su propia partida", async () => {
  const c = new Client(`ws://localhost:${PORT}`);
  const f = await c.joinOrCreate("arena", { name: "EnFabrica", map: "factory" });
  const s2 = await c.joinOrCreate("arena", { name: "EnEstacion", map: "station" });
  f.onMessage("*", () => {}); s2.onMessage("*", () => {});
  assert.notEqual(f.roomId, s2.roomId, "la estación no debe compartir sala con la fábrica");
  const r: any = matchMaker.getLocalRoomById(s2.roomId);
  assert.equal(r.map.id, "station");
  await f.leave(); await s2.leave();
});

test("el daño baja con la distancia según el arma, y las de energía casi no lo pierden", async () => {
  const { damageFalloff, weaponStats, effectiveSpread } = await import("../../shared/src/weapons");
  const rifle = weaponStats("f32fe06215"), smg = weaponStats("2e9bf75870"), shotgun = weaponStats("6db0ad4764");
  const sniper = weaponStats("bf79b7f1d4"), energy = weaponStats("2d0d341097");
  assert.equal(damageFalloff(rifle, 10), 1);
  assert.ok(damageFalloff(smg, 40) < damageFalloff(rifle, 40), "el subfusil pierde daño antes que el rifle");
  assert.ok(damageFalloff(shotgun, 30) < 0.3, "la escopeta casi no hace daño de lejos");
  assert.equal(damageFalloff(sniper, 200), 1);
  assert.ok(energy.energy && damageFalloff(energy, 110) >= 0.9, "las armas de energía mantienen el daño");
  // Apuntar cierra la mira; correr y disparar en ráfaga la abren
  const still = { aiming: false, bloom: 0, speed: 0, onGround: true };
  assert.ok(effectiveSpread(rifle, { ...still, aiming: true }) < effectiveSpread(rifle, still));
  assert.ok(effectiveSpread(rifle, { ...still, speed: 8.8 }) > effectiveSpread(rifle, still));
  assert.ok(effectiveSpread(rifle, { ...still, bloom: 1 }) > effectiveSpread(rifle, still) * 2);
  assert.ok(effectiveSpread(sniper, still) > effectiveSpread(sniper, { ...still, aiming: true }) * 20, "sin mira el francotirador es impreciso");
});

test("movimiento: aceleración, correr y apuntar", async () => {
  const { stepMove } = await import("../../shared/src/physics");
  const { DT, KEY, MOVE_SPEED, SPRINT_SPEED } = await import("../../shared/src/constants");
  const run = (keys: number, ticks: number) => {
    const s = { x: 0, y: 0, z: 0, vy: 0, onGround: true, vx: 0, vz: 0 };
    for (let i = 0; i < ticks; i++) stepMove(s, keys, 0, DT, []);
    return s;
  };
  // El primer tick no alcanza la velocidad máxima (hay aceleración), pero enseguida sí
  assert.ok(Math.hypot(run(KEY.FORWARD, 1).vx!, run(KEY.FORWARD, 1).vz!) < MOVE_SPEED);
  assert.ok(Math.abs(Math.hypot(run(KEY.FORWARD, 15).vx!, run(KEY.FORWARD, 15).vz!) - MOVE_SPEED) < 0.01);
  assert.ok(Math.abs(Math.hypot(run(KEY.FORWARD | KEY.SPRINT, 15).vx!, run(KEY.FORWARD | KEY.SPRINT, 15).vz!) - SPRINT_SPEED) < 0.01);
  // No se corre hacia atrás, disparando ni apuntando
  assert.ok(Math.hypot(run(KEY.BACK | KEY.SPRINT, 15).vx!, run(KEY.BACK | KEY.SPRINT, 15).vz!) <= MOVE_SPEED + 0.01);
  assert.ok(Math.hypot(run(KEY.FORWARD | KEY.SPRINT | KEY.FIRE, 15).vx!, run(KEY.FORWARD | KEY.SPRINT | KEY.FIRE, 15).vz!) <= MOVE_SPEED + 0.01);
  assert.ok(Math.hypot(run(KEY.FORWARD | KEY.AIM, 15).vx!, run(KEY.FORWARD | KEY.AIM, 15).vz!) < MOVE_SPEED);
  // Al soltar las teclas se frena del todo en pocos ticks
  const s = run(KEY.FORWARD, 15);
  for (let i = 0; i < 6; i++) stepMove(s, 0, 0, DT, []);
  assert.equal(Math.hypot(s.vx!, s.vz!), 0);
});

test("contenedores abiertos: se entra por la hoja abierta y el fondo detiene las balas", async () => {
  const { MAPS } = await import("../../shared/src/maps");
  const { stepMove, rayMap } = await import("../../shared/src/physics");
  const { DT, KEY } = await import("../../shared/src/constants");
  const m = MAPS.factory;
  // contenedor a ras del suelo con la puerta hacia el pasillo (fila 0, giro 0: puerta en -z, mitad +x)
  const c = m.expansion!.pieces.find((p) => p.kind === "containerOpen" && p.y === 0 && p.rot === 0 && Math.abs(((p.z - p.d / 2) - -33)) < 0.01)!;
  assert.ok(c, "hay un contenedor abierto al pasillo");
  const s = { x: c.x + 0.6, y: 0, z: c.z - c.d / 2 - 2.5, vy: 0, onGround: true };
  for (let i = 0; i < 90; i++) stepMove(s, KEY.FORWARD, Math.PI, DT, m.boxes); // yaw PI = hacia +z
  assert.ok(Math.abs(s.x - c.x) < 1.1 && Math.abs(s.z - c.z) < c.d / 2 && s.y > 0.1, "el jugador quedó dentro");
  // desde dentro, un disparo hacia el fondo choca con la pared trasera
  const t = rayMap(s.x, s.y + 1.6, s.z, 0, 0, 1, 50, m.boxes);
  assert.ok(Math.abs((s.z + t) - (c.z + c.d / 2 - 0.14)) < 0.05);
});

test("arma blanca: ranura 3, golpea de cerca, no gasta munición y da más velocidad", async () => {
  const a = await join("Samurai", undefined, { melee: "778d3dfe4c" }); // katana (clase media)
  const b = await join("Blanco3", a.room.roomId);
  const pa = serverPlayer(a), pb = serverPlayer(b);
  const k = weaponStats("778d3dfe4c");
  assert.ok(k.meleeRange > 2 && k.speedK > 1);
  Object.assign(pa.move, { x: -27, y: 0, z: -12, vy: 0, onGround: true, vx: 0, vz: 0 });
  Object.assign(pb.move, { x: -27, y: 0, z: -10, vy: 0, onGround: true, vx: 0, vz: 0 }); // a 2 m
  await sleep(400);
  let seq = 0;
  a.room.send("input", { seq: ++seq, keys: KEY.WEAPON3, yaw: Math.PI, pitch: 0 });
  await sleep(600); // tiempo de cambio de arma
  assert.equal(a.last!.you.weapon, 2);
  assert.equal(a.last!.you.ammo, -1, "el arma blanca no tiene munición");
  a.room.send("input", { seq: ++seq, keys: KEY.FIRE, yaw: Math.PI, pitch: 0 });
  await sleep(300);
  const hit = a.events.find((e) => e.type === "hit");
  assert.ok(hit, "el golpe debe acertar a 2 m");
  assert.equal(hit!.msg.damage, k.damage);
  assert.equal(pb.hp, 100 - k.damage);
  // a 6 m no llega
  Object.assign(pb.move, { x: -27, y: 0, z: -6 });
  a.events.length = 0;
  await sleep(900);
  a.room.send("input", { seq: ++seq, keys: 0, yaw: Math.PI, pitch: 0 });
  await sleep(100);
  a.room.send("input", { seq: ++seq, keys: KEY.FIRE, yaw: Math.PI, pitch: 0 });
  await sleep(300);
  assert.ok(!a.events.find((e) => e.type === "hit"), "fuera de alcance no acierta");
  await a.room.leave();
  await b.room.leave();
});

test("cañón de cohetes: el proyectil viaja, explota y hace daño en área (también a su dueño)", async () => {
  const a = await join("Artillero", undefined, { primary: "bf7d92ee04" }); // bazuca
  const b = await join("Blanco4", a.room.roomId);
  const pa = serverPlayer(a), pb = serverPlayer(b);
  const rk = weaponStats("bf7d92ee04");
  assert.ok(rk.projectile && rk.projectile.radius > 3);
  Object.assign(pa.move, { x: -27, y: 0, z: -14, vy: 0, onGround: true, vx: 0, vz: 0 });
  Object.assign(pb.move, { x: -27.3, y: 0, z: -5, vy: 0, onGround: true, vx: 0, vz: 0 }); // a 9 m
  await sleep(400);
  // dispara al suelo delante del rival (cae ~1.5 m antes): yaw PI = hacia +z; un poco hacia abajo
  a.room.send("input", { seq: 1, keys: KEY.FIRE, yaw: Math.PI, pitch: -0.2 });
  await sleep(150);
  assert.ok(a.events.find((e) => e.type === "proj"), "todos reciben el aviso del proyectil");
  assert.equal(pb.hp, 100, "el cohete tarda en llegar: todavía no hay daño");
  await sleep(700);
  const boom = b.events.find((e) => e.type === "boom");
  assert.ok(boom, "debe explotar");
  assert.ok(pb.hp < 100 && pb.hp > 100 - rk.projectile!.splash, `daño en área parcial (vida ${pb.hp})`);
  assert.equal(pa.hp, 100, "a 7 m la explosión no alcanza al tirador");
  // disparo a los pies: el tirador se hace daño (la mitad)
  await sleep(1300);
  a.room.send("input", { seq: 2, keys: 0, yaw: Math.PI, pitch: -1.4 });
  await sleep(100);
  a.room.send("input", { seq: 3, keys: KEY.FIRE, yaw: Math.PI, pitch: -1.4 });
  await sleep(500);
  assert.ok(pa.hp < 100 && pa.hp >= 100 - Math.ceil(rk.projectile!.splash / 2), `el propio cohete hiere a su dueño (vida ${pa.hp})`);
  await a.room.leave();
  await b.room.leave();
});

test("aspecto: una sola skin y sin equipo; lo que pida el cliente no suma vida", async () => {
  const { validLook, GEAR, DEFAULT_SKIN } = await import("../../shared/src/gear");
  const helmet = GEAR.find((g) => g.slot === "helmet")!, vest = GEAR.find((g) => g.slot === "vest")!;
  assert.deepEqual(validLook({ skin: "no_existe", helmet: helmet.id, vest: vest.id, pack: "x" }), { skin: DEFAULT_SKIN, helmet: "", vest: "", pack: "" });
  const a = await join("Blindado", undefined, { skin: "e9aa211b67", helmet: helmet.id, vest: vest.id });
  assert.equal(serverPlayer(a).maxHp, 100);
  assert.equal(a.last!.you.hp, 100);
  await a.room.leave();
});

test("bots: aparecen al pedirlos, se mueven, disparan y se van cuando no queda nadie", async () => {
  const a = await join("Probador", undefined, { bots: 3 });
  const room = serverRoom(a);
  const bots = () => [...room.players.values()].filter((p: any) => p.bot);
  assert.equal(bots().length, 3, "tres bots en la sala");
  const roster = a.events.filter((e) => e.type === "roster").pop();
  assert.equal(roster?.msg.players.length, 4, "los bots salen en el marcador");
  // al probador lo dejamos quieto e inmortal para que la prueba no dependa de quién gana
  const me = serverPlayer(a);
  const start = bots().map((p: any) => ({ x: p.move.x, z: p.move.z }));
  for (let i = 0; i < 40; i++) { me.hp = me.maxHp; await sleep(100); }
  const moved = bots().filter((p: any, i: number) => Math.hypot(p.move.x - start[i].x, p.move.z - start[i].z) > 1).length;
  assert.ok(moved >= 2, `los bots caminan (se movieron ${moved})`);
  // con muchos bots, alguien termina disparando (su munición baja o hubo daño)
  const shots = bots().reduce((n: number, p: any) => n + (p.stats[0].magazine - p.ammo[0]) + p.kills + p.deaths, 0) + a.events.filter((e) => e.type === "damaged" || e.type === "shot").length;
  assert.ok(shots > 0, "los bots disparan");
  await a.room.leave();
  await sleep(150);
  assert.equal(bots().length, 0, "sin personas no quedan bots");
});
