import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/** Headers que no deben reenviarse al upstream. */
const DROP_REQ = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  // Sesión de Órdenes / encoding del browser no deben ir a Medexis.
  "cookie",
  "authorization",
  "accept-encoding",
]);

/**
 * Proxy Medexis: /api/medexis/... → MEDEXIS_BASE_URL/... inyectando Password/Token.
 * El front llama p.ej. /api/medexis/api/Departamento
 */
export function medexisProxy(req: Request, res: Response, _next: NextFunction): void {
  if (!env.medexis.baseUrl) {
    res.status(503).json({
      ok: false,
      message: "Medexis no está configurado (MEDEXIS_BASE_URL)",
    });
    return;
  }

  const prefix = "/api/medexis";
  const rawUrl = req.originalUrl || req.url || "/";
  const incoming = new URL(rawUrl, "http://127.0.0.1");
  const after =
    incoming.pathname === prefix
      ? "/"
      : incoming.pathname.slice(prefix.length) || "/";
  const rel = (after.startsWith("/") ? after.slice(1) : after) + incoming.search;

  const base = env.medexis.baseUrl.endsWith("/")
    ? env.medexis.baseUrl
    : `${env.medexis.baseUrl}/`;
  const upstream = new URL(rel, base);
  if (env.medexis.password) {
    upstream.searchParams.set("Password", env.medexis.password);
  }
  if (env.medexis.token) {
    upstream.searchParams.set("Token", env.medexis.token);
  }

  const lib = upstream.protocol === "https:" ? https : http;
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQ.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = upstream.host;
  headers.accept = "application/json";
  // Evitar respuestas gzip que a veces corrompen el pipe en Node.
  headers["accept-encoding"] = "identity";

  const proxyReq = lib.request(
    {
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
      path: upstream.pathname + upstream.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const outHeaders: Record<string, string | string[] | number | undefined> = {
        ...proxyRes.headers,
      };
      // Evitar que el browser reciba encoding que no matchea el body pipeado.
      delete outHeaders["content-encoding"];
      delete outHeaders["content-length"];
      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error("Medexis proxy error:", err);
    if (!res.headersSent) {
      res.status(502).json({
        ok: false,
        message: "No se pudo conectar con Medexis",
      });
    }
  });

  req.on("aborted", () => proxyReq.destroy());
  req.pipe(proxyReq);
}
