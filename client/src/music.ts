// Música generada por el juego (sin archivos): coros lentos en el menú y una base de tensión en la
// partida que sube cuando hay combate cerca y vuelve a la calma sola.
import { audioContext } from "./audio";

type Mode = "off" | "menu" | "game";

// Progresión en re menor (frecuencias de la fundamental de cada acorde y sus notas)
const CHORDS: number[][] = [
  [146.83, 174.61, 220.0, 293.66],  // Dm
  [116.54, 146.83, 174.61, 233.08], // Bb
  [130.81, 164.81, 196.0, 261.63],  // C
  [110.0, 138.59, 164.81, 220.0],   // A
];

let mode: Mode = "off";
let volume = 0.5;
let out: GainNode | null = null;
let timer: number | null = null;
let nextAt = 0;
let step = 0;
let tension = 0;
let voices: { stop: (t: number) => void }[] = [];

function output(a: AudioContext): GainNode {
  if (!out) {
    out = a.createGain();
    out.gain.value = volume * 0.5;
    const comp = a.createDynamicsCompressor();
    out.connect(comp).connect(a.destination);
  }
  return out;
}

/** Nota de "coro": varias sierras desafinadas por un filtro que se abre y se cierra despacio. */
function pad(a: AudioContext, freq: number, t: number, dur: number, gain: number, bright: number) {
  const g = a.createGain(), f = a.createBiquadFilter();
  f.type = "lowpass"; f.Q.value = 0.8;
  f.frequency.setValueAtTime(200, t);
  f.frequency.linearRampToValueAtTime(bright, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(220, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  for (const det of [-9, 0, 8]) {
    const o = a.createOscillator();
    o.type = "sawtooth"; o.frequency.value = freq; o.detune.value = det;
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
  f.connect(g).connect(output(a));
}

function thump(a: AudioContext, t: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(output(a)); o.start(t); o.stop(t + 0.32);
}

function pluck(a: AudioContext, freq: number, t: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
  o.type = "square"; o.frequency.value = freq;
  f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.18);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(f).connect(g).connect(output(a)); o.start(t); o.stop(t + 0.22);
}

function schedule() {
  const a = audioContext();
  if (!a || mode === "off" || volume <= 0) return;
  if (nextAt < a.currentTime) nextAt = a.currentTime + 0.1;
  // se programa con un segundo de margen
  while (nextAt < a.currentTime + 1.2) {
    if (mode === "menu") {
      // un acorde cada 6 s: bajo, coro y una voz aguda que va y viene
      const c = CHORDS[step % CHORDS.length];
      pad(a, c[0] / 2, nextAt, 7, 0.16, 500);
      for (const n of c.slice(1)) pad(a, n, nextAt + 0.3, 6.6, 0.07, 1300);
      if (step % 2 === 1) pad(a, c[3] * 2, nextAt + 2.5, 4, 0.03, 2400);
      nextAt += 6; step++;
    } else {
      // partida: nota grave sostenida + pulso que se acelera y se llena con la tensión
      const beat = 0.5 - tension * 0.16;
      const c = CHORDS[Math.floor(step / 16) % CHORDS.length];
      if (step % 8 === 0) pad(a, c[0] / 2, nextAt, beat * 8.4, 0.1 + tension * 0.05, 300 + tension * 500);
      if (tension > 0.12) {
        if (step % 2 === 0) thump(a, nextAt, 0.25 * tension + 0.05);
        if (tension > 0.35) pluck(a, c[0] * (step % 4 === 3 ? 1.5 : 1), nextAt, 0.07 * tension);
        if (tension > 0.7 && step % 4 === 0) pad(a, c[2] * 2, nextAt, beat * 4, 0.035, 2200);
      }
      nextAt += beat; step++;
      tension = Math.max(0, tension - 0.012);
    }
  }
}

export const music = {
  setMode(m: Mode) {
    if (m === mode) return;
    mode = m; step = 0; nextAt = 0; tension = 0;
    voices.forEach((v) => v.stop(0)); voices = [];
    if (timer === null) timer = window.setInterval(schedule, 250);
  },
  setVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    if (out) out.gain.value = volume * 0.5;
  },
  /** Algo pasó cerca (disparo, impacto, daño): la música se tensa. */
  bump(amount: number) { tension = Math.min(1, tension + amount); },
};

// Los navegadores no dejan sonar nada hasta el primer clic o tecla
const wake = () => { audioContext(); window.removeEventListener("pointerdown", wake); window.removeEventListener("keydown", wake); };
window.addEventListener("pointerdown", wake);
window.addEventListener("keydown", wake);
