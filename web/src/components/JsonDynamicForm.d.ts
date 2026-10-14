import type { ReactNode } from "react";

export function JsonDynamicForm(props: {
  value: unknown;
  onChange: (next: unknown) => void;
}): ReactNode;

export function parseConfigJsonObject(rawText: string): Record<string, unknown>;
