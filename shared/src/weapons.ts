// Catálogo de armas. Lo usan el servidor (reglas) y el cliente (modelos y menú).
// Los modelos de Sketchfab son CC Attribution: sus autores están en CREDITS.md.

export type Category = "rifle" | "smg" | "shotgun" | "sniper" | "pistol" | "melee" | "cannon";
export type MeleeClass = "light" | "medium" | "heavy";
export type CannonKind = "rocket" | "plasma" | "rail" | "minigun";

export interface WeaponModel {
  id: string;
  name: string;
  author: string;
  category: Category;
  futuristic: boolean;
  source: string;
  /** Arma blanca: ligera (rápida), media o pesada (lenta y fuerte). */
  melee?: MeleeClass;
  /** Cañón: cohete o plasma (proyectil con explosión), riel (rayo) o minigun. */
  cannon?: CannonKind;
  /** Pack de brazos animados en primera persona (los demás jugadores ven `thirdPerson`). */
  arms?: { thirdPerson: string; back: number; up: number; arm: number; muzzle: [number, number, number] };
}

export interface WeaponStats {
  damage: number;
  headshotDamage: number;
  fireIntervalTicks: number;
  semiAuto: boolean; // hay que soltar el gatillo entre disparos
  range: number;
  magazine: number;
  reloadTicks: number;
  pellets: number; // perdigones por disparo (escopetas)
  spread: number; // dispersión apuntando y quieto (radianes)
  hipK: number; // multiplicador de dispersión sin apuntar
  bloom: number; // cuánto se abre la mira con cada disparo (0..1)
  bloomK: number; // dispersión extra con la mira totalmente abierta (multiplicador)
  moveSpread: number; // dispersión extra corriendo a toda velocidad (radianes)
  zoomFov: number; // campo de visión al apuntar (clic derecho)
  scope: boolean; // mira telescópica a pantalla completa
  falloffStart: number; // hasta esta distancia hace el daño completo (m)
  falloffEnd: number; // desde esta distancia hace el daño mínimo (m)
  falloffMin: number; // fracción del daño a larga distancia
  energy: boolean; // arma de energía: sin caída de daño ni casquillos
  /** Multiplicador de velocidad al llevarla en la mano. */
  speedK: number;
  /** Arma blanca: alcance del golpe en metros (0 = no es arma blanca). */
  meleeRange: number;
  /** Proyectil con explosión (cañones de cohete y plasma). */
  projectile: { speed: number; radius: number; gravity: number; splash: number } | null;
}

/** Reglas base de cada tipo de arma. */
const base = (o: Partial<WeaponStats> & Pick<WeaponStats, "damage" | "headshotDamage" | "fireIntervalTicks" | "range" | "magazine" | "reloadTicks">): WeaponStats => ({
  semiAuto: false, pellets: 1, spread: 0.005, hipK: 2, bloom: 0.1, bloomK: 2, moveSpread: 0.01, zoomFov: 55, scope: false,
  falloffStart: 30, falloffEnd: 80, falloffMin: 0.6, energy: false, speedK: 1, meleeRange: 0, projectile: null, ...o,
});
export const CATEGORY_STATS: Record<Category, WeaponStats> = {
  // Rifle: preciso apuntando, se descontrola en ráfagas largas, buen alcance
  rifle: base({ damage: 20, headshotDamage: 40, fireIntervalTicks: 4, range: 120, magazine: 30, reloadTicks: 45, spread: 0.004, hipK: 2.5, bloom: 0.11, bloomK: 3, moveSpread: 0.012, zoomFov: 50, falloffStart: 35, falloffEnd: 90, falloffMin: 0.6 }),
  // Subfusil: rapidísimo y manejable en movimiento, pero pierde fuerza enseguida con la distancia
  smg: base({ damage: 14, headshotDamage: 24, fireIntervalTicks: 2, range: 60, magazine: 35, reloadTicks: 40, spread: 0.012, hipK: 1.5, bloom: 0.055, bloomK: 1.8, moveSpread: 0.005, zoomFov: 58, falloffStart: 12, falloffEnd: 42, falloffMin: 0.4 }),
  // Escopeta: devastadora de cerca, casi inútil de lejos
  shotgun: base({ damage: 13, headshotDamage: 18, fireIntervalTicks: 22, semiAuto: true, range: 45, magazine: 6, reloadTicks: 60, pellets: 8, spread: 0.065, hipK: 1.15, bloom: 0, bloomK: 0, moveSpread: 0.004, zoomFov: 62, falloffStart: 7, falloffEnd: 26, falloffMin: 0.22 }),
  // Francotirador: un tiro certero con la mira; sin mira casi no acierta
  sniper: base({ damage: 85, headshotDamage: 150, fireIntervalTicks: 36, semiAuto: true, range: 250, magazine: 5, reloadTicks: 70, spread: 0.0006, hipK: 70, bloom: 1, bloomK: 0, moveSpread: 0.03, zoomFov: 18, scope: true, falloffStart: 250, falloffEnd: 251, falloffMin: 1 }),
  // Pistola: precisa tiro a tiro, se abre si se dispara muy rápido
  pistol: base({ damage: 26, headshotDamage: 52, fireIntervalTicks: 5, semiAuto: true, range: 80, magazine: 12, reloadTicks: 33, spread: 0.006, hipK: 1.8, bloom: 0.22, bloomK: 2.5, moveSpread: 0.008, zoomFov: 56, falloffStart: 18, falloffEnd: 50, falloffMin: 0.5 }),
  // Arma blanca (valores de la clase media; ver MELEE_CLASS)
  melee: base({ damage: 65, headshotDamage: 65, fireIntervalTicks: 15, semiAuto: false, range: 2.6, magazine: 0, reloadTicks: 0, spread: 0, hipK: 1, bloom: 0, bloomK: 0, moveSpread: 0, zoomFov: 0, falloffStart: 99, falloffEnd: 100, falloffMin: 1, speedK: 1.1, meleeRange: 2.6 }),
  // Cañón (valores del lanzacohetes; ver CANNON_KIND)
  cannon: base({ damage: 110, headshotDamage: 110, fireIntervalTicks: 36, semiAuto: true, range: 150, magazine: 4, reloadTicks: 80, spread: 0, hipK: 1, bloom: 0, bloomK: 0, moveSpread: 0.004, zoomFov: 50, falloffStart: 999, falloffEnd: 1000, falloffMin: 1, speedK: 0.92, projectile: { speed: 38, radius: 5, gravity: 0, splash: 95 } }),
};

/** Clases de arma blanca: las ligeras golpean rápido, las pesadas pegan más y llegan más lejos. */
export const MELEE_CLASS: Record<MeleeClass, Partial<WeaponStats>> = {
  light: { damage: 45, headshotDamage: 45, fireIntervalTicks: 10, meleeRange: 2.3, range: 2.3, speedK: 1.14 },
  medium: { damage: 65, headshotDamage: 65, fireIntervalTicks: 15, meleeRange: 2.6, range: 2.6, speedK: 1.1 },
  heavy: { damage: 90, headshotDamage: 90, fireIntervalTicks: 23, meleeRange: 2.9, range: 2.9, speedK: 1.06 },
};

/** Tipos de cañón. `damage` es el impacto directo; `splash` el daño máximo de la explosión. */
export const CANNON_KIND: Record<CannonKind, Partial<WeaponStats>> = {
  // Cohete: lento, explosión grande
  rocket: {},
  // Plasma: proyectil rápido, explosión pequeña, dispara más seguido
  plasma: { damage: 55, headshotDamage: 55, fireIntervalTicks: 16, magazine: 8, reloadTicks: 65, speedK: 0.96, projectile: { speed: 70, radius: 2.6, gravity: 0, splash: 45 } },
  // Riel: rayo instantáneo muy potente, sin explosión, recarga lenta
  rail: { damage: 95, headshotDamage: 140, fireIntervalTicks: 40, magazine: 3, reloadTicks: 75, range: 220, spread: 0.0015, hipK: 4, zoomFov: 34, speedK: 0.95, projectile: null },
  // Minigun: lluvia de balas, cargador enorme, te vuelve lento
  minigun: { damage: 11, headshotDamage: 18, fireIntervalTicks: 1, semiAuto: false, magazine: 150, reloadTicks: 110, range: 90, spread: 0.02, hipK: 1.4, bloom: 0.01, bloomK: 0.8, moveSpread: 0.012, zoomFov: 60, falloffStart: 20, falloffEnd: 70, falloffMin: 0.5, speedK: 0.8, projectile: null },
};

/** Dispersión real de un disparo según cómo se esté moviendo y disparando el jugador. */
export function effectiveSpread(w: WeaponStats, o: { aiming: boolean; bloom: number; speed: number; onGround: boolean }): number {
  const move = Math.min(1, o.speed / 8.8) * w.moveSpread + (o.onGround ? 0 : w.moveSpread * 1.5);
  return w.spread * (o.aiming ? 1 : w.hipK) * (1 + o.bloom * w.bloomK) + move * (o.aiming ? 0.6 : 1);
}

/** Fracción del daño a una distancia dada. */
export function damageFalloff(w: WeaponStats, dist: number): number {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  return 1 - (1 - w.falloffMin) * ((dist - w.falloffStart) / (w.falloffEnd - w.falloffStart));
}

/** Cuánto se cierra la mira en cada tick sin disparar. */
export const BLOOM_RECOVERY = 0.045;

export const CATEGORY_NAMES: Record<Category, string> = {
  rifle: "Rifle de asalto", smg: "Subfusil", shotgun: "Escopeta", sniper: "Francotirador", pistol: "Pistola", melee: "Arma blanca", cannon: "Cañón",
};

export const WEAPON_MODELS: WeaponModel[] = [
  { id: "f32fe06215", name: "AR-181", author: "Frostoise", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-f32fe06215434fb2a159d29343079a1e" },
  { id: "4b38c16024", name: "AR-H470", author: "Frostoise", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-4b38c160243743d681d6fdaf3bd77ddb" },
  { id: "2d0d341097", name: "Sci-Fi AK Rifle gameready", author: "Egor Likhachev", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-2d0d3410970d49c6865d00be15048f72" },
  { id: "64a4261215", name: "Sci-Fi Rifle", author: "valterjherson1", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-64a4261215724f2bbe083ad916d4f770" },
  { id: "9fcfabb9cf", name: "Sci-fi Assault Riffle", author: "Fearell", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-9fcfabb9cf5d4135bcb222f377de9a39" },
  { id: "5fc3a77cb8", name: "U-Rifle", author: "valerij1987", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-5fc3a77cb8de4f5bb01d5fa1b34c5b6c" },
  { id: "2e9bf75870", name: "Apec Tactical SMG", author: "ROHIT3DMODELS", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-2e9bf758703847c88d854fa204384203" },
  { id: "3a5f98f75e", name: "SMG-M32", author: "Frostoise", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-3a5f98f75e804e5888379cbe640cc883" },
  { id: "6b2015ec3b", name: "VECTOR-P22", author: "Frostoise", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-6b2015ec3bbd4e959487135493769190" },
  { id: "a564c7b0d4", name: "Quad Barrel Shotgun", author: "soidev", category: "shotgun", futuristic: false, source: "https://sketchfab.com/3d-models/none-a564c7b0d4194577baf49e6c5066635d" },
  { id: "6db0ad4764", name: "Remington 870 Shotgun", author: "Andrei Milin", category: "shotgun", futuristic: false, source: "https://sketchfab.com/3d-models/none-6db0ad4764d14eee8f063eea3600071b" },
  { id: "0d654ecfd3", name: "Dystopian Shotgun 24g", author: "Igor.Jop", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-0d654ecfd3164c68a624c6d42b0abe6e" },
  { id: "11d1839686", name: "Quad Barrel Plasma Gun", author: "curichenkow", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-11d18396863242a19e29e0259755bfa9" },
  { id: "5929e6949d", name: "Sci-fi Super Shotgun", author: "tnnv", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-5929e6949d1e421e927116e117248f07" },
  { id: "d6861fe22e", name: "R7-X Sniper", author: "Bl4ckGh0st", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-d6861fe22edf4b4884e87daa66d7deea" },
  { id: "1bfcf07c52", name: "RENEGADE Rail Gun", author: "Bl4ckGh0st", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-1bfcf07c52914e55a5853e6835d917f5" },
  { id: "2d1bef3aa9", name: "Sci-FI Sniper Rifle", author: "Matija Švaco", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-2d1bef3aa9ae47c5aee26cc3f032ab31" },
  { id: "dafa37e039", name: "Sniper Railgun Mk-3", author: "ReiSakisaka", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-dafa37e0394b44399929aced2dbcd264" },
  { id: "c23394d709", name: "Sci-fi pistol", author: "Eugen Vahrushin", category: "pistol", futuristic: true, source: "https://sketchfab.com/3d-models/none-c23394d709d14772adf355da84408edc" },
  { id: "0328770df6", name: "Honey Badger", author: "bagusmars", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-0328770df6fb4496ace40192b9d3793f" },
  { id: "187a36444a", name: "ARM-A1", author: "Frostoise", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-187a36444ab646438cff3ef1f6fa90db" },
  { id: "648847589f", name: "Sci-fi rifle M13-Gaus", author: "DigitalTales", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-648847589fec4ecc9b91d7cdcc9c4d84" },
  { id: "39f1767e68", name: "Subfusil futurista", author: "Anatomy by Doctor Jana", category: "smg", futuristic: true, source: "https://sketchfab.com/3d-models/none-39f1767e68834396b9ea1beea41c0abf" },
  { id: "9f37aafc02", name: "Minebea PM-9", author: "8sianDude", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-9f37aafc02f44e07967703c30e0ec22b" },
  { id: "bf79b7f1d4", name: "SV-98M Sniper rifle", author: "AlexFinsher", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-bf79b7f1d4304123823bb345848de80f" },
  { id: "32838f1430", name: "Desert Eagle", author: "javadbayat", category: "pistol", futuristic: false, source: "https://sketchfab.com/3d-models/none-32838f1430494894911b077ab281b6a7" },
  { id: "a2f03e4836", name: "Bullpup Revolver", author: "igor.tesV", category: "pistol", futuristic: false, source: "https://sketchfab.com/3d-models/none-a2f03e4836124c82a69098dd09fa726c" },
  { id: "c254bb8ee0", name: "Revólver Navy Colt 1851", author: "Johan Pindeville", category: "pistol", futuristic: false, source: "https://sketchfab.com/3d-models/none-c254bb8ee01a4d9db9e6bbdc652d6c11" },
  { id: "6e62a5c020", name: "Revólver", author: "Mik Santos", category: "pistol", futuristic: false, source: "https://sketchfab.com/3d-models/none-6e62a5c020024d47aac3782910e40d13" },
  { id: "778d3dfe4c", name: "Katana Oni Koroshi", author: "Sky_Hunter", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-778d3dfe4cc549dd93c9bdc5ad78a420", melee: "medium" },
  { id: "6b27a5a86d", name: "Soulsucker", author: "tuomaspaul", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-6b27a5a86dad4d13a6ff02ab5a1dcbce", melee: "heavy" },
  { id: "425e6efd8d", name: "Bate con clavos", author: "_", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-425e6efd8d81408fa63ff2c2962840d1", melee: "medium" },
  { id: "75ba882dd7", name: "Palanca", author: "Superior", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-75ba882dd7114eca8d58b73e303cd269", melee: "medium" },
  { id: "b91d507622", name: "Levitron, espadón", author: "Wawann", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-b91d50762282401cacbdbf8e563f8a4c", melee: "heavy" },
  { id: "48095b439e", name: "Bate", author: "Pablo88", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-48095b439ec5464db93337b2c3457fcc", melee: "medium" },
  { id: "340a3bed23", name: "Machete", author: "Belonosoff", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-340a3bed238f48b0aa169c38e1e75066", melee: "light" },
  { id: "80d9caaa1f", name: "Katana No Name", author: "Wawann", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-80d9caaa1fa04502af666135196456e1", melee: "light" },
  { id: "d0c12e5781", name: "Espadón futurista", author: "Kai Xiang", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-d0c12e5781b7400fb8268452cde79533", melee: "heavy" },
  { id: "e3caffae38", name: "Neon Blade", author: "Wawann", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-e3caffae38ff43aea3476cea700b6a00", melee: "medium" },
  { id: "5ea945cb4d", name: "Pala vieja", author: "Oliver Triplett", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-5ea945cb4d9a4bd387fb9d6ed74527f1", melee: "heavy" },
  { id: "0c15905a8d", name: "Espada futurista", author: "mazazaker", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-0c15905a8d51444b91a20ba2c311fbc2", melee: "medium" },
  { id: "23975f3cbb", name: "Katana futurista", author: "SkillingBlack21", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-23975f3cbb484a91b8c699a5bae9f1f8", melee: "light" },
  { id: "a402ec2c06", name: "Pala", author: "MaX3Dd", category: "melee", futuristic: false, source: "https://sketchfab.com/3d-models/none-a402ec2c06d04bd09b301c2a76d2f630", melee: "heavy" },
  { id: "b60ea3fea9", name: "Khopesh futurista", author: "valterjherson1", category: "melee", futuristic: true, source: "https://sketchfab.com/3d-models/none-b60ea3fea9fa4cecbbdb47b37db64f25", melee: "medium" },
  { id: "e2c072b894", name: "Lightgun improvisado", author: "Christian Rudorff", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-e2c072b89454484bace2b7675f7577a2", cannon: "plasma" },
  { id: "8f008c3e18", name: "Minigun M134", author: "Alexander_Borisevich", category: "cannon", futuristic: false, source: "https://sketchfab.com/3d-models/none-8f008c3e18934707a834cde8c72364f5", cannon: "minigun" },
  { id: "3cc4cac6aa", name: "Minigun futurista", author: "Andy B", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-3cc4cac6aa614f0fbe4a0c46db2a2c8e", cannon: "minigun" },
  { id: "3639c42106", name: "Capsule Gun", author: "sc8di", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-3639c42106334abab57d0592dae745df", cannon: "plasma" },
  { id: "aeaf541086", name: "C.A.T. Launcher 8999", author: "andrea.notarstefano", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-aeaf541086c441a899cbcbcd2b687f7a", cannon: "rocket" },
  { id: "bf7d92ee04", name: "Bazuca", author: "Shaz", category: "cannon", futuristic: false, source: "https://sketchfab.com/3d-models/none-bf7d92ee041b4506973841f46b14ce62", cannon: "rocket" },
  { id: "abfb7b6e09", name: "Cañón de mano Graviton", author: "Discover", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-abfb7b6e09584a52a13d36739ceb0e71", cannon: "plasma" },
  { id: "ca4d7709f4", name: "Cañón Scifi", author: "re1monsen", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-ca4d7709f49c45eeb4ffb5970c8c96d6", cannon: "plasma" },
  { id: "a8f7b77464", name: "Rayo láser EM-90A2", author: "Pippa", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-a8f7b774646a468ea2e4b411ef8c821a", cannon: "rail" },
  { id: "bdebc830ea", name: "Hand Cannon", author: "radka.t", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-bdebc830eab546bdb87c5026d02dfbfd", cannon: "plasma" },
  { id: "eb154eac33", name: "Cañón de riel", author: "Rzyas", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-eb154eac33bc4b5ebda83ea4652949fe", cannon: "rail" },
  { id: "77918335d5", name: "Lanzacohetes", author: "Miguel Adão", category: "cannon", futuristic: false, source: "https://sketchfab.com/3d-models/none-77918335d5554fbbb262f9b029a47267", cannon: "rocket" },
  { id: "9b3ee25dad", name: "Cañón de riel 02", author: "eyewhel3", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-9b3ee25dad804064854bf0cedfddb11c", cannon: "rail" },
  { id: "76590a6aab", name: "Mk-1", author: "o0ozexo0o", category: "cannon", futuristic: true, source: "https://sketchfab.com/3d-models/none-76590a6aabe6413f86c534496764df2d", cannon: "plasma" },
];

const BY_ID = new Map(WEAPON_MODELS.map((w) => [w.id, w]));

export function weaponModel(id: string): WeaponModel | undefined {
  return BY_ID.get(id);
}

/** Pequeña variación determinista por modelo (±10 %) para que cada arma se sienta distinta. */
function variation(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000; // 0..1
}

export function weaponStats(id: string): WeaponStats {
  const m = BY_ID.get(id) ?? BY_ID.get(DEFAULT_PRIMARY)!;
  const base: WeaponStats = { ...CATEGORY_STATS[m.category], ...(m.melee ? MELEE_CLASS[m.melee] : {}), ...(m.cannon ? CANNON_KIND[m.cannon] : {}) };
  const v = variation(m.id, 7);
  // Armas blancas y cañones: sus reglas salen de su clase; solo varía un poco el daño
  if (m.category === "melee" || m.category === "cannon") {
    const k = 0.95 + v * 0.1;
    return {
      ...base,
      damage: Math.round(base.damage * k),
      headshotDamage: Math.round(base.headshotDamage * k),
      energy: m.futuristic,
      projectile: base.projectile ? { ...base.projectile, splash: Math.round(base.projectile.splash * k) } : null,
    };
  }
  // Más daño = algo más lento; las futuristas pegan un poco más fuerte pero tienen menos balas
  const dmgK = 0.92 + v * 0.16 + (m.futuristic ? 0.06 : 0);
  // Las de energía no pierden daño con la distancia, a cambio de menos cadencia y cargador
  const rateK = 0.9 + v * 0.2 + (m.futuristic ? 0.08 : 0);
  const magK = m.futuristic ? 0.85 : 1;
  return {
    ...base,
    damage: Math.round(base.damage * dmgK),
    headshotDamage: Math.round(base.headshotDamage * dmgK),
    fireIntervalTicks: Math.max(1, Math.round(base.fireIntervalTicks * rateK)),
    magazine: Math.max(1, Math.round(base.magazine * magK)),
    energy: m.futuristic,
    falloffMin: m.futuristic ? Math.max(base.falloffMin, 0.9) : base.falloffMin,
  };
}

export const DEFAULT_PRIMARY = "f32fe06215"; // AR-181
export const DEFAULT_SECONDARY = "32838f1430"; // Desert Eagle
export const DEFAULT_MELEE = "778d3dfe4c"; // Katana

export type Loadout = [string, string, string];

/** Valida una elección del cliente: si no es válida, se usa la predeterminada. */
export function validLoadout(primary: unknown, secondary: unknown, melee?: unknown): Loadout {
  const p = typeof primary === "string" ? BY_ID.get(primary) : undefined;
  const s = typeof secondary === "string" ? BY_ID.get(secondary) : undefined;
  const m = typeof melee === "string" ? BY_ID.get(melee) : undefined;
  return [
    p && p.category !== "pistol" && p.category !== "melee" ? p.id : DEFAULT_PRIMARY,
    s && s.category === "pistol" ? s.id : DEFAULT_SECONDARY,
    m && m.category === "melee" ? m.id : DEFAULT_MELEE,
  ];
}
