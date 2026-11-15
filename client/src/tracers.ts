// Trazadoras: cada tipo de arma deja un rastro distinto.
//  - bullet / pellet: un destello corto que viaja del cañón al impacto.
//  - vapor: la bala del francotirador y, detrás, una estela pálida que tarda en disiparse.
//  - bolt: proyectil de energía de color, más lento y brillante.
//  - beam: rayo instantáneo que se apaga enseguida (escopeta de energía).
//  - rail: rayo grueso con núcleo blanco que se va afinando (cañón de riel).
import * as THREE from "three";
import type { WeaponFx } from "./fx";

interface Tracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  /** Largo del destello; 0 = rayo completo fijo. */
  streak: number;
  speed: number;
  travelled: number;
  life: number;
  max: number;
  width: number;
  opacity: number;
  onArrive?: () => void;
}

const UP = new THREE.Vector3(0, 0, 1);

export class Tracers {
  private list: Tracer[] = [];
  private geo: THREE.CylinderGeometry;

  constructor(private scene: THREE.Scene) {
    // cilindro unitario a lo largo de +Z, con la base en el origen
    this.geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.geo.rotateX(Math.PI / 2);
    this.geo.translate(0, 0, 0.5);
  }

  /** `onArrive` se llama cuando el proyectil llega al impacto (enseguida si el rayo es instantáneo). */
  add(from: THREE.Vector3, to: THREE.Vector3, fx: WeaponFx, onArrive?: () => void) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.05) { onArrive?.(); return; }
    dir.divideScalar(dist);
    const color = fx.energy ? fx.color : 0xffe2a8;
    const moving = (streak: number, speed: number, width: number, opacity: number, c = color, arrive = onArrive) =>
      this.push({ from, dir, dist, streak: Math.min(streak, dist), speed, width, opacity, color: c, life: dist / speed + 0.02, onArrive: arrive });
    const fixed = (life: number, width: number, opacity: number, c = color) =>
      this.push({ from, dir, dist, streak: 0, speed: 0, width, opacity, color: c, life });
    switch (fx.tracer) {
      case "bullet": moving(9, 320, fx.width, 0.9); break;
      case "pellet": moving(3.5, 210, fx.width, 0.75); break;
      case "vapor":
        moving(14, 520, fx.width, 1);
        fixed(0.75, 0.016, 0.3, 0xdde6f0);
        break;
      case "bolt":
        moving(4.5, 150, fx.width, 1);
        moving(1.2, 150, fx.width * 0.45, 1, 0xffffff, undefined); // núcleo blanco
        break;
      case "beam":
        fixed(0.16, fx.width, 0.85);
        onArrive?.();
        break;
      case "rail":
        fixed(0.7, fx.width, 0.7);
        fixed(0.35, fx.width * 0.35, 1, 0xffffff);
        onArrive?.();
        break;
    }
  }

  private push(o: { from: THREE.Vector3; dir: THREE.Vector3; dist: number; streak: number; speed: number; width: number; opacity: number; color: number; life: number; onArrive?: () => void }) {
    const mat = new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: o.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.quaternion.setFromUnitVectors(UP, o.dir);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const t: Tracer = { mesh, mat, from: o.from.clone(), dir: o.dir, dist: o.dist, streak: o.streak, speed: o.speed, travelled: 0, life: o.life, max: o.life, width: o.width, opacity: o.opacity, onArrive: o.onArrive };
    this.place(t);
    this.list.push(t);
    if (this.list.length > 90) this.remove(0);
  }

  private place(t: Tracer) {
    if (t.streak > 0) {
      const head = Math.min(t.dist, t.travelled + t.streak);
      const tail = Math.max(0, head - t.streak);
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.set(t.width, t.width, Math.max(0.01, head - tail));
    } else {
      const k = t.life / t.max;
      t.mesh.position.copy(t.from);
      t.mesh.scale.set(t.width * (0.35 + 0.65 * k), t.width * (0.35 + 0.65 * k), t.dist);
      t.mat.opacity = t.opacity * k;
    }
  }

  private remove(i: number) {
    const t = this.list[i];
    t.onArrive?.();
    this.scene.remove(t.mesh);
    t.mat.dispose();
    this.list.splice(i, 1);
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.life -= dt;
      if (t.streak > 0) {
        t.travelled += t.speed * dt;
        if (t.travelled + t.streak >= t.dist && t.onArrive) { const f = t.onArrive; t.onArrive = undefined; f(); }
        if (t.travelled >= t.dist) { this.remove(i); continue; }
      } else if (t.life <= 0) { this.remove(i); continue; }
      this.place(t);
    }
  }
}
