import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import type { AppModuleId, AppUserPublic, UserRole } from "../types.js";
import { ALL_APP_MODULES } from "../types.js";
import {
  loadSessionUser,
  SESSION_COOKIE,
  verifySessionToken,
  type JwtPayload,
} from "../services/auth.service.js";

export type AuthedRequest = Request & {
  auth?: JwtPayload;
  user?: AppUserPublic;
};

/** Usuario temporal cuando AUTH_DISABLED=1 (solo desarrollo). */
export const DEV_BYPASS_USER: AppUserPublic = {
  id: "dev-bypass",
  email: "dev@local",
  nombre: "Dev (auth off)",
  role: "admin",
  modules: [...ALL_APP_MODULES],
  status: "approved",
  creadoAt: new Date(0).toISOString(),
  actualizadoAt: new Date(0).toISOString(),
  aprobadoAt: new Date(0).toISOString(),
  rechazadoAt: null,
};

function attachBypass(req: AuthedRequest): void {
  req.user = DEV_BYPASS_USER;
  req.auth = {
    sub: DEV_BYPASS_USER.id,
    email: DEV_BYPASS_USER.email,
    role: DEV_BYPASS_USER.role,
    modules: DEV_BYPASS_USER.modules,
  };
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

function readToken(req: Request): string | null {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    SESSION_COOKIE
  ];
  if (cookieToken) return cookieToken;
  return readBearerToken(req);
}

/** Autenticación opcional: adjunta user si hay cookie/JWT válido. */
export async function optionalAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (env.auth.disabled) {
    attachBypass(req);
    next();
    return;
  }
  try {
    const token = readToken(req);
    if (!token) {
      next();
      return;
    }
    const payload = verifySessionToken(token);
    const user = await loadSessionUser(payload.sub, payload.email);
    if (user) {
      req.auth = {
        sub: user.id,
        email: user.email,
        role: user.role,
        modules: user.modules,
      };
      req.user = user;
    }
  } catch {
    // token inválido/expirado → seguir como anónimo
  }
  next();
}

/** Requiere sesión aprobada. */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (env.auth.disabled) {
    attachBypass(req);
    next();
    return;
  }
  try {
    const token = readToken(req);
    if (!token) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const payload = verifySessionToken(token);
    const user = await loadSessionUser(payload.sub, payload.email);
    if (!user) {
      res.status(401).json({
        ok: false,
        message: "Sesión inválida o usuario sin acceso",
        code: "SESSION_REVOKED",
      });
      return;
    }
    // Siempre usar role/modules/email actuales de Firestore (nunca confiar en el JWT)
    req.auth = {
      sub: user.id,
      email: user.email,
      role: user.role,
      modules: user.modules,
    };
    req.user = user;
    next();
  } catch {
    res.status(401).json({ ok: false, message: "Sesión expirada o inválida" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (env.auth.disabled) {
      attachBypass(req);
      next();
      return;
    }
    if (!req.user) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ ok: false, message: "No tenés permisos para esta acción" });
      return;
    }
    next();
  };
}

export function requireModule(...modules: AppModuleId[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (env.auth.disabled) {
      attachBypass(req);
      next();
      return;
    }
    if (!req.user) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    if (req.user.role === "admin") {
      next();
      return;
    }
    // Pedidos sistema es acceso fijo para todo usuario autenticado
    if (modules.includes("pedidos-sistema")) {
      next();
      return;
    }
    const ok = modules.some((m) => req.user!.modules.includes(m));
    if (!ok) {
      res.status(403).json({ ok: false, message: "No tenés acceso a este módulo" });
      return;
    }
    next();
  };
}
