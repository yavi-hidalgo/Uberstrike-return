// Texturas comprimidas KTX2 (Basis Universal): ocupan 4 a 8 veces menos memoria de video que un
// PNG, JPEG o WebP, porque la GPU las usa sin descomprimir. Un solo cargador para todo el juego.
import type * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

export const ktx2Loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);

let ready = false;

/** Detecta los formatos comprimidos que soporta la GPU. Hay que llamarlo antes de cargar modelos. */
export function initKTX2(renderer: THREE.WebGLRenderer) {
  if (ready) return;
  ktx2Loader.detectSupport(renderer);
  ready = true;
}
