import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export type WaTagGroup = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type WaTag = {
  id: string;
  name: string;
  color: string;
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

function normalizeGroup(raw: unknown): WaTagGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function normalizeItem(raw: unknown): WaTag | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  const color = String(row.color ?? "").trim();
  if (!id || !name || !COLOR_RE.test(color)) return null;
  return {
    id,
    name,
    color: color.toLowerCase(),
    groupId: String(row.groupId ?? "").trim(),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

async function readCatalog(): Promise<WaTagCatalog> {
  const snap = await getDoc(TAGS_DOC);
  const data = snap.exists() ? snap.data() : {};
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    groups: sortByName(groups.map(normalizeGroup).filter((item): item is WaTagGroup => item !== null)),
    items: sortByName(items.map(normalizeItem).filter((item): item is WaTag => item !== null)),
  };
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
  return readCatalog();
}

export async function listWhatsappTags(): Promise<WaTag[]> {
  return (await readCatalog()).items;
}

export async function createWhatsappTagGroup(name: string): Promise<WaTagGroup> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Ingresá un nombre");
  const catalog = await readCatalog();
  if (catalog.groups.some((group) => group.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("Ya existe un grupo con ese nombre");
  }
  const now = new Date().toISOString();
  const created: WaTagGroup = { id: randomUUID(), name: trimmed, createdAt: now, updatedAt: now };
  await writeCatalog({ ...catalog, groups: [...catalog.groups, created] });
  return created;
}

export async function updateWhatsappTagGroup(id: string, name: string): Promise<WaTagGroup> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Ingresá un nombre");
  const catalog = await readCatalog();
  const index = catalog.groups.findIndex((group) => group.id === id);
  if (index < 0) throw new Error("Grupo no encontrado");
  if (
    catalog.groups.some(
      (group) => group.id !== id && group.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    throw new Error("Ya existe un grupo con ese nombre");
  }
  const next: WaTagGroup = {
    ...catalog.groups[index]!,
    name: trimmed,
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
  color: string;
  groupId: string;
}): Promise<WaTag> {
  const name = input.name.trim();
  const color = input.color.trim().toLowerCase();
  if (!name) throw new Error("Ingresá un nombre");
  if (!COLOR_RE.test(color)) throw new Error("Elegí un color");
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
    color,
    groupId,
    createdAt: now,
    updatedAt: now,
  };
  await writeCatalog({ ...catalog, items: [...catalog.items, created] });
  return created;
}

export async function updateWhatsappTag(
  id: string,
  input: { name?: string; color?: string; groupId?: string },
): Promise<WaTag> {
  const catalog = await readCatalog();
  const index = catalog.items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Etiqueta no encontrada");
  const current = catalog.items[index]!;
  const name = input.name !== undefined ? input.name.trim() : current.name;
  const color = input.color !== undefined ? input.color.trim().toLowerCase() : current.color;
  const groupId =
    input.groupId !== undefined ? requireGroup(catalog, input.groupId) : current.groupId;
  if (!name) throw new Error("Ingresá un nombre");
  if (!COLOR_RE.test(color)) throw new Error("Elegí un color");
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
    color,
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
