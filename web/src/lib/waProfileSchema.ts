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
  scope: WaProfileFieldScope;
  options: string[];
  group: string;
  askPrompt: string | null;
  confirmPrompt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const WA_PROFILE_FIELD_TYPE_LABELS: Record<WaProfileFieldType, string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sí / No",
  enum: "Lista de opciones",
  string_list: "Lista de textos",
  date: "Fecha",
};

export const WA_PROFILE_FIELD_SCOPE_LABELS: Record<WaProfileFieldScope, string> = {
  contact: "Contacto (se mantiene)",
  case: "Caso (por pedido)",
};

export const WA_PROFILE_GROUPS = [
  "Contacto",
  "Paciente",
  "Infanto",
  "Clínica",
  "Intención",
  "General",
] as const;
