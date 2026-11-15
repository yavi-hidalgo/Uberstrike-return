// Tipos mínimos de n8ao (la librería no trae declaraciones).
declare module "n8ao" {
  import type { Camera, Scene } from "three";
  import { Pass } from "postprocessing";
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; gammaCorrection: boolean;
      aoSamples: number; denoiseSamples: number; denoiseRadius: number; color: import("three").Color; screenSpaceRadius: boolean;
    };
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
  }
}
