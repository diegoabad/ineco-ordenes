import http from "node:http";
import https from "node:https";
import { env } from "../config/env.js";

async function medexisRequest(
  method: "GET" | "POST",
  path: string,
  input: { query?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  if (!env.medexis.baseUrl) throw new Error("Medexis no está configurado.");
  const base = env.medexis.baseUrl.endsWith("/") ? env.medexis.baseUrl : `${env.medexis.baseUrl}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  if (env.medexis.password) url.searchParams.set("Password", env.medexis.password);
  if (env.medexis.token) url.searchParams.set("Token", env.medexis.token);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const payload = method === "GET" ? "" : JSON.stringify(input.body ?? {});
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          Accept: "application/json",
          ...(method === "GET"
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }),
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data: unknown = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = { Detalle: text.slice(0, 240) };
          }
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(detalle(data) || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on("error", () => reject(new Error("No se pudo conectar con Medexis.")));
    if (payload) req.write(payload);
    req.end();
  });
}

export function medexisPost(
  path: string,
  input: { query?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  return medexisRequest("POST", path, input);
}

export function medexisGet(
  path: string,
  query: Record<string, string> = {},
): Promise<unknown> {
  return medexisRequest("GET", path, { query });
}

export function detalle(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const row = data as Record<string, unknown>;
  return String(row.Detalle || row.Mensaje || row.Message || row.message || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/Password=[^&\s"]*/gi, "")
    .replace(/Token=[^&\s"]*/gi, "")
    .trim();
}
