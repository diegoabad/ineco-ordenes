import { env } from "../config/env.js";

const MP_API = "https://api.mercadopago.com";

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "MercadoPagoError";
  }
}

export type CreateMpPreferenceInput = {
  items: Array<{
    title: string;
    quantity: number;
    unit_price: number;
    currency_id?: string;
  }>;
  external_reference: string;
  payer?: { email?: string };
  metadata?: Record<string, string>;
  payment_methods?: {
    installments?: number;
    default_installments?: number;
  };
  auto_return?: "approved" | "all";
};

export type MpPreference = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
  external_reference?: string;
};

async function mpFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = env.mercadoPago.accessToken;
  if (!token) {
    throw new MercadoPagoError(
      "Mercado Pago no está configurado (MERCADOPAGO_ACCESS_TOKEN).",
    );
  }

  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Mercado Pago respondió ${res.status}`;
    throw new MercadoPagoError(msg, res.status, body);
  }

  return body as T;
}

export async function createPreference(
  input: CreateMpPreferenceInput,
): Promise<MpPreference> {
  return mpFetch<MpPreference>("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function initPointPreference(preference: MpPreference): string | null {
  if (env.mercadoPago.sandbox && preference.sandbox_init_point) {
    return preference.sandbox_init_point;
  }
  return preference.init_point ?? preference.sandbox_init_point ?? null;
}
