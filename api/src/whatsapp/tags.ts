import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { nombresMotivosCatalogo } from "./motivos-catalogo.js";
import { listLocalSyntheticTags } from "./prueba-local-store.js";

export type WaTagGroup = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type WaTag = {
  id: string;
  name: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
};

export type WaTagCatalog = {
  groups: WaTagGroup[];
  items: WaTag[];
};

const TAGS_DOC = doc(firestore, "ordenes_config", "whatsapp_tags");
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#a61948";

function normalizeColor(raw: unknown, fallback = DEFAULT_COLOR): string {
  const color = String(raw ?? "").trim().toLowerCase();
  return COLOR_RE.test(color) ? color : fallback;
}

function normalizeGroup(raw: unknown, fallbackColor = DEFAULT_COLOR): WaTagGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    color: normalizeColor(row.color, fallbackColor),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function normalizeItem(raw: unknown): WaTag | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    groupId: String(row.groupId ?? "").trim(),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function legacyItemColor(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const color = String((raw as Record<string, unknown>).color ?? "").trim().toLowerCase();
  return COLOR_RE.test(color) ? color : null;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

async function readCatalog(opts?: { onQuota?: "empty" | "throw" }): Promise<WaTagCatalog> {
  let snap;
  try {
    snap = await getDoc(TAGS_DOC);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(msg)) {
      if (opts?.onQuota === "throw") throw error;
      return { groups: [], items: [] };
    }
    throw error;
  }
  const data = snap.exists() ? snap.data() : {};
  const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
  const rawItems = Array.isArray(data?.items) ? data.items : [];

  const legacyColors = new Map<string, string>();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const groupId = String(row.groupId ?? "").trim();
    const color = legacyItemColor(raw);
    if (groupId && color && !legacyColors.has(groupId)) legacyColors.set(groupId, color);
  }

  const items = sortByName(
    rawItems.map(normalizeItem).filter((item): item is WaTag => item !== null),
  );
  const groups = sortByName(
    rawGroups
      .map((raw) => {
        const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
        const groupId = String(row?.id ?? "").trim();
        return normalizeGroup(raw, legacyColors.get(groupId) ?? DEFAULT_COLOR);
      })
      .filter((item): item is WaTagGroup => item !== null),
  );

  const needsMigrate =
    rawGroups.some((raw) => {
      if (!raw || typeof raw !== "object") return false;
      return !COLOR_RE.test(String((raw as Record<string, unknown>).color ?? "").trim());
    }) || rawItems.some((raw) => legacyItemColor(raw) !== null);

  const catalog = { groups, items };
  if (needsMigrate && (groups.length > 0 || items.length > 0 || rawGroups.length > 0)) {
    await writeCatalog(catalog);
  }
  return catalog;
}

async function writeCatalog(catalog: WaTagCatalog): Promise<void> {
  await setDoc(
    TAGS_DOC,
    {
      groups: catalog.groups,
      items: catalog.items,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function listWhatsappTagCatalog(): Promise<WaTagCatalog> {
  const catalog = await readCatalog();
  const sinteticos = listLocalSyntheticTags();
  if (!sinteticos.length) return catalog;
  const conocidos = new Set(catalog.items.map((item) => item.id));
  const extra: WaTag[] = sinteticos
    .filter((item) => !conocidos.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      groupId: "",
      createdAt: "",
      updatedAt: "",
    }));
  if (!extra.length) return catalog;
  return { ...catalog, items: sortByName([...catalog.items, ...extra]) };
}

const MENU_TAG_GROUP = "Bot menú";
const MENU_TAG_COLOR = "#2f6fed";
const DIAG_TAG_GROUP = "Diagnóstico";
const DIAG_TAG_COLOR = "#0d9488";

function sinTildesTag(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

const diagnosticoNombresSet = () =>
  new Set(nombresMotivosCatalogo().map((n) => sinTildesTag(n)));

async function ensureGroup(
  catalog: WaTagCatalog,
  name: string,
  color: string,
  now: string,
): Promise<{ catalog: WaTagCatalog; grupo: WaTagGroup; cambio: boolean }> {
  let grupo = catalog.groups.find((g) => sinTildesTag(g.name) === sinTildesTag(name));
  if (grupo) return { catalog, grupo, cambio: false };
  grupo = {
    id: randomUUID(),
    name,
    color,
    createdAt: now,
    updatedAt: now,
  };
  return {
    catalog: { ...catalog, groups: [...catalog.groups, grupo] },
    grupo,
    cambio: true,
  };
}

/**
 * Crea/mueve etiquetas al grupo indicado. Si ya existen por nombre, las deja
 * (o las mueve al grupo si `moveExisting`).
 */
export async function ensureWhatsappTagsInGroup(
  nombres: string[],
  groupName: string,
  groupColor: string,
  opts?: { moveExisting?: boolean },
): Promise<WaTagCatalog> {
  const pedidos = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  if (!pedidos.length) return readCatalog();

  let catalog = await readCatalog();
  const now = new Date().toISOString();
  let cambio = false;

  const ensured = await ensureGroup(catalog, groupName, groupColor, now);
  catalog = ensured.catalog;
  const grupo = ensured.grupo;
  if (ensured.cambio) cambio = true;

  const items = [...catalog.items];
  for (const nombre of pedidos) {
    const clave = sinTildesTag(nombre);
    const idx = items.findIndex((item) => sinTildesTag(item.name) === clave);
    if (idx >= 0) {
      const actual = items[idx]!;
      if (opts?.moveExisting && actual.groupId !== grupo.id) {
        items[idx] = { ...actual, groupId: grupo.id, updatedAt: now };
        cambio = true;
      }
      continue;
    }
    items.push({
      id: randomUUID(),
      name: nombre,
      groupId: grupo.id,
      createdAt: now,
      updatedAt: now,
    });
    cambio = true;
  }

  if (cambio) {
    catalog = { ...catalog, items: sortByName(items) };
    try {
      await writeCatalog(catalog);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(msg)) throw error;
      return readCatalog();
    }
  }
  return catalog;
}

/** Semilla: grupo Diagnóstico + todos los motivos del catálogo clínico. */
export async function ensureDiagnosticoTagsFromCatalog(): Promise<WaTagCatalog> {
  return ensureWhatsappTagsInGroup(nombresMotivosCatalogo(), DIAG_TAG_GROUP, DIAG_TAG_COLOR, {
    moveExisting: true,
  });
}

/**
 * Asegura etiquetas por nombre.
 * Diagnósticos del catálogo → grupo «Diagnóstico»; el resto → «Bot menú».
 */
export async function ensureWhatsappTagsByName(nombres: string[]): Promise<WaTagCatalog> {
  const pedidos = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  if (!pedidos.length) return readCatalog();

  const diagSet = diagnosticoNombresSet();
  const diagnosticos = pedidos.filter((n) => diagSet.has(sinTildesTag(n)));
  const otros = pedidos.filter((n) => !diagSet.has(sinTildesTag(n)));

  let catalog = await readCatalog();
  if (diagnosticos.length) {
    catalog = await ensureWhatsappTagsInGroup(diagnosticos, DIAG_TAG_GROUP, DIAG_TAG_COLOR, {
      moveExisting: true,
    });
  }
  if (otros.length) {
    catalog = await ensureWhatsappTagsInGroup(otros, MENU_TAG_GROUP, MENU_TAG_COLOR);
  }
  return catalog;
}

const PROFESIONALES_GROUP = "Profesionales";
const PROFESIONALES_COLOR = "#f97316";
const TITULOS_TAG = new Set(["dr", "dra", "doctor", "doctora", "prof", "lic"]);

function normalizarNombreTag(texto: string): string {
  return sinTildesTag(texto).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeReTag(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenEntero(texto: string, token: string): boolean {
  if (token.length < 3) return false;
  return new RegExp(`\\b${escapeReTag(token)}\\b`).test(texto);
}

/** Grupo ya creado cuyo nombre se acerca a «Profesionales» (Profesional, Médicos, etc.). */
function grupoProfesionalExistente(groups: WaTagGroup[]): WaTagGroup | undefined {
  const rank = (name: string): number => {
    const n = normalizarNombreTag(name);
    if (n === "profesionales") return 0;
    if (n === "profesional") return 1;
    if (n.includes("profesional")) return 2;
    if (n === "medicos" || n === "medico" || n.includes("doctor")) return 3;
    return 99;
  };
  return [...groups]
    .filter((group) => rank(group.name) < 99)
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, "es"))[0];
}

function mismasClavesProfesional(claves: string[], tagName: string, groupId: string, grupoId: string, nombre: string): boolean {
  const tag = normalizarNombreTag(tagName);
  if (!tag) return false;
  if (tag === normalizarNombreTag(nombre)) return true;
  if (!claves.some((clave) => tokenEntero(tag, clave))) return false;
  if (groupId === grupoId) return true;
  const tokens = tag.split(" ").filter((t) => t.length >= 3 && !TITULOS_TAG.has(t));
  const delNombre = new Set(normalizarNombreTag(nombre).split(" ").filter(Boolean));
  return tokens.length > 0 && tokens.every((t) => delNombre.has(t));
}

/**
 * Una etiqueta por profesional de derivación, en el grupo que más se acerca
 * (o «Profesionales» si todavía no hay uno). No crea repetidos: si ya existe
 * «Dr. Cetkovich», no agrega otra de Cetkovich.
 */
export async function syncProfesionalTags(
  profesionales: Array<{ nombre: string; claves: string[] }>,
): Promise<void> {
  const unicos: Array<{ nombre: string; claves: string[] }> = [];
  const vistos = new Set<string>();
  for (const raw of profesionales) {
    const nombre = raw.nombre.trim();
    const norm = normalizarNombreTag(nombre);
    const claves = [...new Set(raw.claves.map((c) => normalizarNombreTag(c)).filter((c) => c.length >= 3))];
    if (!norm || vistos.has(norm) || claves.some((c) => vistos.has(`clave:${c}`))) continue;
    vistos.add(norm);
    for (const clave of claves) vistos.add(`clave:${clave}`);
    unicos.push({ nombre, claves });
  }
  if (!unicos.length) return;

  let catalog: WaTagCatalog;
  try {
    catalog = await readCatalog({ onQuota: "throw" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(msg)) return;
    throw error;
  }

  const now = new Date().toISOString();
  let cambio = false;
  let grupo = grupoProfesionalExistente(catalog.groups);
  if (!grupo) {
    grupo = {
      id: randomUUID(),
      name: PROFESIONALES_GROUP,
      color: PROFESIONALES_COLOR,
      createdAt: now,
      updatedAt: now,
    };
    catalog = { ...catalog, groups: [...catalog.groups, grupo] };
    cambio = true;
  }

  const items = catalog.items.map((item) => ({ ...item }));
  const drop = new Set<string>();
  const usados = new Set<string>();

  for (const { nombre, claves } of unicos) {
    const coinciden = items.filter(
      (item) =>
        !drop.has(item.id) &&
        !usados.has(item.id) &&
        mismasClavesProfesional(claves, item.name, item.groupId, grupo.id, nombre),
    );
    if (!coinciden.length) {
      const created: WaTag = {
        id: randomUUID(),
        name: nombre,
        groupId: grupo.id,
        createdAt: now,
        updatedAt: now,
      };
      items.push(created);
      usados.add(created.id);
      cambio = true;
      continue;
    }
    const principal =
      coinciden.find((item) => item.groupId === grupo.id) ??
      coinciden.find((item) => normalizarNombreTag(item.name) === normalizarNombreTag(nombre)) ??
      coinciden[0]!;
    usados.add(principal.id);
    if (principal.groupId !== grupo.id || principal.name !== nombre) {
      principal.groupId = grupo.id;
      principal.name = nombre;
      principal.updatedAt = now;
      cambio = true;
    }
    for (const extra of coinciden) {
      if (extra.id === principal.id) continue;
      drop.add(extra.id);
      cambio = true;
    }
  }

  if (!cambio) return;
  try {
    await writeCatalog({
      groups: sortByName([...catalog.groups]),
      items: sortByName(items.filter((item) => !drop.has(item.id))),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(msg)) throw error;
  }
}

export async function listWhatsappTags(): Promise<WaTag[]> {
  return (await readCatalog()).items;
}

export async function createWhatsappTagGroup(input: {
  name: string;
  color: string;
}): Promise<WaTagGroup> {
  const trimmed = input.name.trim();
  const color = normalizeColor(input.color, "");
  if (!trimmed) throw new Error("Ingresá un nombre");
  if (!COLOR_RE.test(color)) throw new Error("Elegí un color");
  const catalog = await readCatalog();
  if (catalog.groups.some((group) => group.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("Ya existe un grupo con ese nombre");
  }
  const now = new Date().toISOString();
  const created: WaTagGroup = {
    id: randomUUID(),
    name: trimmed,
    color,
    createdAt: now,
    updatedAt: now,
  };
  await writeCatalog({ ...catalog, groups: [...catalog.groups, created] });
  return created;
}

export async function updateWhatsappTagGroup(
  id: string,
  input: { name?: string; color?: string },
): Promise<WaTagGroup> {
  const catalog = await readCatalog();
  const index = catalog.groups.findIndex((group) => group.id === id);
  if (index < 0) throw new Error("Grupo no encontrado");
  const current = catalog.groups[index]!;
  const trimmed = input.name !== undefined ? input.name.trim() : current.name;
  const color =
    input.color !== undefined ? normalizeColor(input.color, "") : current.color;
  if (!trimmed) throw new Error("Ingresá un nombre");
  if (!COLOR_RE.test(color)) throw new Error("Elegí un color");
  if (
    catalog.groups.some(
      (group) => group.id !== id && group.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    throw new Error("Ya existe un grupo con ese nombre");
  }
  const next: WaTagGroup = {
    ...current,
    name: trimmed,
    color,
    updatedAt: new Date().toISOString(),
  };
  const groups = [...catalog.groups];
  groups[index] = next;
  await writeCatalog({ ...catalog, groups });
  return next;
}

export async function deleteWhatsappTagGroup(id: string): Promise<void> {
  const catalog = await readCatalog();
  if (!catalog.groups.some((group) => group.id === id)) throw new Error("Grupo no encontrado");
  if (catalog.items.some((item) => item.groupId === id)) {
    throw new Error("Hay etiquetas en ese grupo");
  }
  await writeCatalog({
    ...catalog,
    groups: catalog.groups.filter((group) => group.id !== id),
  });
}

function requireGroup(catalog: WaTagCatalog, groupId: string): string {
  const id = groupId.trim();
  if (!id || !catalog.groups.some((group) => group.id === id)) {
    throw new Error("Elegí un grupo");
  }
  return id;
}

export async function createWhatsappTag(input: {
  name: string;
  groupId: string;
}): Promise<WaTag> {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresá un nombre");
  const catalog = await readCatalog();
  const groupId = requireGroup(catalog, input.groupId);
  if (
    catalog.items.some(
      (item) => item.groupId === groupId && item.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error("Ya existe una etiqueta con ese nombre en el grupo");
  }
  const now = new Date().toISOString();
  const created: WaTag = {
    id: randomUUID(),
    name,
    groupId,
    createdAt: now,
    updatedAt: now,
  };
  await writeCatalog({ ...catalog, items: [...catalog.items, created] });
  return created;
}

export async function updateWhatsappTag(
  id: string,
  input: { name?: string; groupId?: string },
): Promise<WaTag> {
  const catalog = await readCatalog();
  const index = catalog.items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Etiqueta no encontrada");
  const current = catalog.items[index]!;
  const name = input.name !== undefined ? input.name.trim() : current.name;
  const groupId =
    input.groupId !== undefined ? requireGroup(catalog, input.groupId) : current.groupId;
  if (!name) throw new Error("Ingresá un nombre");
  if (!catalog.groups.some((group) => group.id === groupId)) throw new Error("Elegí un grupo");
  if (
    catalog.items.some(
      (item) =>
        item.id !== id && item.groupId === groupId && item.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error("Ya existe una etiqueta con ese nombre en el grupo");
  }
  const next: WaTag = {
    ...current,
    name,
    groupId,
    updatedAt: new Date().toISOString(),
  };
  const items = [...catalog.items];
  items[index] = next;
  await writeCatalog({ ...catalog, items });
  return next;
}

export async function deleteWhatsappTag(id: string): Promise<void> {
  const catalog = await readCatalog();
  const items = catalog.items.filter((item) => item.id !== id);
  if (items.length === catalog.items.length) throw new Error("Etiqueta no encontrada");
  await writeCatalog({ ...catalog, items });
}
