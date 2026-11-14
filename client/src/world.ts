// Escena 3D: mapa, jugadores, arma y efectos.
import * as THREE from "three";
import { EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS } from "../../shared/src/constants";
import { MAP_BOXES, ARENA_HALF } from "../../shared/src/map";
import { HEAD_SIZE } from "../../shared/src/physics";

const PLAYER_COLORS = [0xff5d5d, 0x5da9ff, 0x6dff8a, 0xffd25d, 0xc77dff, 0x5dfff0, 0xff8ad8, 0xffffff];

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
  private gun = new THREE.Group();
  private muzzle: THREE.Mesh;
  private recoil = 0;
  private avatars = new Map<number, Avatar>();
  private effects: { obj: THREE.Object3D; life: number; max: number; fade?: THREE.Material }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x87a8d0);
    this.scene.fog = new THREE.Fog(0x87a8d0, 40, 140);

    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x3a3226, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
    sun.position.set(25, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -ARENA_HALF - 5;
    sc.right = sc.top = ARENA_HALF + 5;
    sc.near = 1;
    sc.far = 120;
    this.scene.add(sun);

    this.buildMap();

    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.muzzle = this.buildGun();
    this.camera.add(this.gun);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildMap() {
    // Suelo con cuadrícula
    const size = ARENA_HALF * 2;
    const tex = gridTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 4, size / 4);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size + 4, size + 4),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    for (const b of MAP_BOXES) {
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.8 }),
      );
      mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      // bordes para leer mejor la geometría
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
      );
      mesh.add(edges);
    }
  }

  private buildGun(): THREE.Mesh {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.5, metalness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6b3d, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), dark);
    barrel.position.set(0, 0.02, -0.38);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), accent);
    grip.position.set(0, -0.1, 0.1);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), accent);
    mag.position.set(0, -0.1, -0.08);
    this.gun.add(body, barrel, grip, mag);
    this.gun.position.set(0.2, -0.19, -0.5);
    this.gun.scale.setScalar(0.42);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a }),
    );
    flash.position.set(0, 0.02, -0.56);
    flash.visible = false;
    this.gun.add(flash);
    return flash;
  }

  /** Posición del cañón en coordenadas del mundo (para las trazadoras). */
  muzzleWorld(): THREE.Vector3 {
    return this.muzzle.getWorldPosition(new THREE.Vector3());
  }

  setView(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.camera.position.set(x, y + EYE_HEIGHT, z);
    this.camera.rotation.set(pitch, yaw, 0);
  }

  setGunVisible(v: boolean) {
    this.gun.visible = v;
  }

  kickGun() {
    this.recoil = 1;
    this.muzzle.visible = true;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe7a0) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ obj: line, life: 0.08, max: 0.08, fade: mat });

    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true }),
    );
    spark.position.copy(to);
    this.scene.add(spark);
    this.effects.push({ obj: spark, life: 0.15, max: 0.15, fade: spark.material });
  }

  // ---------- Avatares de los demás jugadores ----------

  upsertAvatar(id: number, name: string): Avatar {
    let a = this.avatars.get(id);
    if (!a) {
      a = new Avatar(id, name);
      this.avatars.set(id, a);
      this.scene.add(a.group);
    } else if (a.name !== name) {
      a.setName(name);
    }
    return a;
  }

  removeAvatar(id: number) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    this.avatars.delete(id);
  }

  avatarIds(): number[] {
    return [...this.avatars.keys()];
  }

  render(dt: number) {
    // retroceso del arma
    this.recoil = Math.max(0, this.recoil - dt * 12);
    this.gun.position.z = -0.5 + this.recoil * 0.04;
    this.gun.rotation.x = this.recoil * 0.12;
    if (this.recoil < 0.6) this.muzzle.visible = false;

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.fade) (e.fade as THREE.Material & { opacity: number }).opacity = Math.max(0, e.life / e.max);
      if (e.life <= 0) {
        this.scene.remove(e.obj);
        disposeObject(e.obj);
        this.effects.splice(i, 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export class Avatar {
  readonly group = new THREE.Group();
  private head: THREE.Group;
  private label: THREE.Sprite;
  name: string;

  constructor(readonly id: number, name: string) {
    this.name = name;
    const color = PLAYER_COLORS[id % PLAYER_COLORS.length];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2028, roughness: 0.7 });

    const bodyH = PLAYER_HEIGHT - HEAD_SIZE;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS * 0.9, bodyH - PLAYER_RADIUS * 1.8, 4, 10), mat);
    body.position.y = bodyH / 2;
    body.castShadow = true;

    this.head = new THREE.Group();
    this.head.position.y = bodyH + HEAD_SIZE / 2;
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, HEAD_SIZE + 0.05, 0.42), mat);
    headMesh.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x9be8ff }));
    visor.position.set(0, 0.03, -0.22);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), dark);
    gun.position.set(0.3, -0.35, -0.35);
    this.head.add(headMesh, visor, gun);

    this.label = makeLabel(name);
    this.label.position.y = PLAYER_HEIGHT + 0.45;

    this.group.add(body, this.head, this.label);
  }

  setName(name: string) {
    this.name = name;
    this.group.remove(this.label);
    this.label = makeLabel(name);
    this.label.position.y = PLAYER_HEIGHT + 0.45;
    this.group.add(this.label);
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.head.rotation.x = pitch;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }
}

function makeLabel(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 32px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#636a77";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillRect(64, 64, 64, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
