// Cielo nocturno, luna, cordillera, mar de nubes y nieve que cae.
import * as THREE from "three";
import { softSprite } from "./textures";

export const MOON_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // siempre al fondo
}`;

const SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Degradado: horizonte azul grisáceo, cénit casi negro
  vec3 zenith = vec3(0.012, 0.018, 0.05);
  vec3 mid = vec3(0.04, 0.06, 0.15);
  vec3 horizon = vec3(0.16, 0.2, 0.34);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
  col = mix(col, zenith, smoothstep(0.25, 0.9, h));
  col = mix(col, vec3(0.08, 0.1, 0.17), smoothstep(0.0, -0.2, h));

  // Banda de la galaxia: polvo azul y violeta
  vec3 bandN = normalize(vec3(0.35, 0.25, 0.9));
  float band = exp(-pow(dot(d, bandN) / 0.22, 2.0));
  float dust = fbm(d * 5.0 + 3.0);
  float lanes = smoothstep(0.45, 0.75, fbm(d * 11.0));
  col += band * (vec3(0.09, 0.08, 0.16) * dust + vec3(0.05, 0.07, 0.12) * pow(dust, 3.0) * 2.0) * (1.0 - lanes * 0.6) * smoothstep(-0.05, 0.2, h);

  // Estrellas: celdas en una esfera, con titileo
  vec3 p = d * 260.0;
  vec3 cell = floor(p);
  float r = hash(cell);
  if (r > 0.985) {
    vec3 c = cell + vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1));
    float dist = length(p - c);
    float size = mix(0.08, 0.22, pow(hash(cell + 7.7), 4.0));
    float star = smoothstep(size, 0.0, dist);
    float tw = 0.75 + 0.25 * sin(uTime * (1.0 + hash(cell + 9.1) * 3.0) + r * 40.0);
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash(cell + 5.5));
    col += tint * star * tw * (1.0 + band * 1.5) * smoothstep(-0.02, 0.1, h) * 2.2;
  }

  // Luna y su halo
  float m = dot(d, normalize(uMoonDir));
  col += vec3(0.55, 0.65, 0.9) * pow(max(m, 0.0), 60.0) * 0.35;
  col += vec3(0.4, 0.5, 0.8) * pow(max(m, 0.0), 8.0) * 0.06;
  float disc = smoothstep(0.99955, 0.99975, m);
  float craters = 0.82 + 0.18 * fbm(d * 400.0);
  col = mix(col, vec3(1.0, 0.98, 0.92) * craters * 2.6, disc);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Environment {
  readonly group = new THREE.Group();
  private skyMat: THREE.ShaderMaterial;
  private snow: THREE.Points | null = null;
  private snowVel: Float32Array | null = null;
  private clouds: THREE.Mesh;

  constructor(snowCount: number) {
    // Cielo
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 }, uMoonDir: { value: MOON_DIR.clone() } },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);

    this.group.add(this.buildMountains());
    this.clouds = this.buildClouds();
    this.group.add(this.clouds);
    this.group.add(this.buildCliffs());
    if (snowCount > 0) this.buildSnow(snowCount);
  }

  /** Escena solo con el cielo, para generar la luz ambiental y los reflejos. */
  skyOnlyScene(): THREE.Scene {
    const s = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.skyMat);
    s.add(sky);
    return s;
  }

  private buildMountains(): THREE.Mesh {
    // Anillo de picos alrededor de la cumbre. Colores por vértice: roca y nieve.
    const rings = 90, segs = 420;
    const rIn = 70, rOut = 520;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const noise = (x: number, z: number) => {
      let s = 0, a = 1, f = 0.008;
      for (let i = 0; i < 7; i++) {
        s += a * (1 - Math.abs(Math.sin(x * f * 1.7 + Math.cos(z * f * 1.3) * 2) * Math.cos(z * f * 1.1 + Math.sin(x * f) * 1.5)));
        a *= 0.5; f *= 2.1;
      }
      return s / 1.9;
    };
    const rock = new THREE.Color(0x2b3442), rockDark = new THREE.Color(0x161c26), snow = new THREE.Color(0xc9d6ea);
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const r = rIn + (rOut - rIn) * Math.pow(t, 1.4);
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const ridge = noise(x, z);
        const envelope = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.85 + 0.15;
        let y = -55 + Math.pow(ridge, 2.2) * 150 * envelope + t * 20;
        if (t < 0.08) y = -60 - (1 - t / 0.08) * 20;
        pos.push(x, y, z);
        const snowAmt = THREE.MathUtils.smoothstep(y, 0, 25) * (0.6 + ridge * 0.6);
        const c = rock.clone().lerp(rockDark, 1 - ridge).lerp(snow, Math.min(1, snowAmt));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j, b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    mesh.receiveShadow = false;
    return mesh;
  }

  private buildClouds(): THREE.Mesh {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(200,210,235,0.22)");
      g.addColorStop(1, "rgba(200,210,235,0)");
      ctx.fillStyle = g;
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
        ctx.save(); ctx.translate(ox, oy); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(700, 64),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x8a9cc4, fog: true }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -38;
    return mesh;
  }

  private buildCliffs(): THREE.Group {
    // Paredes de roca bajo el borde de la arena, hacia el mar de nubes.
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(44, 30, 70, 10, 6, true);
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = Math.sin(x * 0.4 + y * 0.2) * Math.cos(z * 0.35 - y * 0.15);
      const k = 1 + n * 0.06 * (1 - (y + 35) / 70);
      p.setXYZ(i, x * k, y, z * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x252c37, roughness: 1, flatShading: true });
    const cliff = new THREE.Mesh(geo, mat);
    cliff.rotation.y = Math.PI / 10;
    cliff.position.y = -35.4;
    g.add(cliff);
    return g;
  }

  private buildSnow(count: number) {
    const pos = new Float32Array(count * 3);
    this.snowVel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 1] = Math.random() * 25;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
      this.snowVel[i] = 0.6 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.07, map: softSprite(), transparent: true, depthWrite: false,
      color: 0xdfe8ff, opacity: 0.85, sizeAttenuation: true,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  update(dt: number, time: number, cam: THREE.Vector3) {
    this.skyMat.uniforms.uTime.value = time;
    const map = (this.clouds.material as THREE.MeshBasicMaterial).map!;
    map.offset.x += dt * 0.002;
    map.offset.y += dt * 0.001;
    if (this.snow && this.snowVel) {
      const p = this.snow.geometry.getAttribute("position") as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      for (let i = 0; i < this.snowVel.length; i++) {
        let x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        y -= this.snowVel[i] * dt;
        x += Math.sin(time * 0.7 + i) * 0.25 * dt + 0.35 * dt;
        z += Math.cos(time * 0.5 + i * 1.7) * 0.2 * dt;
        // Mantener los copos en una caja alrededor de la cámara
        x = cam.x + ((((x - cam.x) + 25) % 50 + 50) % 50) - 25;
        z = cam.z + ((((z - cam.z) + 25) % 50 + 50) % 50) - 25;
        if (y < cam.y - 8) y += 25;
        if (y > cam.y + 17) y -= 25;
        a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
      }
      p.needsUpdate = true;
    }
  }
}
