// Carga los modelos de arma. Todos salen con el mismo formato:
// cañón hacia -Z, arriba +Y, centrados y con su tamaño real (metros).
import * as THREE from "three";
import { ktx2Loader } from "./ktx";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildKestrel } from "./weapon";
import { pistolModel } from "./props";
import { weaponModel } from "../../shared/src/weapons";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setKTX2Loader(ktx2Loader);
const templates = new Map<string, Promise<THREE.Object3D | null>>();

function center(o: THREE.Object3D): THREE.Object3D {
  const g = new THREE.Group();
  g.add(o);
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  o.position.sub(c);
  return g;
}

function prepare(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false; // el arma en primera persona está pegada a la cámara
  });
}

async function loadTemplate(id: string): Promise<THREE.Object3D | null> {
  if (id === "kestrel") {
    const k = buildKestrel().group;
    k.scale.setScalar(0.82);
    return center(k);
  }
  if (id === "service_pistol") {
    const p = pistolModel();
    if (!p) return null;
    p.rotation.y = Math.PI / 2; // el modelo de Poly Haven apunta a +X
    return center(p);
  }
  // Las armas con brazos se ven en manos de los demás con un modelo suelto equivalente
  const arms = weaponModel(id)?.arms;
  if (arms) return loadTemplate(arms.thirdPerson);
  try {
    const g = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/weapons/${id}.glb`);
    return center(g.scene);
  } catch (e) {
    console.warn(`No se pudo cargar el arma ${id}`, e);
    return null;
  }
}

/** Devuelve una copia del modelo del arma (o null si falla). */
export async function weaponObject(id: string): Promise<THREE.Object3D | null> {
  let t = templates.get(id);
  if (!t) {
    t = loadTemplate(id);
    templates.set(id, t);
  }
  const tpl = await t;
  if (!tpl) return null;
  const c = tpl.clone(true);
  prepare(c);
  return c;
}

/** Puntos de referencia del arma a partir de su caja: cañón, ventana de expulsión y tamaño. */
export function weaponAnchors(o: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  return {
    size,
    box,
    muzzle: new THREE.Vector3(0, box.min.y + size.y * 0.72, box.min.z - 0.01),
    ejector: new THREE.Vector3(0.03, box.min.y + size.y * 0.7, box.min.z + size.z * 0.55),
  };
}
