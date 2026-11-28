// Sonido del juego con Web Audio.
//
// Los disparos usan grabaciones reales (client/public/assets/sfx, créditos en CREDITS.md) mezcladas
// en capas, como en los shooters comerciales:
//  1. el disparo grabado (cada modelo de arma usa una grabación y un tono propios, con una ligera
//     variación en cada tiro para que una ráfaga no suene a "ametralladora de juguete");
//  2. un golpe grave sintetizado que da peso;
//  3. el mecanismo (bombeo de la escopeta, cerrojo del francotirador);
//  4. eco por convolución que depende del mapa: rebotes entre edificios, nave metálica o montaña.
// Los disparos de otros se oyen desde su dirección, más apagados y con más eco cuanto más lejos,
// y llegan con el retraso real del sonido. Si las grabaciones aún no cargaron, se sintetizan.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let dryBus: GainNode | null = null;
let revSend: GainNode | null = null;
let convolver: ConvolverNode | null = null;
let masterVolume = 0.8;
let envId = "";

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = masterVolume;
      // Compresor: los disparos seguidos no saturan y el conjunto suena más "lleno"
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.18;
      // Limitador final: nunca pasa de 0 dB aunque coincidan muchos disparos y explosiones
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.001; lim.release.value = 0.08;
      master.connect(comp).connect(lim).connect(ctx.destination);
      dryBus = ctx.createGain();
      dryBus.gain.value = 0.78; // margen para la música y para muchos disparos a la vez
      dryBus.connect(master);
      revSend = ctx.createGain();
      convolver = ctx.createConvolver();
      const revReturn = ctx.createGain();
      revReturn.gain.value = 0.75;
      revSend.connect(convolver).connect(revReturn).connect(master);
      applyEnvironment();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Contexto de audio compartido (lo usa también la música). */
export function audioContext(): AudioContext | null { return ac(); }

// ---------- Eco según el lugar ----------

interface Acoustics {
  /** Duración de la cola (s). */
  decay: number;
  /** Retraso antes de que empiece la cola (s). */
  pre: number;
  /** Brillo de la cola (0..1) y cuánto se apaga con el tiempo. */
  bright: number;
  damp: number;
  /** Rebotes claros: [segundos, volumen]. */
  echoes: [number, number][];
  /** Cuánto eco recibe un disparo propio. */
  wet: number;
}

const ACOUSTICS: Record<string, Acoustics> = {
  // calles entre naves y edificios: rebotes cortos y cola media
  factory: { decay: 2.0, pre: 0.012, bright: 0.5, damp: 1.4, echoes: [[0.11, 0.5], [0.19, 0.34], [0.33, 0.24], [0.54, 0.14]], wet: 0.3 },
  // estación espacial: metal, rebotes muy seguidos y cola brillante
  station: { decay: 1.4, pre: 0.006, bright: 0.8, damp: 2.6, echoes: [[0.028, 0.42], [0.052, 0.32], [0.085, 0.26], [0.13, 0.16]], wet: 0.36 },
  // montaña abierta: eco largo que vuelve desde las laderas
  observatory: { decay: 2.8, pre: 0.02, bright: 0.32, damp: 1.0, echoes: [[0.38, 0.34], [0.72, 0.2], [1.12, 0.11]], wet: 0.26 },
  menu: { decay: 1.2, pre: 0.01, bright: 0.5, damp: 2, echoes: [], wet: 0.12 },
};
let acoustics = ACOUSTICS.menu;

/** Respuesta al impulso sintética: ruido que decae, se oscurece con el tiempo y tiene rebotes. */
function impulse(a: BaseAudioContext, k: Acoustics): AudioBuffer {
  const sr = a.sampleRate, len = Math.floor(sr * k.decay);
  const buf = a.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < k.pre) continue;
      const amp = Math.exp((-6.9 * (t - k.pre)) / (k.decay - k.pre));
      const c = Math.max(0.02, k.bright * Math.exp(-t * k.damp));
      lp += c * (Math.random() * 2 - 1 - lp);
      d[i] = lp * amp * 0.6;
    }
    // rebotes: pequeñas ráfagas un poco distintas en cada oído
    for (const [time, gain] of k.echoes) {
      const at = Math.floor((time + (ch ? 0.007 : 0)) * sr), n = Math.floor(0.012 * sr);
      let e = 0;
      for (let i = 0; i < n && at + i < len; i++) {
        e += 0.5 * (Math.random() * 2 - 1 - e);
        d[at + i] += e * gain * Math.exp(-i / (n * 0.35));
      }
    }
  }
  return buf;
}

function applyEnvironment() {
  if (!ctx || !convolver) return;
  convolver.buffer = impulse(ctx, acoustics);
}

// ---------- Grabaciones ----------

const SAMPLES = [
  "rifle_lmg", "rifle_mb", "rifle_sks_a", "rifle_sks_b", "rifle_sks_c", "smg_mb",
  "pistol_mb", "pistol_cz_a", "pistol_cz_b", "pistol_cz_c", "shotgun_10g", "shotgun_mb",
  "sniper_mosin_a", "sniper_mosin_b", "sniper_mosin_c", "e_rifle_a", "e_rifle_b", "e_shotgun", "e_sniper",
  "rocket", "plasma_a", "plasma_b", "explode_big", "explode_small", "pump", "bolt",
  "reload_rifle", "reload_pistol", "reload_shotgun", "click_switch", "click_empty",
  "swing_a", "swing_b", "swing_c", "swing_d", "melee_hit", "melee_clash",
  "slice_a", "slice_b", "slice_c", "flesh_a", "flesh_b", "flesh_c", "thud_heavy",
  "wood_a", "wood_b", "wood_c", "metal_a", "metal_b", "metal_c",
] as const;
type SampleName = (typeof SAMPLES)[number];

/** Grabación decodificada y el punto donde empieza el sonido (los MP3 traen un poco de silencio). */
const buffers = new Map<SampleName, { buf: AudioBuffer; offset: number }>();
let loading: Promise<void> | null = null;

function onsetOf(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const th = pk * 0.03;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > th) return Math.max(0, i / buf.sampleRate - 0.002);
  return 0;
}

/** Descarga y decodifica las grabaciones (sin crear todavía el AudioContext: el navegador lo pide tras un clic). */
function preload(base: string): Promise<void> {
  if (loading) return loading;
  const dec = new OfflineAudioContext(1, 1, 44100);
  loading = Promise.all(SAMPLES.map(async (name) => {
    try {
      const res = await fetch(`${base}assets/sfx/${name}.mp3`);
      if (!res.ok) return;
      const buf = await dec.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, { buf, offset: onsetOf(buf) });
    } catch { /* se usará el sonido sintetizado */ }
  })).then(() => undefined);
  return loading;
}

interface PlayOpts {
  rate?: number;
  gain?: number;
  delay?: number;
  /** -1 izquierda … 1 derecha */
  pan?: number;
  /** Frecuencia de corte para apagar los agudos (lejanía). */
  lowpass?: number;
  /** Cantidad de eco y de sonido directo. */
  wet?: number;
  dry?: number;
  /** Corta la cola a los n segundos (armas muy rápidas, para que no se emborronen). */
  cut?: number;
}

let voices = 0;
const MAX_VOICES = 48;

function play(name: SampleName, o: PlayOpts = {}): boolean {
  const s = buffers.get(name);
  if (!s) return false;
  const a = ac();
  if (!a || !dryBus || !revSend) return false;
  const gain = o.gain ?? 1;
  if (voices >= MAX_VOICES && gain < 0.6) return true; // demasiados sonidos a la vez: se omiten los débiles
  const src = a.createBufferSource();
  src.buffer = s.buf;
  src.playbackRate.value = o.rate ?? 1;
  const g = a.createGain();
  const t = a.currentTime + (o.delay ?? 0);
  g.gain.setValueAtTime(gain, t);
  let node: AudioNode = src.connect(g);
  if (o.lowpass && o.lowpass < 18000) {
    const f = a.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = o.lowpass; f.Q.value = 0.5;
    node = node.connect(f);
  }
  if (o.pan) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    node = node.connect(p);
  }
  const dry = a.createGain();
  dry.gain.value = o.dry ?? 1;
  node.connect(dry).connect(dryBus);
  const wet = o.wet ?? acoustics.wet;
  if (wet > 0) {
    const w = a.createGain();
    w.gain.value = wet;
    node.connect(w).connect(revSend);
  }
  src.start(t, s.offset);
  if (o.cut) {
    g.gain.setValueAtTime(gain, t + o.cut);
    g.gain.exponentialRampToValueAtTime(0.0005, t + o.cut + 0.07);
    src.stop(t + o.cut + 0.09);
  }
  voices++;
  src.onended = () => { voices--; };
  return true;
}

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// ---------- Síntesis (capas extra y respaldo) ----------

const noiseCache = new Map<number, AudioBuffer>();
function noiseBuffer(a: AudioContext, duration: number): AudioBuffer {
  const key = Math.round(duration * 1000);
  let buf = noiseCache.get(key);
  if (!buf) {
    const len = Math.floor(a.sampleRate * duration);
    buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(key, buf);
  }
  return buf;
}

/** Tono y volumen del sonido sintetizado que se está generando. */
let rate = 1, vol = 1, synthPan = 0, synthDelay = 0;

function route(a: AudioContext, node: AudioNode, wet = 0) {
  let out = node;
  if (synthPan) { const p = a.createStereoPanner(); p.pan.value = synthPan; out = out.connect(p); }
  out.connect(dryBus!);
  if (wet > 0 && revSend) { const w = a.createGain(); w.gain.value = wet; out.connect(w).connect(revSend); }
}

function noise(duration: number, type: BiquadFilterType, freq: number, gain: number, decay = 2, q = 0.7, delay = 0, wet = 0) {
  const a = ac();
  if (!a || !dryBus) return;
  freq *= rate; gain *= vol;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, duration);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime + delay + synthDelay;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration / decay * 2);
  route(a, src.connect(f).connect(g), wet);
  src.start(t);
}

function tone(freq: number, duration: number, gain: number, type: OscillatorType = "sine", endFreq?: number, delay = 0, wet = 0) {
  const a = ac();
  if (!a || !dryBus) return;
  freq *= rate; gain *= vol;
  if (endFreq) endFreq *= rate;
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime + delay + synthDelay;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  route(a, o.connect(g), wet);
  o.start(t);
  o.stop(t + duration + 0.02);
}

/** Golpe grave que da peso al disparo (se nota sobre todo con auriculares o altavoces con graves). */
function thump(f0: number, f1: number, dur: number, gain: number) {
  tone(f0, dur, gain, "sine", f1);
  tone(f0 * 2, dur * 0.5, gain * 0.35, "triangle", f1 * 2);
}

/** Disparo 100 % sintetizado: se usa si las grabaciones no cargaron. */
function synthShot(category: string, energy: boolean) {
  if (energy) {
    tone(980, 0.13, 0.32, "sawtooth", 230); tone(1960, 0.07, 0.12, "square", 600); noise(0.07, "highpass", 3200, 0.22, 3); tone(110, 0.1, 0.25, "sine", 50);
    return;
  }
  switch (category) {
    case "shotgun": noise(0.07, "highpass", 1800, 0.5, 3); noise(0.3, "lowpass", 1100, 0.7, 2.2); tone(90, 0.22, 0.55, "sine", 38); break;
    case "sniper": noise(0.05, "highpass", 3500, 0.6, 3); noise(0.2, "lowpass", 2200, 0.6, 2.5); tone(120, 0.18, 0.5, "sine", 40); break;
    case "pistol": noise(0.04, "highpass", 3000, 0.45, 3); noise(0.12, "lowpass", 2400, 0.45, 2.5); tone(220, 0.08, 0.3, "sine", 70); break;
    default: noise(0.05, "highpass", 2500, 0.5, 3); noise(0.18, "lowpass", 1800, 0.55, 2.5); tone(150, 0.12, 0.45, "sine", 45);
  }
}

// ---------- Recetas de cada tipo de arma ----------

interface Recipe {
  /** Familias de grabaciones: cada modelo de arma usa una familia; cada tiro, una toma al azar de ella. */
  pools: SampleName[][];
  rate: number;
  gain: number;
  /** Golpe grave: [frecuencia inicial, final, duración, volumen]. */
  sub?: [number, number, number, number];
  cut?: number;
  /** Mecanismo después del disparo (solo cerca). */
  mech?: { name: SampleName; delay: number; gain: number; rate?: number };
  /** Capa sintetizada extra (zumbidos de energía, silbido del riel…). */
  extra?: () => void;
}

const SKS: SampleName[] = ["rifle_sks_a", "rifle_sks_b", "rifle_sks_c"];
const CZ: SampleName[] = ["pistol_cz_a", "pistol_cz_b", "pistol_cz_c"];
const MOSIN: SampleName[] = ["sniper_mosin_a", "sniper_mosin_b", "sniper_mosin_c"];

const RECIPES: Record<string, Recipe> = {
  rifle: { pools: [["rifle_lmg"], ["rifle_mb"], SKS], rate: 1, gain: 0.95, sub: [80, 38, 0.16, 0.42] },
  smg: { pools: [["smg_mb"], ["pistol_mb"], SKS], rate: 1.14, gain: 0.85, sub: [95, 45, 0.1, 0.3], cut: 0.32 },
  pistol: { pools: [["pistol_mb"], CZ], rate: 1.04, gain: 0.9, sub: [88, 40, 0.14, 0.5] },
  shotgun: { pools: [["shotgun_10g"], ["shotgun_mb"]], rate: 0.97, gain: 1, sub: [62, 30, 0.26, 0.6], mech: { name: "pump", delay: 0.36, gain: 0.55 } },
  sniper: { pools: [MOSIN, ["rifle_lmg"]], rate: 0.9, gain: 1, sub: [58, 28, 0.3, 0.6], mech: { name: "bolt", delay: 0.5, gain: 0.45 } },
  minigun: { pools: [["smg_mb"], ["rifle_mb"]], rate: 1.04, gain: 0.75, sub: [85, 45, 0.07, 0.25], cut: 0.15 },
  rocket: { pools: [["rocket"]], rate: 1, gain: 1, sub: [55, 30, 0.35, 0.55] },
  plasma: { pools: [["plasma_a"], ["plasma_b"]], rate: 1, gain: 0.9, sub: [70, 34, 0.22, 0.45], extra: () => tone(420, 0.28, 0.12, "sawtooth", 90) },
  rail: {
    pools: [["e_sniper"]], rate: 0.8, gain: 1, sub: [60, 28, 0.35, 0.55],
    extra: () => { tone(240, 0.07, 0.1, "sawtooth", 1900); tone(2600, 0.45, 0.12, "sawtooth", 90, 0.05, 0.3); },
  },
  e_rifle: { pools: [["e_rifle_a"], ["e_rifle_b"]], rate: 1.06, gain: 0.95, sub: [70, 34, 0.14, 0.35] },
  e_smg: { pools: [["e_rifle_a"], ["e_rifle_b"]], rate: 1.3, gain: 0.8, sub: [90, 45, 0.08, 0.25], cut: 0.22 },
  e_pistol: { pools: [["e_sniper"], ["e_rifle_a"]], rate: 1.22, gain: 0.85, sub: [95, 45, 0.09, 0.28] },
  e_shotgun: { pools: [["e_shotgun"]], rate: 1, gain: 1, sub: [60, 30, 0.24, 0.55] },
  e_sniper: {
    pools: [["e_sniper"]], rate: 0.86, gain: 1, sub: [58, 28, 0.3, 0.55],
    extra: () => tone(2400, 0.4, 0.08, "sawtooth", 120, 0.03, 0.35),
  },
};

function recipeFor(fx: { category: string; energy: boolean; cannon?: string }): Recipe {
  if (fx.cannon === "minigun" && fx.energy) return { ...RECIPES.e_smg, cut: 0.14, rate: 1.4 };
  if (fx.cannon) return RECIPES[fx.cannon] ?? RECIPES.rifle;
  return RECIPES[(fx.energy ? "e_" : "") + fx.category] ?? RECIPES[fx.category] ?? RECIPES.rifle;
}

/** Material de la parte que golpea un arma blanca, y su peso (1 = media; >1 pesada y más grave). */
export type MeleeKind = "blade" | "wood" | "metal" | "energy";
const SWINGS = ["swing_a", "swing_b", "swing_c", "swing_d"] as const;
const FLESH = ["flesh_a", "flesh_b", "flesh_c"] as const;

/** Zumbido de una hoja de energía al moverse. */
function energyHum(heft: number, gain: number) {
  tone(95 / heft, 0.34, 0.22 * gain, "sawtooth", 150 / heft);
  tone(190 / heft, 0.3, 0.1 * gain, "square", 120 / heft, 0.04);
  noise(0.25, "bandpass", 2400, 0.08 * gain, 1.4, 3);
}

/** Dónde suena un disparo de otro: distancia (m) y dirección (-1 izquierda … 1 derecha). */
export interface Where { distance: number; pan: number }

export const sfx = {
  unlock: () => void ac(),
  /** Descarga las grabaciones; se puede llamar antes del primer clic. */
  preload,
  /** Volumen general de los efectos (0..1). */
  setVolume: (v: number) => { masterVolume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = masterVolume; },
  /** Acústica del lugar (id del mapa). */
  setEnvironment: (id: string) => {
    if (id === envId) return;
    envId = id;
    acoustics = ACOUSTICS[id] ?? ACOUSTICS.factory;
    applyEnvironment();
  },
  /**
   * Disparo según el arma. Sin `where` es el propio (en la cabeza); con `where`, el de otro jugador.
   * (Por compatibilidad, un número como segundo argumento es el volumen de un disparo lejano.)
   */
  weapon: (fx: { category: string; energy: boolean; pitch: number; soundVariant?: number; cannon?: string }, where?: Where | number) => {
    if (fx.category === "melee") { sfx.swing(); return; }
    const w: Where | null = typeof where === "number" ? { distance: (1 - where) * 70, pan: 0 } : where ?? null;
    const d = w?.distance ?? 0;
    const own = !w;
    const r = recipeFor(fx);
    // tono propio del modelo (dentro de ±6 % para no deformar la grabación) y variación por disparo
    const modelRate = 0.94 + Math.max(0, Math.min(1, (fx.pitch - 0.88) / 0.26)) * 0.12;
    const shotRate = r.rate * modelRate * (0.975 + Math.random() * 0.05);
    const near = own ? 1 : Math.max(0.06, Math.min(0.85, 1 - d / 75));
    const lowpass = own ? 20000 : 700 + 17000 * Math.max(0, 1 - d / 85) ** 2;
    const delay = own ? 0 : Math.min(0.2, d / 343);
    // dirección: cuanto más lejos, más definida (pero sin dejar nunca un oído en silencio)
    const pan = own ? 0 : w!.pan * Math.min(0.75, 0.35 + d / 40);
    const wet = own ? acoustics.wet : Math.min(0.85, acoustics.wet * (1 + d / 35));
    const family = r.pools[Math.floor((fx.soundVariant ?? 0) * r.pools.length) % r.pools.length];
    const played = play(pick(family), { rate: shotRate, gain: r.gain * near, delay, pan, lowpass, wet, dry: own ? 1 : 0.9, cut: r.cut });
    rate = 1; vol = near; synthPan = pan; synthDelay = delay;
    if (!played) synthShot(fx.category, fx.energy);
    // capas de cerca: golpe grave, capa de energía y mecanismo
    if (r.sub && d < 30) {
      const [f0, f1, dur, g] = r.sub;
      vol = near * (own ? 1 : 0.6);
      thump(f0, f1, dur, g);
    }
    if (r.extra && d < 45) { vol = near; r.extra(); }
    if (r.mech && d < 18) play(r.mech.name, { rate: r.mech.rate ?? 1, gain: r.mech.gain * near, delay: delay + r.mech.delay, pan, wet: 0.12, lowpass });
    rate = 1; vol = 1; synthPan = 0; synthDelay = 0;
  },
  /**
   * Arma blanca cortando el aire, según su material: las hojas silban agudo, los bates y palas
   * hacen un "vuuum" grave y las de energía zumban. `heft` > 1 = más pesada (más lenta y grave).
   */
  meleeSwing: (kind: MeleeKind, heft = 1, where?: Where) => {
    const d = where?.distance ?? 0, near = where ? Math.max(0.1, 1 - d / 25) : 1, pan = where?.pan ?? 0;
    const name = pick(SWINGS);
    if (kind === "blade") play(name, { rate: (1.02 + Math.random() * 0.14) / heft, gain: 0.8 * near, pan, wet: 0.08 });
    else if (kind === "energy") { play(name, { rate: (0.95 + Math.random() * 0.1) / heft, gain: 0.55 * near, pan, wet: 0.12 }); vol = near; synthPan = pan; energyHum(heft, 1); vol = 1; synthPan = 0; }
    else play(name, { rate: (0.7 + Math.random() * 0.08) / heft, gain: 0.95 * near, pan, wet: 0.06, lowpass: kind === "wood" ? 1800 : 2600 });
  },
  /**
   * Golpe que acierta: el sonido del objeto (corte metálico, madera, metal, chispazo) sobre el golpe
   * en el cuerpo; las armas pesadas suman un golpe grave.
   */
  meleeImpact: (kind: MeleeKind, heft = 1, where?: Where) => {
    const d = where?.distance ?? 0, near = where ? Math.max(0.1, 1 - d / 25) : 1, pan = where?.pan ?? 0;
    const r = () => (0.92 + Math.random() * 0.14) / Math.sqrt(heft);
    let ok = play(pick(FLESH), { rate: r(), gain: (kind === "blade" ? 0.75 : 0.65) * near, pan, wet: 0.1 });
    if (kind === "blade") ok = play(pick(["slice_a", "slice_b", "slice_c"] as const), { rate: r(), gain: 0.8 * near, pan, wet: 0.14 }) || ok;
    else if (kind === "wood") ok = play(pick(["wood_a", "wood_b", "wood_c"] as const), { rate: r(), gain: 1 * near, pan, wet: 0.12 }) || ok;
    else if (kind === "metal") ok = play(pick(["metal_a", "metal_b", "metal_c"] as const), { rate: r() * 0.9, gain: 0.85 * near, pan, wet: 0.18 }) || ok;
    else {
      play(pick(["slice_a", "slice_b", "slice_c"] as const), { rate: 0.75, gain: 0.4 * near, pan, wet: 0.2 });
      vol = near; synthPan = pan;
      noise(0.14, "highpass", 2800, 0.25, 2, 2); tone(880, 0.16, 0.12, "sawtooth", 140); tone(60, 0.18, 0.3, "sine", 35);
      vol = 1; synthPan = 0;
    }
    if (heft > 1.05 || kind === "wood" || kind === "metal") play("thud_heavy", { rate: 1 / heft, gain: (heft > 1.05 ? 0.55 : 0.35) * near, pan, wet: 0.08 });
    if (!ok) { vol = near; noise(0.1, "lowpass", 600, 0.5, 2); tone(95, 0.12, 0.4, "sine", 50); vol = 1; }
  },
  /** Arma blanca cortando el aire (`heavy` > 1 = arma más pesada, suena más grave). */
  swing: (where?: Where, heavy = 1) => {
    const d = where?.distance ?? 0, near = where ? Math.max(0.1, 1 - d / 25) : 1;
    if (play(pick(["swing_a", "swing_b", "swing_c", "swing_d"] as const), { rate: (0.92 + Math.random() * 0.16) / heavy, gain: 0.75 * near, pan: where?.pan ?? 0, wet: 0.08 })) return;
    vol = near; noise(0.18, "bandpass", 900, 0.22, 1.6, 1.4); noise(0.12, "highpass", 2500, 0.08, 2, 1, 0.04); vol = 1;
  },
  /** Golpe de arma blanca que acierta. */
  thud: (where?: Where) => {
    const d = where?.distance ?? 0, near = where ? Math.max(0.1, 1 - d / 25) : 1;
    vol = near;
    if (!play("melee_hit", { rate: 0.9 + Math.random() * 0.15, gain: 0.95 * near, pan: where?.pan ?? 0, wet: 0.12 })) noise(0.1, "lowpass", 600, 0.5, 2);
    tone(95, 0.12, 0.35, "sine", 50);
    vol = 1;
  },
  /** Explosión: más fuerte cuanto más cerca (volume 0..1). */
  explosion: (volume: number, big: boolean, pan = 0) => {
    const v = Math.max(0.08, volume);
    const far = 1 - v;
    const ok = play(big ? "explode_big" : "explode_small", { rate: 0.95 + Math.random() * 0.1, gain: v, pan: pan * 0.8, wet: 0.35 + far * 0.4, lowpass: 900 + 18000 * v * v, delay: Math.min(0.15, far * 0.15) });
    vol = v; synthPan = pan * 0.8;
    tone(big ? 60 : 90, big ? 0.6 : 0.35, 0.6, "sine", 26);
    if (!ok) { noise(big ? 1.4 : 0.7, "lowpass", big ? 320 : 600, 0.9, 1.3); noise(0.12, "highpass", 2000, 0.4, 3); }
    vol = 1; synthPan = 0;
  },
  /** Impacto de energía cercano: chisporroteo. */
  zap: (volume: number) => { vol = volume; noise(0.12, "highpass", 2600, 0.12, 2, 2); tone(420, 0.1, 0.08, "square", 120); vol = 1; },
  /** Bala que pasa cerca. */
  whizz: () => { noise(0.14, "bandpass", 2400, 0.16, 2, 6); tone(1800, 0.12, 0.05, "sine", 700); },
  switchWeapon: () => { if (!play("click_switch", { rate: 0.95 + Math.random() * 0.1, gain: 0.6, wet: 0.05 })) { noise(0.05, "bandpass", 1800, 0.18, 2, 3); noise(0.04, "bandpass", 2600, 0.15, 2, 4, 0.12); } },
  /** Gatillo sin munición. */
  empty: () => { if (!play("click_empty", { gain: 0.55, wet: 0.04 })) noise(0.04, "bandpass", 2400, 0.2, 2, 4); },
  /** Confirmación de impacto: más grave y fuerte cuanto más daño. */
  hit: (head: boolean, damage = 20) => {
    const k = Math.min(1, damage / 90);
    tone(head ? 1500 : 1050 - k * 300, 0.05 + k * 0.04, 0.1 + k * 0.08, "triangle");
    if (head) tone(2250, 0.05, 0.06, "sine", undefined, 0.03);
  },
  kill: () => { tone(820, 0.07, 0.12, "triangle"); tone(1230, 0.12, 0.12, "triangle", undefined, 0.07); },
  hurt: () => { noise(0.12, "lowpass", 400, 0.35, 2); tone(90, 0.18, 0.25, "sine", 60); },
  /** Recarga según el tipo de arma. */
  reload: (category = "rifle") => {
    const name: SampleName = category === "shotgun" ? "reload_shotgun" : category === "pistol" ? "reload_pistol" : "reload_rifle";
    if (play(name, { gain: 0.7, wet: 0.06 })) return;
    noise(0.04, "bandpass", 2400, 0.25, 2, 4);
    noise(0.05, "bandpass", 1600, 0.3, 2, 4, 0.55);
    noise(0.04, "bandpass", 3000, 0.25, 2, 5, 1.2);
  },
  /** Pisada: crujido de nieve o golpe sobre piedra/metal. */
  step: (onSnow: boolean) => {
    if (onSnow) noise(0.12, "bandpass", 1800 + Math.random() * 900, 0.09, 2, 1.2);
    else { noise(0.05, "lowpass", 700, 0.12, 2); tone(70 + Math.random() * 20, 0.06, 0.06); }
  },
  jump: () => noise(0.1, "bandpass", 1200, 0.07, 2, 1),
  land: () => { noise(0.12, "lowpass", 500, 0.2, 2); tone(60, 0.1, 0.15); },
  pickup: () => { tone(660, 0.08, 0.1, "sine"); tone(990, 0.14, 0.1, "sine", undefined, 0.08); },
};
