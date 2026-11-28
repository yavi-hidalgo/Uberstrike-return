import * as THREE from "three";
import "@fontsource/saira-condensed/500.css";
import "@fontsource/saira-condensed/700.css";
import "@fontsource/saira-condensed/800.css";
import { Client, type Room } from "colyseus.js";
import { DT, EYE_HEIGHT, KEY, MAX_HP, MAX_PITCH, SPRINT_SPEED } from "../../shared/src/constants";
import {
  BLOOM_RECOVERY, CATEGORY_NAMES, DEFAULT_MELEE, DEFAULT_PRIMARY, DEFAULT_SECONDARY, WEAPON_MODELS, effectiveSpread, validLoadout, weaponModel, weaponStats,
  type Category, type Loadout, type WeaponStats,
} from "../../shared/src/weapons";
import { aimDirection, rayMap, rayMapHit, stepMove, type InputCmd, type MoveState } from "../../shared/src/physics";
import type {
  BoomMsg, DamagedMsg, HitMsg, KillMsg, OtherSnapshot, PickedMsg, PickupsMsg, ProjMsg, RosterEntry, RosterMsg,
  ShotMsg, SnapshotMsg, SwingMsg, WelcomeMsg,
} from "../../shared/src/protocol";
import { World, loadQuality, type Quality } from "./world";
import { DEFAULT_MAP, MAPS, PLAYABLE_MAPS, mapById } from "../../shared/src/maps";
import { sfx } from "./audio";
import { weaponFx } from "./fx";
import { validLook, type Look } from "../../shared/src/gear";
import { createMenu, loadState, type Settings } from "./menu";
import { music } from "./music";
import { Reticles } from "./reticles";

// Dirección del servidor de juego. En producción se define con VITE_SERVER_URL; si no, se usa la
// misma dirección de la página bajo /colyseus (Vite la reenvía al servidor del puerto 2567).
const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/colyseus`;

const INTERP_DELAY_MS = 100; // igual que CLIENT_INTERP_MS en el servidor
const MOUSE_SENS = 0.0022;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** Miras (cruz, holográfica y telescópica) y dirección reutilizada para medir la distancia al apuntar. */
const reticles = new Reticles($("crosshair"), $("ads-reticle"), $("scope"));
const scopeDir = new THREE.Vector3();
const canvas = $<HTMLCanvasElement>("game");
const quality = loadQuality();
// Mapa: el de la URL (?map=...) o el predeterminado. Si el servidor usa otro, se recarga con ese.
let savedMap: string | null = null;
try { savedMap = localStorage.getItem("arena.map"); } catch { /* sin storage */ }
const mapDef = mapById(new URLSearchParams(location.search).get("map") ?? savedMap ?? DEFAULT_MAP);
const boxes = mapDef.boxes;
const world = new World(canvas, quality, mapDef);
const worldReady = world.load();
// Grabaciones de los disparos y eco del mapa (el audio en sí arranca con el primer clic)
void sfx.preload(import.meta.env.BASE_URL);
sfx.setEnvironment(mapDef.id);

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
const pred: MoveState = { x: 0, y: 0, z: 0, vy: 0, onGround: true, vx: 0, vz: 0 };
const prevTickPos = new THREE.Vector3();
const currTickPos = new THREE.Vector3();
const correction = new THREE.Vector3(); // suaviza los ajustes del servidor
let pending: (InputCmd & { k: number })[] = [];
let accumulator = 0;
let horizSpeed = 0;
let sprinting = false;
let stepTimer = 0;
let wasOnGround = true;

// Equipamiento elegido en el menú (el servidor lo vuelve a validar)
let loadout: Loadout = [DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_MELEE];
let look: Look = validLook(undefined);
try {
  loadout = validLoadout(localStorage.getItem("arena.primary"), localStorage.getItem("arena.secondary"), localStorage.getItem("arena.melee"));
  look = validLook({ skin: localStorage.getItem("arena.skin"), helmet: localStorage.getItem("arena.helmet"), vest: localStorage.getItem("arena.vest"), pack: localStorage.getItem("arena.pack") });
} catch { /* sin storage */ }
let slotStats: WeaponStats[] = loadout.map((id) => weaponStats(id));
let aiming = false;
// Retroceso real: cada disparo sube (y desvía un poco) la mira; se recupera sola al dejar de disparar
let recoilPitch = 0, recoilYaw = 0;
/** Apertura de la mira por disparos seguidos (0..1); el servidor lleva su propia cuenta. */
let bloom = 0;
// Cámara: balanceo al caminar, hundimiento al aterrizar, inclinación al moverse de lado y sacudida
let bobPhase = 0, landDip = 0, strafeRoll = 0, shake = 0, lastVy = 0;
const aimYaw = () => yaw + recoilYaw;
const aimPitch = () => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch + recoilPitch));

let me = {
  alive: true, hp: MAX_HP, maxHp: MAX_HP, ammo: slotStats[0].magazine, weapon: 0, switching: false, reloading: false, respawnIn: 0, ping: 0,
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
const menuState = loadState();
loadout = menuState.loadout;
look = menuState.look;
slotStats = loadout.map((id) => weaponStats(id));
let mouseSens = MOUSE_SENS * menuState.settings.sens;
function applySettings(st: Settings) {
  mouseSens = MOUSE_SENS * st.sens;
  sfx.setVolume(st.volume);
  music.setVolume(st.music);
}
applySettings(menuState.settings);
/** Salida pedida por el jugador (no es un error de conexión). */
let leaving = false;

const menu = createMenu($("menu"), {
  mapId: mapDef.id,
  quality,
  state: menuState,
  onMap(id) {
    try { localStorage.setItem("arena.map", id); } catch { /* sin storage */ }
    const url = new URL(location.href);
    url.searchParams.set("map", id);
    location.href = url.toString();
  },
  onQuality(q) {
    try { localStorage.setItem("arena.quality", q as Quality); } catch { /* sin storage */ }
    location.reload();
  },
  onSettings: applySettings,
  async onPlay(st) {
    loadout = validLoadout(st.loadout[0], st.loadout[1], st.loadout[2]);
    look = { ...st.look };
    slotStats = loadout.map((id) => weaponStats(id));
    sfx.unlock();
    await worldReady;
    menu.setBusy("Preparando armas…");
    await world.equip(loadout);
    menu.setBusy("Conectando…");
    await connect(st.name.trim() || "Jugador");
    menu.hide();
    music.setMode("game");
    $("hud").classList.remove("hidden");
    requestLock();
  },
});
menu.setBusy("Cargando…");
menu.show();
music.setMode("menu");
void worldReady.then(() => menu.setBusy(null));

// ---------- Pausa (Esc) ----------
const pause = $("pause");
function bindRange(id: string, key: keyof Settings, fmt: (v: number) => string) {
  const input = $<HTMLInputElement>(id), out = $(`${id}-out`);
  const sync = () => { input.value = String(menuState.settings[key]); out.textContent = fmt(menuState.settings[key]); };
  input.addEventListener("input", () => {
    menuState.settings[key] = parseFloat(input.value);
    out.textContent = fmt(menuState.settings[key]);
    try { localStorage.setItem(`arena.${key}`, input.value); } catch { /* sin storage */ }
    applySettings(menuState.settings);
  });
  return sync;
}
const pct = (v: number) => `${Math.round(v * 100)} %`;
const syncPause = [bindRange("pause-sens", "sens", (v) => `${v.toFixed(2)}×`), bindRange("pause-volume", "volume", pct), bindRange("pause-music", "music", pct)];
function showPause(on: boolean) {
  if (on) syncPause.forEach((f) => f());
  pause.classList.toggle("hidden", !on);
}
$("pause-resume").addEventListener("click", () => { showPause(false); requestLock(); });
$("pause-exit").addEventListener("click", () => {
  leaving = true;
  showPause(false);
  void room?.leave();
});

async function connect(name: string) {
  const client = new Client(SERVER_URL);
  room = await client.joinOrCreate("arena", { name, primary: loadout[0], secondary: loadout[1], melee: loadout[2], ...look, map: mapDef.id, bots: menuState.settings.bots });

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
  room.onMessage("proj", onProjectile);
  room.onMessage("boom", onBoom);
  room.onMessage("swing", (m: SwingMsg) => {
    const o = remoteBuffer.length ? remoteBuffer[remoteBuffer.length - 1].others.get(m.id) : undefined;
    const where = o ? soundAt(o[1], o[3]) : { distance: 20, pan: 0 };
    const mel = meleeOf(roster.get(m.id)?.loadout?.[2]);
    if (where.distance < 25) { if (m.hit) sfx.meleeImpact(mel.kind, mel.heft, where); else sfx.meleeSwing(mel.kind, mel.heft, where); }
  });
  room.onMessage("kill", onKill);
  room.onMessage("hit", onHit);
  room.onMessage("damaged", onDamaged);
  room.onMessage("pickups", (m: PickupsMsg) => world.setPickups(m.active));
  room.onMessage("picked", (m: PickedMsg) => {
    sfx.pickup();
    toast(`+${m.amount} VIDA`);
  });
  room.onLeave((code) => {
    if (!leaving) console.warn(`[red] conexión cerrada (código ${code})`);
    room = null;
    snapshotsReceived = 0;
    pending = [];
    remoteBuffer.length = 0;
    for (const id of world.avatarIds()) world.removeAvatar(id);
    document.exitPointerLock?.();
    showPause(false);
    $("hud").classList.add("hidden");
    menu.show();
    music.setMode("menu");
    menu.setError(leaving ? "" : code === 4001
      ? "Has sido expulsado por comportamiento sospechoso."
      : "Se perdió la conexión con el servidor.");
    leaving = false;
  });
}

// ---------- Mensajes del servidor ----------
function onSnapshot(s: SnapshotMsg) {
  snapshotsReceived++;
  const y = s.you;
  const wasAlive = me.alive;
  me = {
    alive: y.alive, hp: y.hp, maxHp: y.maxHp ?? MAX_HP, ammo: y.ammo, weapon: y.weapon, switching: y.switching,
    reloading: y.reloading, respawnIn: y.respawnIn, ping: y.ping,
  };
  world.weapon.setWeapon(y.weapon);

  // Reconciliación: partimos del estado oficial y repetimos los inputs que el
  // servidor aún no ha procesado. Si alguien hace trampa en su navegador,
  // aquí es donde el servidor lo "devuelve" a la posición real.
  const before = new THREE.Vector3(pred.x, pred.y, pred.z);
  Object.assign(pred, { x: y.x, y: y.y, z: y.z, vy: y.vy, onGround: y.g, vx: y.vx ?? 0, vz: y.vz ?? 0 });
  pending = pending.filter((c) => c.seq > y.seq);
  if (y.alive) {
    for (const c of pending) stepMove(pred, c.keys, c.yaw, DT, boxes, c.k);
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
    recoilPitch = recoilYaw = bloom = 0;
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

/** Material y peso de un arma blanca (para su sonido). */
function meleeOf(id: string | undefined) {
  const m = weaponModel(id ?? "");
  return { kind: m?.meleeKind ?? "blade", heft: m?.melee === "heavy" ? 1.18 : m?.melee === "light" ? 0.88 : 1 };
}

/** Distancia y dirección (izquierda/derecha) de un sonido respecto a donde miro. */
function soundAt(x: number, z: number) {
  const dx = x - pred.x, dz = z - pred.z;
  const distance = Math.hypot(dx, dz);
  // derecha de la mirada = (cos yaw, -sin yaw) en el plano XZ
  const pan = distance > 0.5 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance : 0;
  return { distance, pan };
}

function onRemoteShot(s: ShotMsg) {
  const from = new THREE.Vector3(...s.from), to = new THREE.Vector3(...s.to);
  const dir = to.clone().sub(from);
  const dist = dir.length();
  dir.normalize();
  const hit = rayMapHit(from.x, from.y, from.z, dir.x, dir.y, dir.z, dist + 0.05, boxes);
  const hitWall = hit.t < dist + 0.04 && hit.t > dist - 0.1;
  const fx = weaponFx(roster.get(s.id)?.loadout?.[s.slot ?? 0] ?? DEFAULT_PRIMARY);
  world.remoteShot(from, to, hitWall ? new THREE.Vector3(...hit.normal) : null, hitWall ? hit.kind : null, fx);
  world.getAvatar(s.id)?.aimPulse();
  const d = Math.hypot(s.from[0] - pred.x, s.from[2] - pred.z);
  // Varios perdigones llegan en el mismo instante: el sonido se oye una sola vez
  const now = performance.now();
  if (lastShotSound.get(s.id) !== undefined && now - lastShotSound.get(s.id)! < 25) return;
  lastShotSound.set(s.id, now);
  sfx.weapon(fx, soundAt(s.from[0], s.from[2]));
  music.bump(d < 40 ? 0.12 : 0.04);
  // Silbido si la bala pasa cerca de la cabeza
  const eye = new THREE.Vector3(pred.x, pred.y + EYE_HEIGHT, pred.z);
  const along = Math.max(0, Math.min(dist, eye.clone().sub(from).dot(dir)));
  const miss = from.clone().addScaledVector(dir, along).distanceTo(eye);
  if (miss < 1.6 && along > 3 && along < dist - 0.5) { if (fx.energy) sfx.zap(0.8); else sfx.whizz(); }
}

const lastShotSound = new Map<number, number>();

/** Proyectil de un cañón (los propios ya se dibujan al disparar). */
function onProjectile(m: ProjMsg) {
  if (m.owner === myId) return;
  const fx = weaponFx(roster.get(m.owner)?.loadout?.[m.slot] ?? DEFAULT_PRIMARY);
  const from = new THREE.Vector3(...m.from), dir = new THREE.Vector3(...m.dir);
  const hit = rayMapHit(from.x, from.y, from.z, dir.x, dir.y, dir.z, 200, boxes);
  world.spawnProjectile(m.id, from, dir, m.speed, m.gravity, hit.t, fx, false);
  world.getAvatar(m.owner)?.aimPulse();
  sfx.weapon(fx, soundAt(m.from[0], m.from[2]));
}

function onBoom(m: BoomMsg) {
  const fx = weaponFx(roster.get(m.owner)?.loadout?.[m.slot] ?? DEFAULT_PRIMARY);
  const pos = new THREE.Vector3(...m.pos);
  world.explode(m.id, pos, m.radius, fx, m.owner === myId);
  const d = pos.distanceTo(new THREE.Vector3(pred.x, pred.y + EYE_HEIGHT, pred.z));
  sfx.explosion(Math.min(1, 1.2 - d / 45), m.radius > 3.5, soundAt(pos.x, pos.z).pan);
  if (d < m.radius * 3) shake = Math.min(0.07, shake + 0.05 * (1 - d / (m.radius * 3)));
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
  // golpe de arma blanca: se oye el objeto contra el cuerpo (hoja, madera, metal o energía)
  if (slotStats[me.weapon]?.meleeRange > 0) { const mel = meleeOf(loadout[me.weapon]); sfx.meleeImpact(mel.kind, mel.heft); }
  if (h.kill) sfx.kill();
  else sfx.hit(h.headshot, h.damage);
  world.damageNumber(h.victim, h.damage, h.headshot, h.kill);
  music.bump(0.25);
}

function onDamaged(m: DamagedMsg) {
  flash("damage-flash", 280);
  sfx.hurt();
  music.bump(0.35);
  shake = Math.min(0.05, shake + 0.022);
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
  // Al soltar el ratón (Esc) durante la partida se abre la pausa
  const locked = document.pointerLockElement === canvas;
  $("click-to-play").classList.add("hidden");
  if (room) showPause(!locked);
  if (document.pointerLockElement !== canvas) mouseDown = false;
});
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * mouseSens;
  pitch -= e.movementY * mouseSens;
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
  if (e.code === "Digit3" || e.code === "Numpad3") pendingWeapon = 2;
  keysDown.add(e.code);
});
// Rueda del ratón: abajo pasa a la siguiente arma, arriba a la anterior (1 → 2 → 3 → 1)
let lastWheel = 0;
document.addEventListener("wheel", (e) => {
  if (!room || document.pointerLockElement !== canvas || e.deltaY === 0) return;
  e.preventDefault();
  const now = performance.now();
  if (now - lastWheel < 110) return; // una muesca por cambio, aunque el ratón mande varios eventos
  lastWheel = now;
  const from = pendingWeapon >= 0 ? pendingWeapon : me.weapon;
  pendingWeapon = (from + (e.deltaY > 0 ? 1 : 2)) % 3;
}, { passive: false });
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
  if (k("ShiftLeft") || k("ShiftRight")) keys |= KEY.SPRINT;
  if (aiming && !me.reloading && !me.switching && slotStats[me.weapon].zoomFov > 0) keys |= KEY.AIM;
  if (k("Digit1") || k("Numpad1") || pendingWeapon === 0) keys |= KEY.WEAPON1;
  else if (k("Digit2") || k("Numpad2") || pendingWeapon === 1) keys |= KEY.WEAPON2;
  else if (k("Digit3") || k("Numpad3") || pendingWeapon === 2) keys |= KEY.WEAPON3;
  pendingWeapon = -1;
  return keys;
}

// ---------- Tick fijo: predicción + envío de inputs ----------
function fixedTick() {
  if (!room || snapshotsReceived === 0) return;
  const keys = currentKeys();
  // k = multiplicador de velocidad del arma en la mano en este tick (para repetir la predicción igual)
  const cmd = { seq: ++seq, keys, yaw: aimYaw(), pitch: aimPitch(), k: slotStats[me.weapon]?.speedK ?? 1 };
  room.send("input", { seq: cmd.seq, keys, yaw: cmd.yaw, pitch: cmd.pitch } satisfies InputCmd);

  prevTickPos.copy(currTickPos);
  if (me.alive) {
    pending.push(cmd);
    const bx = pred.x, bz = pred.z;
    lastVy = pred.vy;
    stepMove(pred, keys, cmd.yaw, DT, boxes, cmd.k);
    sprinting = (keys & KEY.SPRINT) !== 0 && (keys & KEY.FORWARD) !== 0 && !(keys & (KEY.AIM | KEY.FIRE)) && pred.onGround;
    bloom = Math.max(0, bloom - BLOOM_RECOVERY);
    horizSpeed = Math.hypot(pred.x - bx, pred.z - bz) / DT;
    predictLocalFire(keys);
    footsteps(keys);
  } else {
    horizSpeed = 0;
  }
  currTickPos.set(pred.x, pred.y, pred.z);
}

function footsteps(keys: number) {
  if (pred.onGround && !wasOnGround) { sfx.land(); landDip = Math.min(0.16, Math.max(0.03, -lastVy * 0.012)); }
  if ((keys & KEY.JUMP) && wasOnGround && !pred.onGround) sfx.jump();
  wasOnGround = pred.onGround;
  if (pred.onGround && horizSpeed > 1) {
    stepTimer -= DT;
    if (stepTimer <= 0) {
      sfx.step(pred.y < 0.05);
      stepTimer = sprinting ? 0.27 : 0.36;
    }
  } else {
    stepTimer = 0.1;
  }
}

/** Efecto visual inmediato del disparo propio. El daño real lo decide el servidor. */
function predictLocalFire(keys: number) {
  // Cambio de arma inmediato en pantalla (el servidor lo confirma en el siguiente snapshot)
  const want = (keys & KEY.WEAPON1) ? 0 : (keys & KEY.WEAPON2) ? 1 : (keys & KEY.WEAPON3) ? 2 : me.weapon;
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
  // Arma blanca: solo el golpe (el servidor decide si acierta)
  if (w.meleeRange > 0) {
    if (!trigger || localFireCooldown > 0 || me.switching) return;
    localFireCooldown = w.fireIntervalTicks;
    world.swing(w.fireIntervalTicks * DT);
    const mel = meleeOf(loadout[me.weapon]);
    sfx.meleeSwing(mel.kind, mel.heft);
    shake = Math.min(0.05, shake + 0.006);
    return;
  }
  if ((keys & KEY.RELOAD) && me.ammo < w.magazine && !me.reloading) sfx.reload(weaponFx(loadout[me.weapon]).category);
  // gatillo sin balas: clic seco
  if (trigger && me.ammo <= 0 && !me.reloading && !me.switching && localFireCooldown === 0) { sfx.empty(); localFireCooldown = 8; }
  if (!trigger || localFireCooldown > 0 || me.reloading || me.switching || me.ammo <= 0) return;
  localFireCooldown = w.fireIntervalTicks;
  const ox = pred.x, oy = pred.y + EYE_HEIGHT, oz = pred.z;
  const fx = weaponFx(loadout[me.weapon]);
  // Cañón de proyectil: se dibuja el proyectil al instante; la explosión la confirma el servidor
  if (w.projectile) {
    const [dx, dy, dz] = aimDirection(aimYaw(), aimPitch());
    const from = new THREE.Vector3(ox + dx * 0.5, oy - 0.12 + dy * 0.5, oz + dz * 0.5);
    const hit = rayMapHit(from.x, from.y, from.z, dx, dy, dz, w.range, boxes);
    world.localShot([], pred.y, fx);
    world.spawnProjectile(-seq, from, new THREE.Vector3(dx, dy, dz), w.projectile.speed, w.projectile.gravity, hit.t, fx, true);
    sfx.weapon(fx);
    recoilPitch += fx.recoilUp * (0.85 + Math.random() * 0.3);
    recoilYaw += (Math.random() * 2 - 1) * fx.recoilSide;
    shake = Math.min(0.05, shake + fx.shake);
    return;
  }
  // Los perdigones y la dispersión de aquí son solo visuales: el servidor tira los suyos
  const spread = currentSpread();
  const ay = aimYaw(), ap = aimPitch();
  const hits = [];
  for (let k = 0; k < w.pellets; k++) {
    const jy = (Math.random() * 2 - 1) * spread, jp = (Math.random() * 2 - 1) * spread;
    const [dx, dy, dz] = aimDirection(ay + jy, ap + jp);
    const hit = rayMapHit(ox, oy, oz, dx, dy, dz, w.range, boxes);
    const isWall = hit.t < w.range - 0.01;
    hits.push({ point: new THREE.Vector3(ox + dx * hit.t, oy + dy * hit.t, oz + dz * hit.t), normal: new THREE.Vector3(...hit.normal), kind: isWall ? hit.kind : null });
  }
  world.localShot(hits, pred.y, fx);
  sfx.weapon(fx);
  music.bump(0.05);
  // Retroceso: la mira sube y se desvía; apuntando se controla mejor
  const control = (keys & KEY.AIM) ? 0.65 : 1;
  recoilPitch += fx.recoilUp * control * (0.85 + Math.random() * 0.3);
  recoilYaw += (Math.random() * 2 - 1) * fx.recoilSide * control;
  shake = Math.min(0.05, shake + fx.shake);
  bloom = Math.min(1, bloom + w.bloom);
  // Escopetas y rifles de cerrojo: al disparar se sale de la mira
  if (w.scope || fx.category === "shotgun") aiming = false;
}

/** Dispersión actual del arma en mano (misma fórmula que el servidor). */
function currentSpread(): number {
  return effectiveSpread(slotStats[me.weapon], {
    aiming: aiming && !me.reloading && !me.switching, bloom, speed: Math.hypot(pred.vx ?? 0, pred.vz ?? 0), onGround: pred.onGround,
  });
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
    const av = world.upsertAvatar(id, name, roster.get(id)?.look);
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
  fill.style.width = `${Math.min(100, (me.hp / me.maxHp) * 100)}%`;
  fill.classList.toggle("low", me.hp <= 30);
  const w = slotStats[me.weapon];
  const noAmmo = me.ammo < 0 || w.meleeRange > 0;
  $("ammo").textContent = noAmmo ? "—" : String(me.ammo);
  $("ammo-max").textContent = noAmmo ? "" : `/ ${w.magazine}`;
  $("weapon-name").textContent = (weaponModel(loadout[me.weapon])?.name ?? "").toUpperCase();
  const zoomed = aiming && me.alive && !me.reloading && !me.switching && w.zoomFov > 0;
  // Al correr el campo de visión se abre un poco: da sensación de velocidad
  world.setZoom(zoomed ? w.zoomFov : 0, sprinting ? 5 : 0);
  // Miras: la cruz se abre con la dispersión real del arma (movimiento, saltos y ráfagas); al apuntar
  // aparece la mira holográfica y, en los francotiradores, la telescópica con la distancia al objetivo
  const fovRad = (world.camera.fov * Math.PI) / 180;
  const gap = Math.max(3, Math.min(90, (Math.tan(currentSpread()) / Math.tan(fovRad / 2)) * (window.innerHeight / 2)));
  reticles.setWeapon(weaponFx(loadout[me.weapon]));
  const scoped = zoomed && w.scope;
  let range: number | null = null;
  if (scoped) {
    const cam = world.camera, d = cam.getWorldDirection(scopeDir);
    const t = rayMap(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, 400, boxes);
    range = t < 399 ? t : null;
  }
  reticles.update({ gap, ads: zoomed && !w.scope && w.meleeRange <= 0, scoped, range, zoom: Math.tan((72 * Math.PI) / 360) / Math.tan(fovRad / 2) });
  $("slot-1").classList.toggle("active", me.weapon === 0);
  $("slot-2").classList.toggle("active", me.weapon === 1);
  $("slot-3").classList.toggle("active", me.weapon === 2);
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
  // El retroceso se recupera solo; la sacudida y el hundimiento al aterrizar se apagan
  const rec = Math.pow(0.004, dt);
  recoilPitch *= rec; recoilYaw *= rec;
  shake *= Math.pow(0.0005, dt);
  landDip *= Math.pow(0.0008, dt);
  const alpha = accumulator / DT;
  if (room) {
    const view = prevTickPos.clone().lerp(currTickPos, alpha).add(correction);
    // Balanceo de la cámara al caminar (muy leve; casi nada apuntando)
    const moving = me.alive && pred.onGround ? Math.min(1, horizSpeed / SPRINT_SPEED) : 0;
    bobPhase += dt * (7 + moving * 6) * (moving > 0.05 ? 1 : 0);
    const bobK = moving * (aiming ? 0.25 : 1);
    const bobY = Math.sin(bobPhase * 2) * 0.022 * bobK, bobRoll = Math.sin(bobPhase) * 0.004 * bobK;
    // Inclinación al moverse de lado
    const side = (pred.vx ?? 0) * Math.cos(yaw) - (pred.vz ?? 0) * Math.sin(yaw);
    strafeRoll += (-side * 0.0035 - strafeRoll) * Math.min(1, dt * 8);
    const sh = shake * Math.sin(now * 0.09);
    world.setView(view.x, view.y, view.z, aimYaw() + sh * 0.3, aimPitch() + sh * 0.2, strafeRoll + bobRoll + sh, bobY - landDip);
  } else {
    // Vista del menú: la cámara gira lentamente alrededor del mapa, por encima de los tejados.
    const a = now / 20000;
    const b = mapDef.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rad = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * (mapDef.model ? 0.55 : 0.37);
    const h = mapDef.model ? 18 : 4.5;
    // En interiores la cámara gira dentro del hangar (desde afuera no se ve nada)
    if (mapDef.indoor) world.setView(40, 5.5, 21, a * 2, -0.12);
    else world.setView(cx + Math.sin(a) * rad, h, cz + Math.cos(a) * rad, a, mapDef.model ? -0.38 : -0.12);
  }

  updateRemotes(now);
  if (room) updateHud();
  world.render(dt, {
    speed: horizSpeed, onGround: pred.onGround, lookDX, lookDY,
    reloading: me.reloading, alive: !!room && me.alive,
    aiming: aiming && slotStats[me.weapon].scope && !me.reloading && !me.switching,
    ads: aiming && !slotStats[me.weapon].scope && slotStats[me.weapon].zoomFov > 0 && !me.reloading && !me.switching,
    sprinting,
    reloadSeconds: slotStats[me.weapon].reloadTicks * DT,
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
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG === "1") {
  Object.assign(window, {
    __game: {
      get pred() { return pred; }, get me() { return me; }, get myId() { return myId; },
      get yaw() { return yaw; }, get pitch() { return pitch; }, get recoil() { return [recoilPitch, recoilYaw, bloom, shake, landDip]; }, get pending() { return pending.length; }, get seq() { return seq; },
      look(y: number, p: number) { yaw = y; pitch = p; },
      get others() { return remoteBuffer.length ? [...remoteBuffer[remoteBuffer.length - 1].others.values()] : []; },
      fire(on: boolean) { mouseDown = on; },
      aim(on: boolean) { aiming = on; },
    },
  });
}
