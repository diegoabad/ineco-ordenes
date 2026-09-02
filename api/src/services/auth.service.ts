import { createRemoteJWKSet, jwtVerify } from "jose";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AppModuleId, AppUser, AppUserPublic, UserRole } from "../types.js";
import { ALL_APP_MODULES } from "../types.js";
import {
  approveUser,
  createOAuthUser,
  getAuthAccessConfig,
  getUserByEmail,
  getUserById,
  reopenAsPending,
  toPublicUser,
} from "./users.service.js";

export const SESSION_COOKIE = "ordenes_session";

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  modules: AppModuleId[];
};

const firebaseJwks = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}

export async function isEmailDomainAllowed(email: string): Promise<boolean> {
  const { allowedDomains } = await getAuthAccessConfig();
  if (allowedDomains.length === 0) return true;
  const domain = domainOf(email);
  return allowedDomains.includes(domain);
}

export function signSessionToken(user: AppUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    modules: user.modules,
  };
  return jwt.sign(payload, env.auth.jwtSecret, {
    expiresIn: `${env.auth.jwtDays}d`,
    algorithm: "HS256",
  });
}

export function verifySessionToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.auth.jwtSecret, {
    algorithms: ["HS256"],
  });
  if (!decoded || typeof decoded !== "object" || !("sub" in decoded)) {
    throw new Error("Token inválido");
  }
  const payload = decoded as jwt.JwtPayload & Partial<JwtPayload>;
  if (!payload.sub || !payload.email || !payload.role) {
    throw new Error("Token inválido");
  }
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    role: payload.role === "admin" ? "admin" : "user",
    modules: Array.isArray(payload.modules)
      ? (payload.modules as AppModuleId[])
      : [],
  };
}

export function sessionCookieOptions() {
  const maxAgeMs = env.auth.jwtDays * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    secure: env.auth.cookieSecure,
    sameSite: "lax" as const,
    maxAge: maxAgeMs,
    path: "/",
  };
}

export type AuthResult =
  | { kind: "ok"; user: AppUserPublic; token: string }
  | { kind: "pending"; user: AppUserPublic }
  | { kind: "rejected" };

type FirebaseIdClaims = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  sub?: string;
};

export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<FirebaseIdClaims> {
  const projectId = env.firebase.projectId;
  const { payload } = await jwtVerify(idToken, firebaseJwks, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  return payload as FirebaseIdClaims;
}

function isBootstrapAdminEmail(email: string): boolean {
  const bootstrap = env.auth.bootstrapAdminEmail;
  return Boolean(bootstrap && email === bootstrap);
}

/** Login / primer acceso con Google o Microsoft (Firebase ID token). */
export async function loginWithFirebaseIdToken(
  idToken: string,
): Promise<AuthResult> {
  const claims = await verifyFirebaseIdToken(idToken);
  const email = String(claims.email ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("La cuenta no tiene un email válido");
  }
  if (claims.email_verified === false) {
    throw new Error("Verificá tu email antes de ingresar");
  }
  if (!(await isEmailDomainAllowed(email)) && !isBootstrapAdminEmail(email)) {
    throw new Error("El dominio de email no está autorizado");
  }

  const nombre = String(claims.name ?? "").trim() || email.split("@")[0] || "Usuario";
  const asBootstrapAdmin = isBootstrapAdminEmail(email);

  let user = await getUserByEmail(email);
  if (!user) {
    // Primer intento de login → entra a Pendientes (sin registro aparte)
    user = await createOAuthUser({
      email,
      nombre,
      asBootstrapAdmin,
    });
  } else if (asBootstrapAdmin && user.status !== "approved") {
    user = await approveUser(user.id, {
      role: "admin",
      modules: [...ALL_APP_MODULES],
    });
  } else if (user.status === "rejected") {
    // Vuelve a intentar → otra vez a la lista de espera
    user = await reopenAsPending(user.id, nombre);
  } else if (user.status === "pending" && nombre && nombre !== user.nombre) {
    user = await reopenAsPending(user.id, nombre);
  }

  if (user.status === "pending") {
    return { kind: "pending", user: toPublicUser(user) };
  }
  if (user.status === "rejected") {
    return { kind: "rejected" };
  }

  const token = signSessionToken(user);
  return { kind: "ok", user: toPublicUser(user), token };
}

export async function loadSessionUser(
  userId: string,
): Promise<AppUserPublic | null> {
  const user = await getUserById(userId);
  if (!user || user.status !== "approved") return null;
  return toPublicUser(user);
}

export function getPublicFirebaseConfig() {
  return {
    apiKey: env.firebase.apiKey,
    authDomain: env.firebase.authDomain,
    projectId: env.firebase.projectId,
    storageBucket: env.firebase.storageBucket,
    messagingSenderId: env.firebase.messagingSenderId,
    appId: env.firebase.appId,
    measurementId: env.firebase.measurementId,
  };
}
