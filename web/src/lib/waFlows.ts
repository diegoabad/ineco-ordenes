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
  fieldKey: string | null;
  flowId: string | null;
};

export type WaFlow = {
  id: string;
  name: string;
  objective: string | null;
  description: string | null;
  triggers: string[];
  requiredFieldKeys: string[];
  childFlowIds: string[];
  steps: WaFlowStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const WA_FLOW_STEP_LABELS: Record<WaFlowStepType, string> = {
  say: "Decir",
  ask: "Preguntar",
  ask_field: "Pedir campo",
  apply_tags: "Aplicar etiquetas",
  run_flow: "Ir a subflujo",
  handoff: "Pasar a humano",
  end: "Finalizar",
};

export function newFlowStepId(): string {
  return crypto.randomUUID();
}

export function emptyFlowStep(type: WaFlowStepType = "say"): WaFlowStep {
  return {
    id: newFlowStepId(),
    type,
    body: type === "say" || type === "ask" ? "" : null,
    tagIds: [],
    fieldKey: null,
    flowId: null,
  };
}

export function parseFlowTriggers(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n;]+/)
        .map((item) => item.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];
}

export function formatFlowTriggers(triggers: string[]): string {
  return triggers.join(", ");
}
