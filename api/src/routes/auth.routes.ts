import { Router } from "express";
import { env } from "../config/env.js";
import {
  getPublicFirebaseConfig,
  loginWithFirebaseIdToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../services/auth.service.js";
import {
  requireAuth,
  type AuthedRequest,
} from "../middleware/auth.middleware.js";

const router = Router();

/** Config pública de Firebase Auth (apiKey es pública por diseño). */
router.get("/config", (_req, res) => {
  res.json({
    ok: true,
    data: {
      firebase: getPublicFirebaseConfig(),
      authDisabled: env.auth.disabled,
      microsoftTenantId: env.auth.microsoftTenantId || null,
    },
  });
});

router.post("/oauth", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const idToken = String(body.idToken ?? "").trim();
    if (!idToken) {
      res.status(400).json({
        ok: false,
        message: "No se pudo completar el acceso. Intentá de nuevo.",
      });
      return;
    }

    const result = await loginWithFirebaseIdToken(idToken);

    if (result.kind === "pending") {
      res.status(403).json({
        ok: false,
        code: "PENDING",
        message:
          "Si todavía no tenés acceso, tu solicitud queda en espera de aprobación.",
        data: { user: result.user },
      });
      return;
    }

    if (result.kind === "rejected") {
      res.status(403).json({
        ok: false,
        code: "REJECTED",
        message:
          "Tu solicitud de acceso fue rechazada. Si creés que es un error, contactá al administrador.",
      });
      return;
    }

    res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions());
    res.json({ ok: true, data: { user: result.user } });
  } catch (error) {
    console.error("OAuth login error:", error);
    const raw = error instanceof Error ? error.message : "";
    let message = "No se pudo iniciar sesión. Intentá de nuevo en unos segundos.";
    if (/dominio/i.test(raw)) {
      message = "Tu email no pertenece a un dominio autorizado para esta app.";
    } else if (/email válido/i.test(raw)) {
      message = "La cuenta no tiene un email válido. Probá con otra cuenta.";
    } else if (/Verificá tu email/i.test(raw)) {
      message = "Verificá tu email en Google o Microsoft y volvé a intentar.";
    } else if (/permission|insufficient|firestore/i.test(raw)) {
      message =
        "No se pudo guardar tu solicitud de acceso. Pedile a sistemas que revise la configuración.";
    } else if (/FIREBASE_TOKEN_INVALID|token|jwt|claim|expir/i.test(raw)) {
      message =
        "No se pudo validar el acceso con Google/Microsoft. Revisá que en Firebase estén activos los providers y que localhost esté en Authorized domains.";
    }
    res.status(401).json({ ok: false, message });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  res.json({
    ok: true,
    data: {
      user: req.user,
      authDisabled: env.auth.disabled,
    },
  });
});

export default router;
