// Catálogo de armas. Lo usan el servidor (reglas) y el cliente (modelos y menú).
// Los modelos de Sketchfab son CC Attribution: sus autores están en CREDITS.md.

export type Category = "rifle" | "smg" | "shotgun" | "sniper" | "pistol";

export interface WeaponModel {
  id: string;
  name: string;
  author: string;
  category: Category;
  futuristic: boolean;
  source: string;
}

export interface WeaponStats {
  damage: number;
  headshotDamage: number;
  fireIntervalTicks: number;
  semiAuto: boolean;
  range: number;
  magazine: number;
  reloadTicks: number;
  pellets: number; // perdigones por disparo (escopetas)
  spread: number; // dispersión en radianes
  zoomFov: number; // 0 = sin mira
}

/** Reglas base de cada tipo de arma. */
export const CATEGORY_STATS: Record<Category, WeaponStats> = {
  rifle: { damage: 20, headshotDamage: 40, fireIntervalTicks: 4, semiAuto: false, range: 120, magazine: 30, reloadTicks: 45, pellets: 1, spread: 0.008, zoomFov: 0 },
  smg: { damage: 14, headshotDamage: 28, fireIntervalTicks: 2, semiAuto: false, range: 60, magazine: 35, reloadTicks: 40, pellets: 1, spread: 0.022, zoomFov: 0 },
  shotgun: { damage: 12, headshotDamage: 18, fireIntervalTicks: 22, semiAuto: true, range: 40, magazine: 6, reloadTicks: 60, pellets: 8, spread: 0.075, zoomFov: 0 },
  sniper: { damage: 85, headshotDamage: 150, fireIntervalTicks: 36, semiAuto: true, range: 250, magazine: 5, reloadTicks: 70, pellets: 1, spread: 0.001, zoomFov: 18 },
  pistol: { damage: 26, headshotDamage: 52, fireIntervalTicks: 5, semiAuto: true, range: 80, magazine: 12, reloadTicks: 33, pellets: 1, spread: 0.01, zoomFov: 0 },
};

export const CATEGORY_NAMES: Record<Category, string> = {
  rifle: "Rifle de asalto", smg: "Subfusil", shotgun: "Escopeta", sniper: "Francotirador", pistol: "Pistola",
};

/** Armas que no vienen de Sketchfab. */
const BUILT_IN: WeaponModel[] = [
  { id: "service_pistol", name: "Pistola de servicio", author: "Poly Haven", category: "pistol", futuristic: false, source: "https://polyhaven.com/a/service_pistol" },
];

export const WEAPON_MODELS: WeaponModel[] = [
  ...BUILT_IN,
  { id: "9084c3bae8", name: "AK-74M Assault Rifle", author: "FJH", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-9084c3bae8224d338103997bc3101480" },
  { id: "f32fe06215", name: "AR-181", author: "Frostoise", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-f32fe06215434fb2a159d29343079a1e" },
  { id: "4b38c16024", name: "AR-H470", author: "Frostoise", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-4b38c160243743d681d6fdaf3bd77ddb" },
  { id: "dafa264a92", name: "AR77-90", author: "Frostoise", category: "rifle", futuristic: false, source: "https://sketchfab.com/3d-models/none-dafa264a92344b8e98277267b532ba79" },
  { id: "1b91aca44b", name: "Heavy Assault Rifle", author: "valerij1987", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-1b91aca44b65417f957d9ec30ce8ee19" },
  { id: "35faa51cc8", name: "Low poly sci fi Reaper impulse assault rifle", author: "Alexandr33D", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-35faa51cc8e74b489f875e858ab64cc0" },
  { id: "b569366927", name: "REPULZIVE PULZER", author: "Vijaysarathi", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-b569366927f54b4db69cd93bc6e96ebf" },
  { id: "eca46c628f", name: "Sci Fi Weapon. Gun", author: "gbarzu", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-eca46c628f49410081eb73391c62b4ca" },
  { id: "2d0d341097", name: "Sci-Fi AK Rifle gameready", author: "Egor Likhachev", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-2d0d3410970d49c6865d00be15048f72" },
  { id: "64a4261215", name: "Sci-Fi Rifle", author: "valterjherson1", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-64a4261215724f2bbe083ad916d4f770" },
  { id: "648a72a004", name: "Sci-Fi Rifle", author: "ul1tka", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-648a72a0046a4d059cd850f32f30f4ce" },
  { id: "9fcfabb9cf", name: "Sci-fi Assault Riffle", author: "Fearell", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-9fcfabb9cf5d4135bcb222f377de9a39" },
  { id: "5fc3a77cb8", name: "U-Rifle", author: "valerij1987", category: "rifle", futuristic: true, source: "https://sketchfab.com/3d-models/none-5fc3a77cb8de4f5bb01d5fa1b34c5b6c" },
  { id: "2e9bf75870", name: "Apec Tactical SMG", author: "ROHIT3DMODELS", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-2e9bf758703847c88d854fa204384203" },
  { id: "c503d96157", name: "HK MP5 (9mm submachine gun)", author: "quick_loop", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-c503d96157614fb78b5953d49e643b78" },
  { id: "3a5f98f75e", name: "SMG-M32", author: "Frostoise", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-3a5f98f75e804e5888379cbe640cc883" },
  { id: "85d319704e", name: "Submachine Gun", author: "J.J.West", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-85d319704eba40678af7e64df81ec58d" },
  { id: "6b2015ec3b", name: "VECTOR-P22", author: "Frostoise", category: "smg", futuristic: false, source: "https://sketchfab.com/3d-models/none-6b2015ec3bbd4e959487135493769190" },
  { id: "a564c7b0d4", name: "Quad Barrel Shotgun", author: "soidev", category: "shotgun", futuristic: false, source: "https://sketchfab.com/3d-models/none-a564c7b0d4194577baf49e6c5066635d" },
  { id: "6db0ad4764", name: "Remington 870 Shotgun", author: "Andrei Milin", category: "shotgun", futuristic: false, source: "https://sketchfab.com/3d-models/none-6db0ad4764d14eee8f063eea3600071b" },
  { id: "e0d23db5a8", name: "Shotgun Benelli M4", author: "drollShark", category: "shotgun", futuristic: false, source: "https://sketchfab.com/3d-models/none-e0d23db5a8b64ff2980875834b425c4b" },
  { id: "0d654ecfd3", name: "Dystopian Shotgun 24g", author: "Igor.Jop", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-0d654ecfd3164c68a624c6d42b0abe6e" },
  { id: "a556c647ec", name: "Prototype Energy Shotgun", author: "Rew", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-a556c647ecb74f2787007593cc9955f7" },
  { id: "11d1839686", name: "Quad Barrel Plasma Gun", author: "curichenkow", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-11d18396863242a19e29e0259755bfa9" },
  { id: "5929e6949d", name: "Sci-fi Super Shotgun", author: "tnnv", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-5929e6949d1e421e927116e117248f07" },
  { id: "d990b7bd78", name: "Sci-fi shotgun", author: "Eugen Vahrushin", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-d990b7bd78b7465085c9a90fa190e4fc" },
  { id: "8af55ec80e", name: "Scifi Shotgun", author: "willdudley", category: "shotgun", futuristic: true, source: "https://sketchfab.com/3d-models/none-8af55ec80e4c49b4b8218eb3d6e32fab" },
  { id: "56da18745f", name: "DKS-501 Sniper Rifle", author: "TrevorLaws", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-56da18745f744175841e54e81b5d5d7b" },
  { id: "e88c90c8e2", name: "Kar98k", author: "Danya", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-e88c90c8e203401fa28e8f4ef03e657f" },
  { id: "45c99509f1", name: "Modern Sniper Rifle", author: "Vlasov Daniil", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-45c99509f1ee4c2a8c9c3336d3e2ff5a" },
  { id: "cdefd833b4", name: "Sniper", author: "DJMaesen", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-cdefd833b4b5407ba32c53c9e7f50cae" },
  { id: "e520b23414", name: "Sniper rifle", author: "pashtetuser", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-e520b234140049e7890db0b6c29d3925" },
  { id: "2a38f8e36c", name: "VSK-94", author: "valterjherson1", category: "sniper", futuristic: false, source: "https://sketchfab.com/3d-models/none-2a38f8e36cae4952b6f04ec27b6c60da" },
  { id: "d6861fe22e", name: "R7-X Sniper", author: "Bl4ckGh0st", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-d6861fe22edf4b4884e87daa66d7deea" },
  { id: "1bfcf07c52", name: "RENEGADE Rail Gun", author: "Bl4ckGh0st", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-1bfcf07c52914e55a5853e6835d917f5" },
  { id: "bf19b2ff1c", name: "Sci fi Sniper Rifle", author: "pasquill", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-bf19b2ff1cf54f1a8038040c4aa5d913" },
  { id: "2d1bef3aa9", name: "Sci-FI Sniper Rifle", author: "Matija Švaco", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-2d1bef3aa9ae47c5aee26cc3f032ab31" },
  { id: "dafa37e039", name: "Sniper Railgun Mk-3", author: "ReiSakisaka", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-dafa37e0394b44399929aced2dbcd264" },
  { id: "b00986dc8f", name: "Sniper Rifle Futuristic", author: "trolosqlfod", category: "sniper", futuristic: true, source: "https://sketchfab.com/3d-models/none-b00986dc8fe649319d3e934a288c3bb9" },
  { id: "54c52df11e", name: "Pistol", author: "SINNIK", category: "pistol", futuristic: true, source: "https://sketchfab.com/3d-models/none-54c52df11e164b42992a7d418d99cd3f" },
  { id: "fab28aeb14", name: "Sci-Fi Pistol", author: "Andrei Milin", category: "pistol", futuristic: true, source: "https://sketchfab.com/3d-models/none-fab28aeb14894752b49149ef00926aff" },
  { id: "a454d9835c", name: "Sci-Fi Style Pneumatic Revolver RX-ZCS", author: "valterjherson1", category: "pistol", futuristic: true, source: "https://sketchfab.com/3d-models/none-a454d9835c7344f59676b76d8f2dfdf7" },
  { id: "c23394d709", name: "Sci-fi pistol", author: "Eugen Vahrushin", category: "pistol", futuristic: true, source: "https://sketchfab.com/3d-models/none-c23394d709d14772adf355da84408edc" },
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
  const base = CATEGORY_STATS[m.category];
  const v = variation(m.id, 7);
  // Más daño = algo más lento; las futuristas pegan un poco más fuerte pero tienen menos balas
  const dmgK = 0.92 + v * 0.16 + (m.futuristic ? 0.06 : 0);
  const rateK = 0.9 + v * 0.2;
  const magK = m.futuristic ? 0.85 : 1;
  return {
    ...base,
    damage: Math.round(base.damage * dmgK),
    headshotDamage: Math.round(base.headshotDamage * dmgK),
    fireIntervalTicks: Math.max(1, Math.round(base.fireIntervalTicks * rateK)),
    magazine: Math.max(1, Math.round(base.magazine * magK)),
  };
}

export const DEFAULT_PRIMARY = "f32fe06215"; // AR-181
export const DEFAULT_SECONDARY = "service_pistol";

/** Valida una elección del cliente: si no es válida, se usa la predeterminada. */
export function validLoadout(primary: unknown, secondary: unknown): [string, string] {
  const p = typeof primary === "string" ? BY_ID.get(primary) : undefined;
  const s = typeof secondary === "string" ? BY_ID.get(secondary) : undefined;
  return [
    p && p.category !== "pistol" ? p.id : DEFAULT_PRIMARY,
    s && s.category === "pistol" ? s.id : DEFAULT_SECONDARY,
  ];
}
