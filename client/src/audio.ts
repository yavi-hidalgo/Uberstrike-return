// Sonidos sintetizados con Web Audio (sin archivos externos).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      // Un compresor evita que los disparos seguidos saturen
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

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

/** Tono y volumen del sonido que se está generando (los fija `sfx.weapon`). */
let rate = 1, vol = 1;

function noise(duration: number, type: BiquadFilterType, freq: number, gain: number, decay = 2, q = 0.7, delay = 0) {
  const a = ac();
  if (!a || !master) return;
  freq *= rate; gain *= vol;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, duration);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration / decay * 2);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

function tone(freq: number, duration: number, gain: number, type: OscillatorType = "sine", endFreq?: number, delay = 0) {
  const a = ac();
  if (!a || !master) return;
  freq *= rate; gain *= vol;
  if (endFreq) endFreq *= rate;
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + duration + 0.02);
}

export const sfx = {
  unlock: () => void ac(),
  /** Disparo propio: chasquido + golpe grave + cola. */
  shoot: () => {
    noise(0.05, "highpass", 2500, 0.5, 3);
    noise(0.18, "lowpass", 1800, 0.55, 2.5);
    tone(150, 0.12, 0.45, "sine", 45);
    noise(0.5, "bandpass", 500, 0.12, 1.2, 0.6, 0.03);
  },
  /** Pistola: más seca y aguda que el rifle. */
  pistol: () => {
    noise(0.04, "highpass", 3000, 0.45, 3);
    noise(0.12, "lowpass", 2400, 0.45, 2.5);
    tone(220, 0.08, 0.3, "sine", 70);
    noise(0.35, "bandpass", 700, 0.08, 1.2, 0.6, 0.02);
  },
  /** Escopeta: estampido grave y largo. */
  shotgun: () => {
    noise(0.07, "highpass", 1800, 0.5, 3);
    noise(0.3, "lowpass", 1100, 0.7, 2.2);
    tone(90, 0.22, 0.55, "sine", 38);
    noise(0.8, "bandpass", 300, 0.15, 1.1, 0.5, 0.04);
  },
  /** Francotirador: chasquido seco con mucho eco. */
  sniper: () => {
    noise(0.05, "highpass", 3500, 0.6, 3);
    noise(0.2, "lowpass", 2200, 0.6, 2.5);
    tone(120, 0.18, 0.5, "sine", 40);
    noise(1.4, "bandpass", 420, 0.16, 1, 0.5, 0.08);
  },
  /**
   * Disparo según el arma: cada tipo suena distinto, las de energía tienen su propio timbre
   * y cada modelo un tono ligeramente diferente. `volume` < 1 para disparos lejanos de otros.
   */
  weapon: (fx: { category: string; energy: boolean; pitch: number }, volume = 1) => {
    rate = fx.pitch * (0.97 + Math.random() * 0.06);
    vol = volume;
    const far = volume < 0.999;
    if (fx.energy) {
      switch (fx.category) {
        case "smg": // ráfaga de pulsos cortos y agudos
          tone(1500, 0.07, 0.22, "sawtooth", 520); tone(2200, 0.04, 0.1, "square", 900); noise(0.05, "highpass", 4000, 0.16, 3);
          break;
        case "shotgun": // descarga gruesa que se abre
          tone(320, 0.32, 0.4, "sawtooth", 55); tone(640, 0.2, 0.2, "square", 110); noise(0.3, "bandpass", 900, 0.45, 2, 0.8); noise(0.7, "lowpass", 300, 0.14, 1.1, 0.5, 0.05);
          break;
        case "sniper": // cañón de riel: carga breve, latigazo y cola eléctrica
          tone(240, 0.07, 0.2, "sawtooth", 1900); tone(2600, 0.5, 0.36, "sawtooth", 90, 0.06); noise(0.08, "highpass", 5000, 0.5, 3, 0.7, 0.06);
          noise(1.2, "bandpass", 1400, 0.14, 1, 2.5, 0.1); tone(70, 0.35, 0.4, "sine", 32, 0.06);
          break;
        case "pistol":
          tone(1150, 0.11, 0.3, "square", 380); tone(1700, 0.06, 0.12, "sawtooth", 700); noise(0.06, "highpass", 3500, 0.2, 3);
          break;
        default: // rifle de pulsos
          tone(980, 0.13, 0.32, "sawtooth", 230); tone(1960, 0.07, 0.12, "square", 600); noise(0.07, "highpass", 3200, 0.22, 3); tone(110, 0.1, 0.25, "sine", 50);
      }
    } else {
      switch (fx.category) {
        case "smg": // tableteo seco y agudo
          noise(0.035, "highpass", 3400, 0.42, 3); noise(0.09, "lowpass", 2600, 0.4, 2.6); tone(210, 0.06, 0.26, "sine", 80); if (!far) noise(0.22, "bandpass", 900, 0.06, 1.3, 0.6, 0.02);
          break;
        case "shotgun": sfx.shotgun(); break;
        case "sniper": sfx.sniper(); tone(55, 0.3, 0.35, "sine", 30, 0.02); break;
        case "pistol": sfx.pistol(); break;
        default: sfx.shoot();
      }
      // mecanismo: el cerrojo o la corredera después del disparo
      if (!far && fx.category === "shotgun") { noise(0.05, "bandpass", 1500, 0.2, 2, 4, 0.32); noise(0.05, "bandpass", 2100, 0.22, 2, 4, 0.46); }
      if (!far && fx.category === "sniper") { noise(0.05, "bandpass", 1800, 0.18, 2, 4, 0.5); noise(0.06, "bandpass", 1300, 0.2, 2, 4, 0.72); }
    }
    rate = 1; vol = 1;
  },
  /** Impacto de energía cercano: chisporroteo. */
  zap: (volume: number) => { vol = volume; noise(0.12, "highpass", 2600, 0.12, 2, 2); tone(420, 0.1, 0.08, "square", 120); vol = 1; },
  /** Bala que pasa cerca. */
  whizz: () => { noise(0.14, "bandpass", 2400, 0.16, 2, 6); tone(1800, 0.12, 0.05, "sine", 700); },
  switchWeapon: () => { noise(0.05, "bandpass", 1800, 0.18, 2, 3); noise(0.04, "bandpass", 2600, 0.15, 2, 4, 0.12); },
  remoteShot: (volume: number) => {
    noise(0.16, "lowpass", 900 + volume * 1200, 0.4 * volume, 2.5);
    tone(120, 0.1, 0.25 * volume, "sine", 50);
    noise(0.6, "bandpass", 350, 0.1 * volume, 1.2, 0.5, 0.05);
  },
  /** Confirmación de impacto: más grave y fuerte cuanto más daño. */
  hit: (head: boolean, damage = 20) => {
    const k = Math.min(1, damage / 90);
    tone(head ? 1500 : 1050 - k * 300, 0.05 + k * 0.04, 0.1 + k * 0.08, "triangle");
    if (head) tone(2250, 0.05, 0.06, "sine", undefined, 0.03);
  },
  kill: () => { tone(820, 0.07, 0.12, "triangle"); tone(1230, 0.12, 0.12, "triangle", undefined, 0.07); },
  hurt: () => { noise(0.12, "lowpass", 400, 0.35, 2); tone(90, 0.18, 0.25, "sine", 60); },
  reload: () => {
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
