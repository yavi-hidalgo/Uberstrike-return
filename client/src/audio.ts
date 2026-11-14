// Sonidos sintetizados con Web Audio (sin archivos externos).
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBurst(duration: number, freq: number, gain: number) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
}

function beep(freq: number, duration: number, gain: number, type: OscillatorType = "square") {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + duration);
}

export const sfx = {
  unlock: () => void ac(),
  shoot: () => noiseBurst(0.12, 2600, 0.35),
  remoteShot: (volume: number) => noiseBurst(0.12, 1400, 0.25 * volume),
  hit: (head: boolean) => beep(head ? 1400 : 900, 0.06, 0.12),
  kill: () => { beep(700, 0.08, 0.12, "triangle"); setTimeout(() => beep(1050, 0.12, 0.12, "triangle"), 70); },
  hurt: () => beep(140, 0.15, 0.2, "sawtooth"),
  reload: () => { beep(320, 0.04, 0.08); setTimeout(() => beep(480, 0.04, 0.08), 500); },
};
