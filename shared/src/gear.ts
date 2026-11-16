// Skins y equipo. El equipo se ve puesto en el personaje y suma vida máxima.
// Los modelos de Sketchfab son CC Attribution: sus autores están en CREDITS.md.

export type GearSlot = "helmet" | "vest" | "pack";

export interface Skin { id: string; name: string; author: string; source: string }
export interface GearItem { id: string; slot: GearSlot; name: string; author: string; source: string; hp: number }

export const SKINS: Skin[] = [
  { id: "swat", name: "SWAT", author: "SpatialNeglect", source: "https://sketchfab.com/3d-models/none-9e82fabf26194896b5ad4a364d864eab" },
  { id: "operator", name: "Operador", author: "SpatialNeglect", source: "https://sketchfab.com/3d-models/none-43a561e941704eefb1ab0614be4f0049" },
  { id: "tactical", name: "Soldado táctico", author: "DanlyVostok", source: "https://sketchfab.com/3d-models/none-850593a8c7114c188395ba1849a66eb9" },
  { id: "1b2d325edc", name: "Astronauta oscura", author: "Charles Cloutier", source: "https://sketchfab.com/3d-models/none-1b2d325edc814d068e920add2ecc8a32" },
  { id: "2e81554250", name: "Traje antirradiación", author: "sanyaork", source: "https://sketchfab.com/3d-models/none-2e815542505d48d8be91e9f7dbebfd0a" },
  { id: "137d62cd82", name: "Astronauta", author: "LasquetiSpice", source: "https://sketchfab.com/3d-models/none-137d62cd820a4a6eba75304a11fb6f81" },
  { id: "7949d8eb4d", name: "Piloto", author: "3DRaven", source: "https://sketchfab.com/3d-models/none-7949d8eb4d594f5ea4f524e0197a012b" },
  { id: "e9aa211b67", name: "Soldado ruso", author: "doctortex", source: "https://sketchfab.com/3d-models/none-e9aa211b67264dc086af1d2f4d4e3d84" },
  { id: "7c02e58adc", name: "Piloto Tantalus", author: "tegnemaskin", source: "https://sketchfab.com/3d-models/none-7c02e58adc654904a686095dee29c362" },
];

export const GEAR: GearItem[] = [
  { id: "009f007cd0", slot: "helmet", name: "Casco médico", author: "vanhalen3d", source: "https://sketchfab.com/3d-models/none-009f007cd0a240d1bc7b970157ef3df0", hp: 10 },
  { id: "5697331ee0", slot: "helmet", name: "Casco scifi", author: "kunkun", source: "https://sketchfab.com/3d-models/none-5697331ee00c4f13ad18005a6c82f7ef", hp: 14 },
  { id: "43e1596b75", slot: "helmet", name: "Casco de moto", author: "Tom Verbeeck", source: "https://sketchfab.com/3d-models/none-43e1596b7548478ab4a12ee433cedd5d", hp: 8 },
  { id: "7b095c71ce", slot: "helmet", name: "Casco espacial", author: "bluoppVR", source: "https://sketchfab.com/3d-models/none-7b095c71ce844118bf5fc9af2f3accd0", hp: 18 },
  { id: "315605194a", slot: "helmet", name: "Casco de astronauta", author: "Medhatelo", source: "https://sketchfab.com/3d-models/none-315605194a474c7b95cd2a9083985d22", hp: 16 },
  { id: "19b5c8574b", slot: "helmet", name: "Casco Sci-Fi", author: "circles", source: "https://sketchfab.com/3d-models/none-19b5c8574bb84229944d9753ff8bed38", hp: 15 },
  { id: "82adf37616", slot: "helmet", name: "Casco táctico con auriculares", author: "Exactly", source: "https://sketchfab.com/3d-models/none-82adf376164f4d99a4e0b2949930e2ad", hp: 20 },
  { id: "c707c7162a", slot: "helmet", name: "Casco Sci Fi negro", author: "CAPTAAINRO", source: "https://sketchfab.com/3d-models/none-c707c7162a134a36baea12338e3bf1a1", hp: 14 },
  { id: "df7b04e4f6", slot: "helmet", name: "Casco negro 2", author: "3DWorkbench", source: "https://sketchfab.com/3d-models/none-df7b04e4f6ba483e8fd536ad5cd52d22", hp: 12 },
  { id: "f35b65897c", slot: "helmet", name: "Kabuto", author: "Vala", source: "https://sketchfab.com/3d-models/none-f35b65897cc1478198a0a08c49dea263", hp: 18 },
  { id: "0dca440a0d", slot: "helmet", name: "Casco táctico V.I.P.R", author: "KallMor", source: "https://sketchfab.com/3d-models/none-0dca440a0d8649aabb1de9ca5b5f2d35", hp: 22 },
  { id: "a4d4ef2f17", slot: "helmet", name: "Casco de moto clásico", author: "zeleniy89", source: "https://sketchfab.com/3d-models/none-a4d4ef2f17c843828cf24d538a9edbd3", hp: 8 },
  { id: "d1cf5bcc3c", slot: "helmet", name: "Máscara de diseño", author: "oswaldo.madrid2012", source: "https://sketchfab.com/3d-models/none-d1cf5bcc3c4e4e03b7e8686ed8f75756", hp: 10 },
  { id: "8d4ac12671", slot: "helmet", name: "Máscara de gas", author: "stayalivedudexxx", source: "https://sketchfab.com/3d-models/none-8d4ac12671a0459b889a7ab631d9501e", hp: 9 },
  { id: "fb2230b152", slot: "helmet", name: "Casco negro", author: "3DWorkbench", source: "https://sketchfab.com/3d-models/none-fb2230b152824463a75e903d38d035a8", hp: 12 },
  { id: "10c5c86971", slot: "helmet", name: "Visor nocturno", author: "AntijnvanderGun", source: "https://sketchfab.com/3d-models/none-10c5c86971ff443caba9a7e2fe33abd1", hp: 6 },
  { id: "94701874d8", slot: "helmet", name: "Casco de combate K6-3", author: "shamanoff", source: "https://sketchfab.com/3d-models/none-94701874d8b949718708b018c8d4f61d", hp: 20 },
  { id: "cc510a8975", slot: "vest", name: "Chaleco militar", author: "kane_sk06", source: "https://sketchfab.com/3d-models/none-cc510a8975df43a3b34a5fbe5edc332b", hp: 35 },
  { id: "b0431f9c3c", slot: "vest", name: "Chaleco blindado", author: "3DWorkbench", source: "https://sketchfab.com/3d-models/none-b0431f9c3c724f9cbe0238f307c8cac0", hp: 30 },
  { id: "34a4d75cf7", slot: "vest", name: "Peto Sci-fi", author: "Mikesaz", source: "https://sketchfab.com/3d-models/none-34a4d75cf75f4543ba3b7a2bf3c6f48e", hp: 40 },
  { id: "a1a17b557c", slot: "vest", name: "Chaleco", author: "Santeri Riikonen", source: "https://sketchfab.com/3d-models/none-a1a17b557c464838b9e770d3d5099d54", hp: 22 },
  { id: "e00d974c4e", slot: "pack", name: "Mochila gris", author: "kj3987", source: "https://sketchfab.com/3d-models/none-e00d974c4e994e76a8f69e7e3fdf0a30", hp: 8 },
  { id: "b0b2ea8152", slot: "pack", name: "Mochila de asalto", author: "Pnuky", source: "https://sketchfab.com/3d-models/none-b0b2ea81529f46afaaff94f30bf0e954", hp: 12 },
  { id: "06be5c0f15", slot: "pack", name: "Mochila militar", author: "Neslihan Çakmak", source: "https://sketchfab.com/3d-models/none-06be5c0f15aa4aa3af8ebcc4c83d02a3", hp: 14 },
];

const SKIN_IDS = new Set(SKINS.map((s) => s.id));
const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

export const DEFAULT_SKIN = "e9aa211b67"; // Soldado ruso

/** Skins anteriores: ya traen su propio casco y chaleco modelados, así que el equipo no se dibuja encima. */
export const LEGACY_SKINS = ["swat", "operator", "tactical"];

/** Aspecto de un jugador: skin y equipo (cadena vacía = sin esa pieza). */
export interface Look { skin: string; helmet: string; vest: string; pack: string }

export function gearItem(id: string): GearItem | undefined { return GEAR_BY_ID.get(id); }

/** Valida el aspecto que pide el cliente; lo inválido se descarta. */
export function validLook(o: { skin?: unknown; helmet?: unknown; vest?: unknown; pack?: unknown } | undefined): Look {
  const piece = (v: unknown, slot: GearSlot) => (typeof v === "string" && GEAR_BY_ID.get(v)?.slot === slot ? v : "");
  return {
    skin: typeof o?.skin === "string" && SKIN_IDS.has(o.skin) ? o.skin : DEFAULT_SKIN,
    helmet: piece(o?.helmet, "helmet"), vest: piece(o?.vest, "vest"), pack: piece(o?.pack, "pack"),
  };
}

/** Vida extra que da el equipo puesto. */
export function gearHp(look: Look): number {
  return [look.helmet, look.vest, look.pack].reduce((sum, id) => sum + (GEAR_BY_ID.get(id)?.hp ?? 0), 0);
}
