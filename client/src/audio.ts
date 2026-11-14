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

function noise(duration: number, type: BiquadFilterType, freq: number, gain: number, decay = 2, q = 0.7, delay = 0) {
  const a = ac();
  if (!a || !master) return;
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
  switchWeapon: () => { noise(0.05, "bandpass", 1800, 0.18, 2, 3); noise(0.04, "bandpass", 2600, 0.15, 2, 4, 0.12); },
  remoteShot: (volume: number) => {
    noise(0.16, "lowpass", 900 + volume * 1200, 0.4 * volume, 2.5);
    tone(120, 0.1, 0.25 * volume, "sine", 50);
    noise(0.6, "bandpass", 350, 0.1 * volume, 1.2, 0.5, 0.05);
  },
  hit: (head: boolean) => tone(head ? 1500 : 1000, 0.05, 0.1, "triangle"),
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
