import * as THREE from "three";
import "@fontsource/saira-condensed/500.css";
import "@fontsource/saira-condensed/700.css";
import "@fontsource/saira-condensed/800.css";
import { Client, type Room } from "colyseus.js";
import { DT, EYE_HEIGHT, KEY, MAX_HP, MAX_PITCH } from "../../shared/src/constants";
import {
  CATEGORY_NAMES, DEFAULT_PRIMARY, DEFAULT_SECONDARY, WEAPON_MODELS, validLoadout, weaponModel, weaponStats,
  type Category, type WeaponStats,
} from "../../shared/src/weapons";
import { aimDirection, rayMapHit, stepMove, type InputCmd, type MoveState } from "../../shared/src/physics";
import type {
  DamagedMsg, HitMsg, KillMsg, OtherSnapshot, PickedMsg, PickupsMsg, RosterEntry, RosterMsg,
  ShotMsg, SnapshotMsg, WelcomeMsg,
} from "../../shared/src/protocol";
import { World, loadQuality, type Quality } from "./world";
import { DEFAULT_MAP, mapById } from "../../shared/src/maps";
import { sfx } from "./audio";

// Dirección del servidor de juego. En producción se define con VITE_SERVER_URL.
const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;

const INTERP_DELAY_MS = 100; // igual que CLIENT_INTERP_MS en el servidor
const MOUSE_SENS = 0.0022;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("game");
const quality = loadQuality();
// Mapa: el de la URL (?map=...) o el predeterminado. Si el servidor usa otro, se recarga con ese.
const mapDef = mapById(new URLSearchParams(location.search).get("map") ?? DEFAULT_MAP);
const boxes = mapDef.boxes;
const world = new World(canvas, quality, mapDef);
const worldReady = world.load();

// ---------- Estado local ----------
let room: Room | null = null;
let myId = 0;
let yaw = 0, pitch = 0;
let lookDX = 0, lookDY = 0;
let seq = 0;
const keysDown = new Set<string>();
let mouseDown = false;
let pendingWeapon = -1; // tecla 1/2 pulsada: se envía en el siguiente tick aunque se suelte enseguida

/** Estado predicho: lo que creemos que dirá el servidor. */
const pred: MoveState = { x: 0, y: 0, z: 0, vy: 0, onGround: true };
const prevTickPos = new THREE.Vector3();
const currTickPos = new THREE.Vector3();
const correction = new THREE.Vector3(); // suaviza los ajustes del servidor
let pending: InputCmd[] = [];
let accumulator = 0;
let horizSpeed = 0;
let stepTimer = 0;
let wasOnGround = true;

// Equipamiento elegido en el menú (el servidor lo vuelve a validar)
let loadout: [string, string] = [DEFAULT_PRIMARY, DEFAULT_SECONDARY];
try { loadout = validLoadout(localStorage.getItem("arena.primary"), localStorage.getItem("arena.secondary")); } catch { /* sin storage */ }
let slotStats: [WeaponStats, WeaponStats] = [weaponStats(loadout[0]), weaponStats(loadout[1])];
let aiming = false;

let me = {
  alive: true, hp: MAX_HP, ammo: slotStats[0].magazine, weapon: 0, switching: false, reloading: false, respawnIn: 0, ping: 0,
};
let prevFireHeld = false;
let localFireCooldown = 0;
let snapshotsReceived = 0;

const roster = new Map<number, RosterEntry>();
let rosterInfo: RosterMsg | null = null;
let lastKiller: string | null = null;

/** Buffer de snapshots de los demás para interpolar. */
const remoteBuffer: { t: number; others: Map<number, OtherSnapshot> }[] = [];

// ---------- Menú y conexión ----------
const form = $<HTMLFormElement>("join-form");
const nameInput = $<HTMLInputElement>("name");
const qualitySel = $<HTMLSelectElement>("quality");
const joinBtn = $<HTMLButtonElement>("join-btn");
const menuError = $("menu-error");
try { nameInput.value = localStorage.getItem("arena.name") ?? ""; } catch { /* sin storage */ }
qualitySel.value = quality;
$("map-name").textContent = `${mapDef.name} · noche`;
qualitySel.addEventListener("change", () => {
  try { localStorage.setItem("arena.quality", qualitySel.value as Quality); } catch { /* sin storage */ }
  location.reload();
});

// Selectores de armas agrupados por tipo
const primarySel = $<HTMLSelectElement>("primary");
const secondarySel = $<HTMLSelectElement>("secondary");
const order: Category[] = ["rifle", "smg", "shotgun", "sniper"];
for (const cat of order) {
  for (const fut of [false, true]) {
    const list = WEAPON_MODELS.filter((w) => w.category === cat && w.futuristic === fut);
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = `${CATEGORY_NAMES[cat]}${fut ? " · futurista" : ""}`;
    for (const w of list) g.append(new Option(w.name, w.id));
    primarySel.append(g);
  }
}
for (const w of WEAPON_MODELS.filter((x) => x.category === "pistol")) {
  secondarySel.append(new Option(`${w.name}${w.futuristic ? " (futurista)" : ""}`, w.id));
}
primarySel.value = loadout[0];
secondarySel.value = loadout[1];
function describe(id: string): string {
  const m = weaponModel(id);
  if (!m) return "";
  const st = weaponStats(id);
  const rate = Math.round(30 / st.fireIntervalTicks * 10) / 10;
  const dmg = st.pellets > 1 ? `${st.pellets}×${st.damage}` : `${st.damage}`;
  return `${CATEGORY_NAMES[m.category]} · daño ${dmg} · ${rate} disp/s · cargador ${st.magazine}${st.zoomFov ? " · mira" : ""}${m.author ? ` · modelo de ${m.author}` : ""}`;
}
function updateLoadoutInfo() {
  $("primary-info").textContent = describe(primarySel.value);
  $("secondary-info").textContent = describe(secondarySel.value);
}
primarySel.addEventListener("change", updateLoadoutInfo);
secondarySel.addEventListener("change", updateLoadoutInfo);
updateLoadoutInfo();

joinBtn.disabled = true;
joinBtn.textContent = "Cargando…";
worldReady.then(() => {
  joinBtn.disabled = false;
  joinBtn.textContent = "Jugar";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim() || "Jugador";
  loadout = validLoadout(primarySel.value, secondarySel.value);
  slotStats = [weaponStats(loadout[0]), weaponStats(loadout[1])];
  try {
    localStorage.setItem("arena.name", name);
    localStorage.setItem("arena.primary", loadout[0]);
    localStorage.setItem("arena.secondary", loadout[1]);
  } catch { /* sin storage */ }
  joinBtn.disabled = true;
  menuError.textContent = "";
  sfx.unlock();
  try {
    await worldReady;
    joinBtn.textContent = "Preparando armas…";
    await world.equip(loadout);
    joinBtn.textContent = "Jugar";
    await connect(name);
    $("menu").classList.add("hidden");
    $("hud").classList.remove("hidden");
    requestLock();
  } catch (err) {
    console.error(err);
    menuError.textContent = "No se pudo conectar al servidor. ¿Está encendido?";
  } finally {
    joinBtn.disabled = false;
  }
});

async function connect(name: string) {
  const client = new Client(SERVER_URL);
  room = await client.joinOrCreate("arena", { name, primary: loadout[0], secondary: loadout[1], map: mapDef.id });

  room.onMessage("welcome", (m: WelcomeMsg) => {
    myId = m.id;
    if (m.map && m.map !== mapDef.id) {
      // La sala usa otro mapa: recargamos con ese
      const url = new URL(location.href);
      url.searchParams.set("map", m.map);
      location.href = url.toString();
    }
  });
  room.onMessage("ping", (m) => room?.send("pong", m));
  room.onMessage("snap", onSnapshot);
  room.onMessage("roster", onRoster);
  room.onMessage("shot", onRemoteShot);
  room.onMessage("kill", onKill);
  room.onMessage("hit", onHit);
  room.onMessage("damaged", onDamaged);
  room.onMessage("pickups", (m: PickupsMsg) => world.setPickups(m.active));
  room.onMessage("picked", (m: PickedMsg) => {
    sfx.pickup();
    toast(`+${m.amount} VIDA`);
  });
  room.onLeave((code) => {
    room = null;
    document.exitPointerLock?.();
    $("hud").classList.add("hidden");
    $("menu").classList.remove("hidden");
    menuError.textContent = code === 4001
      ? "Has sido expulsado por comportamiento sospechoso."
      : "Se perdió la conexión con el servidor.";
  });
}

// ---------- Mensajes del servidor ----------
function onSnapshot(s: SnapshotMsg) {
  snapshotsReceived++;
  const y = s.you;
  const wasAlive = me.alive;
  me = {
    alive: y.alive, hp: y.hp, ammo: y.ammo, weapon: y.weapon, switching: y.switching,
    reloading: y.reloading, respawnIn: y.respawnIn, ping: y.ping,
  };
  world.weapon.setWeapon(y.weapon);

  // Reconciliación: partimos del estado oficial y repetimos los inputs que el
  // servidor aún no ha procesado. Si alguien hace trampa en su navegador,
  // aquí es donde el servidor lo "devuelve" a la posición real.
  const before = new THREE.Vector3(pred.x, pred.y, pred.z);
  Object.assign(pred, { x: y.x, y: y.y, z: y.z, vy: y.vy, onGround: y.g });
  pending = pending.filter((c) => c.seq > y.seq);
  if (y.alive) {
    for (const c of pending) stepMove(pred, c.keys, c.yaw, DT, boxes);
  } else {
    pending = [];
  }
  const after = new THREE.Vector3(pred.x, pred.y, pred.z);
  const err = before.sub(after);
  if (!wasAlive || !y.alive || err.length() > 3) {
    correction.set(0, 0, 0);
    prevTickPos.copy(after);
    currTickPos.copy(after);
  } else {
    // El ajuste se reparte en varios frames (la corrección se desvanece) para que no se note.
    correction.add(err);
    prevTickPos.sub(err);
    currTickPos.copy(after);
  }
  if ((!wasAlive || snapshotsReceived === 1) && y.alive) {
    yaw = y.yaw;
    pitch = 0;
    lastKiller = null;
  }

  remoteBuffer.push({ t: performance.now(), others: new Map(s.others.map((o) => [o[0], o])) });
  while (remoteBuffer.length > 30) remoteBuffer.shift();
}

function onRoster(r: RosterMsg) {
  rosterInfo = r;
  roster.clear();
  for (const p of r.players) roster.set(p.id, p);
  for (const id of world.avatarIds()) if (!roster.has(id)) world.removeAvatar(id);
  renderScoreboard();
}

function onRemoteShot(s: ShotMsg) {
  const from = new THREE.Vector3(...s.from), to = new THREE.Vector3(...s.to);
  const dir = to.clone().sub(from);
  const dist = dir.length();
  dir.normalize();
  const hit = rayMapHit(from.x, from.y, from.z, dir.x, dir.y, dir.z, dist + 0.05, boxes);
  const hitWall = hit.t < dist + 0.04 && hit.t > dist - 0.1;
  world.remoteShot(from, to, hitWall ? new THREE.Vector3(...hit.normal) : null, hitWall ? hit.kind : null);
  const d = Math.hypot(s.from[0] - pred.x, s.from[2] - pred.z);
  sfx.remoteShot(Math.max(0.12, 1 - d / 60));
}

function onKill(k: KillMsg) {
  const killer = roster.get(k.killer)?.name ?? "?";
  const victim = roster.get(k.victim)?.name ?? "?";
  if (k.victim === myId) lastKiller = killer;
  world.getAvatar(k.victim)?.die();
  const el = document.createElement("div");
  el.className = "kill-entry";
  const span = (txt: string, mine: boolean) => {
    const s = document.createElement("span");
    s.textContent = txt;
    if (mine) s.className = "me";
    return s;
  };
  el.append(span(killer, k.killer === myId));
  const mid = document.createElement("span");
  mid.className = "weapon-icon" + (k.headshot ? " hs" : "");
  mid.textContent = k.headshot ? "⌖" : "▸";
  el.append(mid, span(victim, k.victim === myId));
  const feed = $("killfeed");
  feed.prepend(el);
  while (feed.children.length > 5) feed.lastChild?.remove();
  setTimeout(() => el.remove(), 6000);
}

function onHit(h: HitMsg) {
  const hm = $("hitmarker");
  hm.classList.toggle("head", h.headshot);
  flash("hitmarker", 110);
  if (h.kill) sfx.kill();
  else sfx.hit(h.headshot);
}

function onDamaged(m: DamagedMsg) {
  flash("damage-flash", 280);
  sfx.hurt();
  // Indicador de dirección: ángulo del atacante relativo a hacia dónde miro.
  // fromAngle = atan2(dx, dz); mi frente es (-sin(yaw), -cos(yaw)) => atan2 = yaw + PI
  const rel = m.fromAngle - (yaw + Math.PI);
  const ind = document.createElement("div");
  ind.className = "dmg-dir";
  ind.style.transform = `rotate(${-rel}rad)`;
  $("hud").append(ind);
  setTimeout(() => ind.remove(), 900);
}

function flash(id: string, ms: number) {
  const el = $(id);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), ms);
}

function toast(text: string) {
  const t = $("toast");
  t.textContent = text;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
}

// ---------- Entrada (teclado y ratón) ----------
function requestLock() {
  canvas.requestPointerLock?.()?.catch?.(() => {});
}
canvas.addEventListener("click", () => {
  if (room && document.pointerLockElement !== canvas) requestLock();
});
document.addEventListener("pointerlockchange", () => {
  $("click-to-play").classList.toggle("hidden", !room || document.pointerLockElement === canvas);
  if (document.pointerLockElement !== canvas) mouseDown = false;
});
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
  pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
  lookDX += e.movementX;
  lookDY += e.movementY;
});
document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && document.pointerLockElement === canvas) mouseDown = true;
  if (e.button === 2 && document.pointerLockElement === canvas) aiming = true;
});
document.addEventListener("contextmenu", (e) => { if (room) e.preventDefault(); });
document.addEventListener("mouseup", (e) => {
  if (e.button === 2) aiming = false;
  if (e.button === 0) mouseDown = false;
});
window.addEventListener("keydown", (e) => {
  if (!room) return;
  if (e.code === "Tab") {
    e.preventDefault();
    $("scoreboard").classList.remove("hidden");
  }
  if (e.code === "Digit1" || e.code === "Numpad1") pendingWeapon = 0;
  if (e.code === "Digit2" || e.code === "Numpad2") pendingWeapon = 1;
  keysDown.add(e.code);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Tab") $("scoreboard").classList.add("hidden");
  keysDown.delete(e.code);
});
window.addEventListener("blur", () => {
  keysDown.clear();
  mouseDown = false;
});

function currentKeys(): number {
  const k = (c: string) => keysDown.has(c);
  let keys = 0;
  if (k("KeyW") || k("ArrowUp")) keys |= KEY.FORWARD;
  if (k("KeyS") || k("ArrowDown")) keys |= KEY.BACK;
  if (k("KeyA") || k("ArrowLeft")) keys |= KEY.LEFT;
  if (k("KeyD") || k("ArrowRight")) keys |= KEY.RIGHT;
  if (k("Space")) keys |= KEY.JUMP;
  if (k("KeyR")) keys |= KEY.RELOAD;
  if (mouseDown) keys |= KEY.FIRE;
  if (k("Digit1") || k("Numpad1") || pendingWeapon === 0) keys |= KEY.WEAPON1;
  else if (k("Digit2") || k("Numpad2") || pendingWeapon === 1) keys |= KEY.WEAPON2;
  pendingWeapon = -1;
  return keys;
}

// ---------- Tick fijo: predicción + envío de inputs ----------
function fixedTick() {
  if (!room || snapshotsReceived === 0) return;
  const keys = currentKeys();
  const cmd: InputCmd = { seq: ++seq, keys, yaw, pitch };
  room.send("input", cmd);

  prevTickPos.copy(currTickPos);
  if (me.alive) {
    pending.push(cmd);
    const bx = pred.x, bz = pred.z;
    stepMove(pred, keys, yaw, DT, boxes);
    horizSpeed = Math.hypot(pred.x - bx, pred.z - bz) / DT;
    predictLocalFire(keys);
    footsteps(keys);
  } else {
    horizSpeed = 0;
  }
  currTickPos.set(pred.x, pred.y, pred.z);
}

function footsteps(keys: number) {
  if (pred.onGround && !wasOnGround) sfx.land();
  if ((keys & KEY.JUMP) && wasOnGround && !pred.onGround) sfx.jump();
  wasOnGround = pred.onGround;
  if (pred.onGround && horizSpeed > 1) {
    stepTimer -= DT;
    if (stepTimer <= 0) {
      sfx.step(pred.y < 0.05);
      stepTimer = 0.36;
    }
  } else {
    stepTimer = 0.1;
  }
}

/** Efecto visual inmediato del disparo propio. El daño real lo decide el servidor. */
function predictLocalFire(keys: number) {
  // Cambio de arma inmediato en pantalla (el servidor lo confirma en el siguiente snapshot)
  const want = (keys & KEY.WEAPON1) ? 0 : (keys & KEY.WEAPON2) ? 1 : me.weapon;
  if (want !== me.weapon) {
    me.weapon = want;
    me.switching = true;
    world.weapon.setWeapon(want);
    sfx.switchWeapon();
    localFireCooldown = 12;
  }
  const w = slotStats[me.weapon];
  if (localFireCooldown > 0) localFireCooldown--;
  const held = (keys & KEY.FIRE) !== 0;
  const trigger = w.semiAuto ? held && !prevFireHeld : held;
  prevFireHeld = held;
  if ((keys & KEY.RELOAD) && me.ammo < w.magazine && !me.reloading) sfx.reload();
  if (!trigger || localFireCooldown > 0 || me.reloading || me.switching || me.ammo <= 0) return;
  localFireCooldown = w.fireIntervalTicks;
  const ox = pred.x, oy = pred.y + EYE_HEIGHT, oz = pred.z;
  // Los perdigones y la dispersión de aquí son solo visuales: el servidor tira los suyos
  const hits = [];
  for (let k = 0; k < w.pellets; k++) {
    const jy = (Math.random() * 2 - 1) * w.spread, jp = (Math.random() * 2 - 1) * w.spread;
    const [dx, dy, dz] = aimDirection(yaw + jy, pitch + jp);
    const hit = rayMapHit(ox, oy, oz, dx, dy, dz, w.range, boxes);
    const isWall = hit.t < w.range - 0.01;
    hits.push({ point: new THREE.Vector3(ox + dx * hit.t, oy + dy * hit.t, oz + dz * hit.t), normal: new THREE.Vector3(...hit.normal), kind: isWall ? hit.kind : null });
  }
  world.localShot(hits, pred.y);
  const cat = weaponModel(loadout[me.weapon])?.category;
  if (cat === "pistol") sfx.pistol();
  else if (cat === "shotgun") sfx.shotgun();
  else if (cat === "sniper") sfx.sniper();
  else sfx.shoot();
  if (cat === "sniper" || cat === "shotgun") aiming = aiming && cat === "sniper";
}

// ---------- Render ----------
let lastRemoteFrame = performance.now();
function updateRemotes(now: number) {
  const dt = (now - lastRemoteFrame) / 1000;
  lastRemoteFrame = now;
  const renderT = now - INTERP_DELAY_MS;
  let a = remoteBuffer[0], b = remoteBuffer[remoteBuffer.length - 1];
  for (let i = remoteBuffer.length - 1; i > 0; i--) {
    if (remoteBuffer[i - 1].t <= renderT) {
      a = remoteBuffer[i - 1];
      b = remoteBuffer[i];
      break;
    }
  }
  if (!a || !b) return;
  const span = b.t - a.t;
  const alpha = span > 0 ? Math.min(1, Math.max(0, (renderT - a.t) / span)) : 1;

  const seen = new Set<number>();
  for (const [id, sb] of b.others) {
    const sa = a.others.get(id) ?? sb;
    const name = roster.get(id)?.name ?? "?";
    const av = world.upsertAvatar(id, name);
    if (av.dyingUntil) av.revive();
    av.group.visible = true;
    av.setPose(lerp(sa[1], sb[1], alpha), lerp(sa[2], sb[2], alpha), lerp(sa[3], sb[3], alpha), lerpAngle(sa[4], sb[4], alpha), dt);
    av.setHp(sb[6]);
    const lo = roster.get(id)?.loadout;
    if (lo) void world.setAvatarWeapon(id, lo[sb[7] ?? 0] ?? lo[0]);
    seen.add(id);
  }
  // Los que no están en el último snapshot (muertos o fuera de la vista) se ocultan,
  // salvo durante la animación de muerte.
  for (const id of world.avatarIds()) {
    if (seen.has(id)) continue;
    const av = world.getAvatar(id)!;
    if (av.dyingUntil && now < av.dyingUntil) continue;
    av.group.visible = false;
  }
}

function updateHud() {
  $("hp-value").textContent = String(me.hp);
  const fill = $("hp-fill");
  fill.style.width = `${(me.hp / MAX_HP) * 100}%`;
  fill.classList.toggle("low", me.hp <= 30);
  const w = slotStats[me.weapon];
  $("ammo").textContent = String(me.ammo);
  $("ammo-max").textContent = `/ ${w.magazine}`;
  $("weapon-name").textContent = (weaponModel(loadout[me.weapon])?.name ?? "").toUpperCase();
  const zoom = aiming && me.alive && !me.reloading && me.weapon === 0 ? w.zoomFov : 0;
  world.setZoom(zoom);
  $("scope").classList.toggle("hidden", !(zoom > 0));
  $("slot-1").classList.toggle("active", me.weapon === 0);
  $("slot-2").classList.toggle("active", me.weapon === 1);
  $("reload").classList.toggle("hidden", !me.reloading);
  $("ping").textContent = `${me.ping} ms`;

  const mine = roster.get(myId);
  const others = [...roster.values()].filter((p) => p.id !== myId).sort((x, y) => y.kills - x.kills);
  const lead = others[0];
  const limit = rosterInfo?.fragLimit ?? 20;
  $("score-me").textContent = String(mine?.kills ?? 0);
  $("score-lead").textContent = String(lead?.kills ?? 0);
  $("score-lead-name").textContent = lead ? lead.name : "—";
  const best = Math.max(mine?.kills ?? 0, lead?.kills ?? 0);
  $("score-left").textContent = `Faltan ${Math.max(0, limit - best)} bajas`;

  const death = $("death");
  if (rosterInfo?.winner) {
    death.classList.remove("hidden");
    $("death-title").textContent = `${rosterInfo.winner} gana la ronda`;
    $("death-sub").textContent = "La siguiente ronda empieza en unos segundos";
    $("scoreboard").classList.remove("hidden");
  } else if (!me.alive) {
    death.classList.remove("hidden");
    $("death-title").textContent = "Eliminado";
    $("death-sub").textContent =
      `${lastKiller ? `Te eliminó ${lastKiller}. ` : ""}Reapareces en ${Math.ceil(me.respawnIn / 1000)} s`;
  } else {
    death.classList.add("hidden");
    if (!keysDown.has("Tab")) $("scoreboard").classList.add("hidden");
  }
}

function renderScoreboard() {
  const body = $("scoreboard-body");
  body.replaceChildren();
  const players = [...roster.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const p of players) {
    const tr = document.createElement("tr");
    if (p.id === myId) tr.classList.add("me");
    if (!p.alive) tr.classList.add("dead");
    for (const v of [p.name, String(p.kills), String(p.deaths)]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    body.append(tr);
  }
  $("scoreboard-title").textContent = `Marcador · primero a ${rosterInfo?.fragLimit ?? "?"} bajas`;
}

let lastFrame = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  accumulator += dt;
  while (accumulator >= DT) {
    fixedTick();
    accumulator -= DT;
  }

  correction.multiplyScalar(Math.pow(0.001, dt));
  const alpha = accumulator / DT;
  if (room) {
    const view = prevTickPos.clone().lerp(currTickPos, alpha).add(correction);
    world.setView(view.x, view.y, view.z, yaw, pitch);
  } else {
    // Vista del menú: la cámara gira lentamente alrededor del mapa, por encima de los tejados.
    const a = now / 20000;
    const b = mapDef.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rad = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * (mapDef.model ? 0.55 : 0.37);
    const h = mapDef.model ? 18 : 4.5;
    world.setView(cx + Math.sin(a) * rad, h, cz + Math.cos(a) * rad, a, mapDef.model ? -0.38 : -0.12);
  }

  updateRemotes(now);
  if (room) updateHud();
  world.render(dt, {
    speed: horizSpeed, onGround: pred.onGround, lookDX, lookDY,
    reloading: me.reloading, alive: !!room && me.alive,
    aiming: aiming && me.weapon === 0 && slotStats[0].zoomFov > 0 && !me.reloading,
  });
  lookDX = lookDY = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Solo en desarrollo: utilidades para depurar desde la consola del navegador.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      get pred() { return pred; }, get me() { return me; }, get myId() { return myId; },
      get yaw() { return yaw; }, get pending() { return pending.length; }, get seq() { return seq; },
      look(y: number, p: number) { yaw = y; pitch = p; },
      get others() { return remoteBuffer.length ? [...remoteBuffer[remoteBuffer.length - 1].others.values()] : []; },
      fire(on: boolean) { mouseDown = on; },
      aim(on: boolean) { aiming = on; },
    },
  });
}
