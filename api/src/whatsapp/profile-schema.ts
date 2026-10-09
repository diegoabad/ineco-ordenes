import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export const WA_PROFILE_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "enum",
  "string_list",
  "date",
] as const;

export const WA_PROFILE_FIELD_SCOPES = ["contact", "case"] as const;

export type WaProfileFieldType = (typeof WA_PROFILE_FIELD_TYPES)[number];
export type WaProfileFieldScope = (typeof WA_PROFILE_FIELD_SCOPES)[number];

export type WaProfileField = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: WaProfileFieldType;
  /** contact = se mantiene entre pedidos; case = se reinicia/confirma en cada caso */
  scope: WaProfileFieldScope;
  options: string[];
  group: string;
  askPrompt: string | null;
  confirmPrompt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const SCHEMA_DOC = doc(firestore, "ordenes_config", "whatsapp_profile_schema");
const TYPE_SET = new Set<string>(WA_PROFILE_FIELD_TYPES);
const SCOPE_SET = new Set<string>(WA_PROFILE_FIELD_SCOPES);

const CONTACT_KEYS = new Set(["nombre_contacto", "telefono"]);

/** Campos de contacto que ya no usamos (el resto va en Paciente según para_quien). */
const DEPRECATED_PROFILE_KEYS = new Set([
  "domicilio",
  "dni_contacto",
  "fecha_nacimiento_contacto",
]);

const DEFAULT_FIELDS: Array<{
  key: string;
  label: string;
  description?: string;
  type: WaProfileFieldType;
  scope: WaProfileFieldScope;
  options?: string[];
  group: string;
  askPrompt?: string;
  confirmPrompt?: string;
}> = [
  {
    key: "nombre_contacto",
    label: "Nombre de quien contacta",
    type: "text",
    scope: "contact",
    group: "Contacto",
    askPrompt: "¿Me decís tu nombre?",
    confirmPrompt: "¿Tu nombre es {{valor}}?",
  },
  {
    key: "telefono",
    label: "Teléfono",
    type: "text",
    scope: "contact",
    group: "Contacto",
    askPrompt: "¿Cuál es un teléfono de contacto?",
  },
  {
    key: "para_quien",
    label: "Para quién es",
    type: "enum",
    scope: "case",
    options: ["yo", "tercero"],
    group: "Contacto",
    askPrompt: "¿La consulta es para vos o para otra persona?",
    confirmPrompt: "¿Confirmás que es para {{valor}}?",
  },
  {
    key: "parentesco",
    label: "Parentesco",
    description: "Solo si la consulta es para un tercero",
    type: "enum",
    scope: "case",
    options: [
      "Padre",
      "Madre",
      "Abuelo",
      "Abuela",
      "Hijo",
      "Hija",
      "Tío",
      "Tía",
      "Sobrino",
      "Sobrina",
      "Tutor",
      "Otro",
    ],
    group: "Contacto",
    askPrompt: "¿Cuál es tu parentesco con el paciente?",
  },
  {
    key: "sede",
    label: "Sede",
    type: "text",
    scope: "case",
    group: "Contacto",
    askPrompt: "¿Para qué sede sería?",
    description: "Por defecto este número es CABA",
  },
  {
    key: "motivo",
    label: "Motivo de la comunicación",
    type: "enum",
    scope: "case",
    options: [
      "turno_nuevo",
      "turno_cambiar",
      "turno_cancelar",
      "turno_confirmar",
      "turno_consultar",
      "evaluacion",
      "diagnostico_sintomas",
      "tratamiento_info",
      "sede_info",
      "cobertura",
      "recetas",
      "admin",
      "reclamo",
      "otro",
    ],
    group: "Contacto",
    askPrompt: "¿En qué te puedo ayudar?",
  },
  {
    key: "nombre_paciente",
    label: "Nombre del paciente",
    type: "text",
    scope: "case",
    group: "Paciente",
    askPrompt: "¿Cómo se llama el paciente?",
  },
  {
    key: "dni_paciente",
    label: "DNI del paciente",
    type: "text",
    scope: "case",
    group: "Paciente",
  },
  {
    key: "fecha_nacimiento_paciente",
    label: "Fecha de nacimiento (paciente)",
    type: "date",
    scope: "case",
    group: "Paciente",
  },
  {
    key: "edad",
    label: "Edad",
    type: "number",
    scope: "case",
    group: "Paciente",
    askPrompt: "¿Qué edad tiene?",
    confirmPrompt: "¿Tiene {{valor}} años?",
  },
  {
    key: "rango_edad",
    label: "Rango de edad",
    description: "Se puede inferir desde la edad (0–17 infanto, 18+ adulto)",
    type: "enum",
    scope: "case",
    options: ["infanto", "adulto"],
    group: "Paciente",
  },
  {
    key: "es_paciente",
    label: "¿Es paciente de INECO?",
    type: "boolean",
    scope: "case",
    group: "Paciente",
    askPrompt: "¿Ya es paciente de INECO?",
  },
  {
    key: "nombre_padre_madre",
    label: "Nombre del padre/madre",
    description: "Relevante en infanto",
    type: "text",
    scope: "case",
    group: "Infanto",
    askPrompt: "¿Nombre del padre o madre / responsable?",
  },
  {
    key: "dni_padre_madre",
    label: "DNI del padre/madre",
    description: "Relevante en infanto",
    type: "text",
    scope: "case",
    group: "Infanto",
  },
  {
    key: "cobertura",
    label: "Cobertura",
    type: "text",
    scope: "case",
    group: "Clínica",
    askPrompt: "¿Tenés obra social o cobertura médica?",
  },
  {
    key: "n_afiliado",
    label: "N° de afiliado",
    type: "text",
    scope: "case",
    group: "Clínica",
  },
  {
    key: "con_diagnostico",
    label: "¿Tiene diagnóstico?",
    type: "boolean",
    scope: "case",
    group: "Clínica",
    askPrompt: "¿Tiene un diagnóstico?",
  },
  {
    key: "diagnostico",
    label: "Diagnóstico",
    type: "text",
    scope: "case",
    group: "Clínica",
  },
  {
    key: "sintomas",
    label: "Síntomas",
    type: "string_list",
    scope: "case",
    group: "Clínica",
    askPrompt: "¿Qué síntomas o motivo clínico tienen?",
  },
  {
    key: "derivacion",
    label: "Derivación / indicación",
    type: "text",
    scope: "case",
    group: "Clínica",
    askPrompt: "¿Quién lo derivó o qué le indicaron?",
  },
];

function fieldFromDefault(
  def: (typeof DEFAULT_FIELDS)[number],
  now: string,
): WaProfileField {
  return {
    id: randomUUID(),
    key: def.key,
    label: def.label,
    description: def.description ?? null,
    type: def.type,
    scope: def.scope,
    options: def.options ?? [],
    group: def.group,
    askPrompt: def.askPrompt ?? null,
    confirmPrompt: def.confirmPrompt ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function defaultScopeForKey(key: string, group: string): WaProfileFieldScope {
  if (CONTACT_KEYS.has(key) || group === "Contacto") return "contact";
  return "case";
}

function normalizeScope(raw: unknown, key: string, group: string): WaProfileFieldScope {
  const scope = String(raw ?? "").trim().toLowerCase();
  if (SCOPE_SET.has(scope)) return scope as WaProfileFieldScope;
  return defaultScopeForKey(key, group);
}

function normalizeField(raw: unknown): WaProfileField | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const key = normalizeKey(String(row.key ?? ""));
  const label = String(row.label ?? "").trim();
  const type = String(row.type ?? "").trim() as WaProfileFieldType;
  if (!id || !key || !label || !TYPE_SET.has(type)) return null;
  const description = row.description != null ? String(row.description).trim() : "";
  const askPrompt = row.askPrompt != null ? String(row.askPrompt).trim() : "";
  const confirmPrompt = row.confirmPrompt != null ? String(row.confirmPrompt).trim() : "";
  const group = String(row.group ?? "General").trim() || "General";
  return {
    id,
    key,
    label,
    description: description || null,
    type,
    scope: normalizeScope(row.scope, key, group),
    options: type === "enum" ? normalizeOptions(row.options) : [],
    group,
    askPrompt: askPrompt || null,
    confirmPrompt: confirmPrompt || null,
    isActive: row.isActive !== false,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function sortFields(items: WaProfileField[]): WaProfileField[] {
  return [...items].sort((a, b) => {
    const byScope = a.scope.localeCompare(b.scope, "es");
    if (byScope) return byScope;
    const byGroup = a.group.localeCompare(b.group, "es");
    if (byGroup) return byGroup;
    return a.label.localeCompare(b.label, "es");
  });
}

async function readAll(): Promise<WaProfileField[]> {
  const snap = await getDoc(SCHEMA_DOC);
  const raw = snap.exists() ? snap.data()?.fields : [];
  if (!Array.isArray(raw)) return [];
  return sortFields(
    raw.map(normalizeField).filter((item): item is WaProfileField => item !== null),
  );
}

async function writeAll(fields: WaProfileField[]): Promise<void> {
  await setDoc(
    SCHEMA_DOC,
    { fields: sortFields(fields), updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

function validateFieldInput(input: {
  key: string;
  label: string;
  type: WaProfileFieldType;
  scope: WaProfileFieldScope;
  options?: string[];
}): void {
  if (!input.key) throw new Error("Ingresá una clave para el campo");
  if (!/^[a-z][a-z0-9_]*$/.test(input.key)) {
    throw new Error("La clave debe ser snake_case (ej. nombre_contacto)");
  }
  if (!input.label.trim()) throw new Error("Ingresá una etiqueta para el campo");
  if (!TYPE_SET.has(input.type)) throw new Error("Tipo de campo inválido");
  if (!SCOPE_SET.has(input.scope)) throw new Error("Alcance inválido (contacto o caso)");
  if (input.type === "enum" && normalizeOptions(input.options).length === 0) {
    throw new Error("Los campos enum necesitan al menos una opción");
  }
}

export async function listWhatsappProfileFields(): Promise<WaProfileField[]> {
  return readAll();
}

/** Si el catálogo está vacío, carga el set inicial acordado. */
export async function ensureWhatsappProfileSchemaDefaults(): Promise<WaProfileField[]> {
  const existing = await readAll();
  const now = new Date().toISOString();
  if (existing.length > 0) {
    const defaultsByKey = new Map(DEFAULT_FIELDS.map((def) => [def.key, def]));
    // Saca campos deprecados, corrige grupo/scope y agrega faltantes del set acordado
    let migrated = existing
      .filter((item) => !DEPRECATED_PROFILE_KEYS.has(item.key))
      .map((item) => {
        const def = defaultsByKey.get(item.key);
        const nextGroup = def?.group ?? item.group;
        // Preferir scope del default (ej. para_quien queda "case" aunque el grupo sea Contacto)
        const nextScope =
          def?.scope ?? (item.scope || defaultScopeForKey(item.key, nextGroup));
        const nextOptions =
          def?.type === "enum" && def.options?.length ? def.options : item.options;
        const touched =
          nextGroup !== item.group ||
          nextScope !== item.scope ||
          (def?.type === "enum" &&
            JSON.stringify(nextOptions) !== JSON.stringify(item.options));
        return {
          ...item,
          group: nextGroup,
          scope: nextScope,
          options: nextOptions,
          description: def?.description ?? item.description,
          askPrompt: def?.askPrompt ?? item.askPrompt,
          confirmPrompt: def?.confirmPrompt ?? item.confirmPrompt,
          updatedAt: touched ? now : item.updatedAt,
        };
      });
    const known = new Set(migrated.map((item) => item.key));
    for (const def of DEFAULT_FIELDS) {
      if (!known.has(def.key)) {
        migrated.push(fieldFromDefault(def, now));
      }
    }
    const changed =
      migrated.length !== existing.length ||
      migrated.some((item, i) => {
        const prev = existing.find((row) => row.key === item.key);
        if (!prev) return true;
        return (
          prev.group !== item.group ||
          prev.scope !== item.scope ||
          JSON.stringify(prev.options) !== JSON.stringify(item.options)
        );
      });
    if (changed) await writeAll(migrated);
    return sortFields(migrated);
  }
  const fields: WaProfileField[] = DEFAULT_FIELDS.map((def) => fieldFromDefault(def, now));
  await writeAll(fields);
  return fields;
}

export async function createWhatsappProfileField(input: {
  key: string;
  label: string;
  description?: string | null;
  type: string;
  scope?: string;
  options?: string[];
  group?: string;
  askPrompt?: string | null;
  confirmPrompt?: string | null;
  isActive?: boolean;
}): Promise<WaProfileField> {
  const key = normalizeKey(input.key);
  const label = String(input.label ?? "").trim();
  const type = String(input.type ?? "").trim() as WaProfileFieldType;
  const group = String(input.group ?? "General").trim() || "General";
  const scope = normalizeScope(input.scope, key, group);
  validateFieldInput({ key, label, type, scope, options: input.options });
  const items = await readAll();
  if (items.some((item) => item.key === key)) {
    throw new Error("Ya existe un campo con esa clave");
  }
  const now = new Date().toISOString();
  const created: WaProfileField = {
    id: randomUUID(),
    key,
    label,
    description: input.description?.trim() || null,
    type,
    scope,
    options: type === "enum" ? normalizeOptions(input.options) : [],
    group,
    askPrompt: input.askPrompt?.trim() || null,
    confirmPrompt: input.confirmPrompt?.trim() || null,
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  await writeAll([...items, created]);
  return created;
}

export async function updateWhatsappProfileField(
  id: string,
  input: {
    key?: string;
    label?: string;
    description?: string | null;
    type?: string;
    scope?: string;
    options?: string[];
    group?: string;
    askPrompt?: string | null;
    confirmPrompt?: string | null;
    isActive?: boolean;
  },
): Promise<WaProfileField> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Campo no encontrado");
  const current = items[index]!;
  const key = input.key !== undefined ? normalizeKey(input.key) : current.key;
  const label = input.label !== undefined ? input.label.trim() : current.label;
  const type =
    input.type !== undefined
      ? (String(input.type).trim() as WaProfileFieldType)
      : current.type;
  const group =
    input.group !== undefined ? String(input.group).trim() || "General" : current.group;
  const scope =
    input.scope !== undefined ? normalizeScope(input.scope, key, group) : current.scope;
  validateFieldInput({
    key,
    label,
    type,
    scope,
    options: input.options !== undefined ? input.options : current.options,
  });
  if (items.some((item) => item.id !== id && item.key === key)) {
    throw new Error("Ya existe un campo con esa clave");
  }
  const next: WaProfileField = {
    ...current,
    key,
    label,
    description:
      input.description !== undefined ? input.description?.trim() || null : current.description,
    type,
    scope,
    options:
      type === "enum"
        ? input.options !== undefined
          ? normalizeOptions(input.options)
          : current.options
        : [],
    group,
    askPrompt:
      input.askPrompt !== undefined ? input.askPrompt?.trim() || null : current.askPrompt,
    confirmPrompt:
      input.confirmPrompt !== undefined
        ? input.confirmPrompt?.trim() || null
        : current.confirmPrompt,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : current.isActive,
    updatedAt: new Date().toISOString(),
  };
  const copy = [...items];
  copy[index] = next;
  await writeAll(copy);
  return next;
}

export async function deleteWhatsappProfileField(id: string): Promise<void> {
  const items = await readAll();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) throw new Error("Campo no encontrado");
  await writeAll(next);
}
