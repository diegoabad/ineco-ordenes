import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export const WA_FLOW_STEP_TYPES = [
  "say",
  "ask",
  "ask_field",
  "apply_tags",
  "run_flow",
  "handoff",
  "end",
] as const;
export type WaFlowStepType = (typeof WA_FLOW_STEP_TYPES)[number];

export type WaFlowStep = {
  id: string;
  type: WaFlowStepType;
  body: string | null;
  tagIds: string[];
  /** Clave del perfil cuando type === ask_field */
  fieldKey: string | null;
  /** Flujo hijo cuando type === run_flow */
  flowId: string | null;
};

export type WaFlow = {
  id: string;
  name: string;
  /** Qué logra este flujo */
  objective: string | null;
  description: string | null;
  triggers: string[];
  /** Keys del perfil que este flujo necesita (orden = prioridad de ask) */
  requiredFieldKeys: string[];
  /** Subflujos que puede disparar / contiene */
  childFlowIds: string[];
  steps: WaFlowStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const FLOWS_DOC = doc(firestore, "ordenes_config", "whatsapp_flows");
const STEP_TYPE_SET = new Set<string>(WA_FLOW_STEP_TYPES);

function normalizeTagIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

export function normalizeFlowTrigger(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTriggers(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map((item) => normalizeFlowTrigger(String(item ?? "")))
    : String(raw ?? "")
        .split(/[,\n;]+/)
        .map((item) => normalizeFlowTrigger(item));
  return [...new Set(list.filter(Boolean))];
}

function normalizeStep(raw: unknown): WaFlowStep | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = String(row.type ?? "").trim() as WaFlowStepType;
  if (!STEP_TYPE_SET.has(type)) return null;
  const id = String(row.id ?? "").trim() || randomUUID();
  const bodyRaw = row.body != null ? String(row.body).trim() : "";
  const needsBody = type === "say" || type === "ask";
  const fieldKey =
    type === "ask_field" ? String(row.fieldKey ?? "").trim() || null : null;
  const flowId = type === "run_flow" ? String(row.flowId ?? "").trim() || null : null;
  return {
    id,
    type,
    body: needsBody ? bodyRaw || null : bodyRaw ? bodyRaw : null,
    tagIds: type === "apply_tags" ? normalizeTagIds(row.tagIds) : [],
    fieldKey,
    flowId,
  };
}

function normalizeSteps(raw: unknown): WaFlowStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeStep).filter((step): step is WaFlowStep => step !== null);
}

function normalizeItem(raw: unknown): WaFlow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!id || !name) return null;
  const description = row.description != null ? String(row.description).trim() : "";
  const objective = row.objective != null ? String(row.objective).trim() : "";
  return {
    id,
    name,
    objective: objective || null,
    description: description || null,
    triggers: normalizeTriggers(row.triggers),
    requiredFieldKeys: normalizeStringList(row.requiredFieldKeys),
    childFlowIds: normalizeStringList(row.childFlowIds),
    steps: normalizeSteps(row.steps),
    isActive: row.isActive !== false,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function validateFlowInput(input: {
  name: string;
  steps: WaFlowStep[];
}): void {
  if (!input.name.trim()) throw new Error("Ingresá un nombre para el flujo");
  if (input.steps.length === 0) throw new Error("Agregá al menos un paso");
  for (const step of input.steps) {
    if ((step.type === "say" || step.type === "ask") && !step.body?.trim()) {
      throw new Error(
        step.type === "say"
          ? "Hay un paso “Decir” sin mensaje"
          : "Hay un paso “Preguntar” sin mensaje",
      );
    }
    if (step.type === "ask_field" && !step.fieldKey?.trim()) {
      throw new Error("Hay un paso “Pedir campo” sin campo de perfil");
    }
    if (step.type === "run_flow" && !step.flowId?.trim()) {
      throw new Error("Hay un paso “Ir a subflujo” sin flujo elegido");
    }
  }
}

async function readAll(): Promise<WaFlow[]> {
  const snap = await getDoc(FLOWS_DOC);
  const raw = snap.exists() ? snap.data()?.items : [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeItem)
    .filter((item): item is WaFlow => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function writeAll(items: WaFlow[]): Promise<void> {
  await setDoc(FLOWS_DOC, { items, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function listWhatsappFlows(): Promise<WaFlow[]> {
  return readAll();
}

export async function createWhatsappFlow(input: {
  name: string;
  objective?: string | null;
  description?: string | null;
  triggers?: string[] | string;
  requiredFieldKeys?: string[];
  childFlowIds?: string[];
  steps?: unknown;
  isActive?: boolean;
}): Promise<WaFlow> {
  const name = String(input.name ?? "").trim();
  const steps = normalizeSteps(input.steps);
  validateFlowInput({ name, steps });
  const items = await readAll();
  if (items.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Ya existe un flujo con ese nombre");
  }
  const childFlowIds = normalizeStringList(input.childFlowIds);
  const knownIds = new Set(items.map((item) => item.id));
  if (childFlowIds.some((id) => !knownIds.has(id))) {
    throw new Error("Hay un subflujo que no existe");
  }
  const now = new Date().toISOString();
  const created: WaFlow = {
    id: randomUUID(),
    name,
    objective: input.objective?.trim() || null,
    description: input.description?.trim() || null,
    triggers: normalizeTriggers(input.triggers),
    requiredFieldKeys: normalizeStringList(input.requiredFieldKeys),
    childFlowIds,
    steps,
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  await writeAll([...items, created]);
  return created;
}

export async function updateWhatsappFlow(
  id: string,
  input: {
    name?: string;
    objective?: string | null;
    description?: string | null;
    triggers?: string[] | string;
    requiredFieldKeys?: string[];
    childFlowIds?: string[];
    steps?: unknown;
    isActive?: boolean;
  },
): Promise<WaFlow> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Flujo no encontrado");
  const current = items[index]!;
  const name = input.name !== undefined ? input.name.trim() : current.name;
  const steps = input.steps !== undefined ? normalizeSteps(input.steps) : current.steps;
  validateFlowInput({ name, steps });
  if (items.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Ya existe un flujo con ese nombre");
  }
  const childFlowIds =
    input.childFlowIds !== undefined
      ? normalizeStringList(input.childFlowIds)
      : current.childFlowIds;
  if (childFlowIds.includes(id)) {
    throw new Error("Un flujo no puede ser subflujo de sí mismo");
  }
  const knownIds = new Set(items.map((item) => item.id));
  if (childFlowIds.some((childId) => !knownIds.has(childId))) {
    throw new Error("Hay un subflujo que no existe");
  }
  const next: WaFlow = {
    ...current,
    name,
    objective:
      input.objective !== undefined ? input.objective?.trim() || null : current.objective,
    description:
      input.description !== undefined ? input.description?.trim() || null : current.description,
    triggers: input.triggers !== undefined ? normalizeTriggers(input.triggers) : current.triggers,
    requiredFieldKeys:
      input.requiredFieldKeys !== undefined
        ? normalizeStringList(input.requiredFieldKeys)
        : current.requiredFieldKeys,
    childFlowIds,
    steps,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : current.isActive,
    updatedAt: new Date().toISOString(),
  };
  const copy = [...items];
  copy[index] = next;
  await writeAll(copy);
  return next;
}

export async function deleteWhatsappFlow(id: string): Promise<void> {
  const items = await readAll();
  if (!items.some((item) => item.id === id)) throw new Error("Flujo no encontrado");
  const next = items
    .filter((item) => item.id !== id)
    .map((item) => ({
      ...item,
      childFlowIds: item.childFlowIds.filter((childId) => childId !== id),
      steps: item.steps.map((step) =>
        step.type === "run_flow" && step.flowId === id
          ? { ...step, flowId: null }
          : step,
      ),
      updatedAt: new Date().toISOString(),
    }));
  await writeAll(next);
}
