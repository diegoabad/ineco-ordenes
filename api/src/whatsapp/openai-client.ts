import { env } from "../config/env.js";
import { recordLlmUsage, type LlmPaso } from "./llm-usage.js";

type UsageCounts = {
  tokensEntrada: number;
  tokensSalida: number;
  tokensTotal: number;
  tokensCache: number;
  tokensRazonamiento: number;
};

function countsFromUsage(usage: unknown): UsageCounts {
  const row = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const inputDetails =
    row.input_tokens_details && typeof row.input_tokens_details === "object"
      ? (row.input_tokens_details as Record<string, unknown>)
      : {};
  const outputDetails =
    row.output_tokens_details && typeof row.output_tokens_details === "object"
      ? (row.output_tokens_details as Record<string, unknown>)
      : {};
  const tokensEntrada = Number(row.input_tokens ?? row.prompt_tokens ?? 0) || 0;
  const tokensSalida = Number(row.output_tokens ?? row.completion_tokens ?? 0) || 0;
  return {
    tokensEntrada,
    tokensSalida,
    tokensTotal: Number(row.total_tokens ?? 0) || tokensEntrada + tokensSalida,
    tokensCache: Number(inputDetails.cached_tokens ?? 0) || 0,
    tokensRazonamiento: Number(outputDetails.reasoning_tokens ?? 0) || 0,
  };
}

function textFromResponse(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const output = Array.isArray(body.output) ? body.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("").trim();
}

/** Saca un objeto JSON aunque venga con markdown o texto alrededor. */
function parseJsonLoose<T>(raw: string): T | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    /* seguir */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      /* seguir */
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

async function callOnce(input: {
  modelo: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
  omitirRazonamiento?: boolean;
  instructions: string;
  content: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<{ body: Record<string, unknown>; httpError: string }> {
  let body: Record<string, unknown> = {};
  let httpError = "";
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
      headers: {
        Authorization: `Bearer ${env.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.modelo,
        instructions: input.instructions,
        input: input.content,
        ...(input.omitirRazonamiento ? {} : { reasoning: { effort: input.reasoningEffort } }),
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      }),
    });
    body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        body.error && typeof body.error === "object"
          ? String((body.error as { message?: unknown }).message ?? response.statusText)
          : response.statusText;
      httpError = message || `OpenAI respondió ${response.status}`;
    }
  } catch (error) {
    httpError = error instanceof Error ? error.message : "No se pudo llamar a OpenAI";
  }
  return { body, httpError };
}

export async function completeStructured<T>(input: {
  conversacionId: string;
  paso: LlmPaso;
  modelo: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
  /** Modelos viejos rechazan el campo reasoning. Solo lo usan las pruebas. */
  omitirRazonamiento?: boolean;
  instructions: string;
  content: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Pruebas: no anota tokens en la conversación. */
  skipUsage?: boolean;
  onUsage?: (uso: UsageCounts & { paso: LlmPaso; modelo: string }) => void;
}): Promise<T> {
  const empty = {
    tokensEntrada: 0,
    tokensSalida: 0,
    tokensTotal: 0,
    tokensCache: 0,
    tokensRazonamiento: 0,
  };
  const anotar = input.skipUsage !== true;
  if (!env.openai.apiKey) {
    if (anotar) await recordLlmUsage({
      conversacionId: input.conversacionId,
      paso: input.paso,
      modelo: input.modelo,
      ...empty,
      ok: false,
      error: "Falta OPENAI_API_KEY",
    });
    throw new Error("Falta OPENAI_API_KEY");
  }

  const intentos = 2;
  let lastError = "La respuesta no era JSON";
  let totalCounts = { ...empty };

  for (let intento = 1; intento <= intentos; intento += 1) {
    const { body, httpError } = await callOnce(input);
    const counts = countsFromUsage(body.usage);
    totalCounts = {
      tokensEntrada: totalCounts.tokensEntrada + counts.tokensEntrada,
      tokensSalida: totalCounts.tokensSalida + counts.tokensSalida,
      tokensTotal: totalCounts.tokensTotal + counts.tokensTotal,
      tokensCache: totalCounts.tokensCache + counts.tokensCache,
      tokensRazonamiento: totalCounts.tokensRazonamiento + counts.tokensRazonamiento,
    };
    input.onUsage?.({ ...counts, paso: input.paso, modelo: input.modelo });

    if (httpError) {
      lastError = httpError;
      // Errores HTTP de auth/cuota no se reintentan.
      if (/api key|unauthorized|429|quota|billing/i.test(httpError) || intento === intentos) {
        if (anotar) await recordLlmUsage({
          conversacionId: input.conversacionId,
          paso: input.paso,
          modelo: input.modelo,
          ...totalCounts,
          ok: false,
          error: httpError,
        });
        throw new Error(httpError);
      }
      continue;
    }

    const raw = textFromResponse(body);
    const parsed = parseJsonLoose<T>(raw);
    if (parsed !== null) {
      if (anotar) {
        await recordLlmUsage({
          conversacionId: input.conversacionId,
          paso: input.paso,
          modelo: input.modelo,
          ...totalCounts,
          ok: true,
          error: "",
        });
      }
      return parsed;
    }

    lastError = raw ? "La respuesta no era JSON" : "La respuesta vino vacía";
    if (intento < intentos) continue;
  }

  if (anotar) await recordLlmUsage({
    conversacionId: input.conversacionId,
    paso: input.paso,
    modelo: input.modelo,
    ...totalCounts,
    ok: false,
    error: lastError,
  });
  throw new Error(lastError === "La respuesta vino vacía" ? "La respuesta no era JSON" : lastError);
}
