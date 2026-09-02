import { Router } from "express";
import {
  requireAuth,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.middleware.js";
import {
  sendUserApprovedEmail,
  sendUserRejectedEmail,
} from "../services/auth-email.service.js";
import {
  approveUser,
  getAuthAccessConfig,
  listUsersByStatus,
  rejectUser,
  saveAuthAccessConfig,
  toPublicUser,
  updateApprovedUser,
} from "../services/users.service.js";
import type { AppModuleId, ApproveUserInput, UserRole } from "../types.js";
import { clearEmailErrorMessage } from "../services/email.service.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));

function paramId(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

function parseApproveBody(body: unknown): ApproveUserInput {
  const raw = body as Record<string, unknown>;
  const role: UserRole = raw.role === "admin" ? "admin" : "user";
  const modules = Array.isArray(raw.modules)
    ? (raw.modules.filter(
        (m): m is AppModuleId =>
          m === "ordenes" ||
          m === "presupuestos" ||
          m === "pami" ||
          m === "busca-turno" ||
          m === "pedidos-sistema" ||
          m === "usuarios",
      ) as AppModuleId[])
    : [];
  return { role, modules };
}

router.get("/config/dominios", async (_req, res) => {
  try {
    const data = await getAuthAccessConfig();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer dominios",
    });
  }
});

router.put("/config/dominios", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const data = await saveAuthAccessConfig({
      allowedDomains: Array.isArray(body.allowedDomains)
        ? body.allowedDomains.map((d) => String(d))
        : String(body.domainsText ?? "")
            .split(/[\s,;]+/)
            .map((d) => d.trim())
            .filter(Boolean),
    });
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo guardar",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const statusRaw = String(req.query.status ?? "approved");
    const status =
      statusRaw === "pending" || statusRaw === "rejected" ? statusRaw : "approved";
    const users = await listUsersByStatus(status);
    res.json({ ok: true, data: users.map(toPublicUser) });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar usuarios",
    });
  }
});

router.post("/:id/approve", async (req: AuthedRequest, res) => {
  try {
    const id = paramId(req);
    if (id === req.user?.id) {
      // permitir auto-edición solo vía update; approve de sí mismo no aplica
    }
    const input = parseApproveBody(req.body);
    const user = await approveUser(id, input);
    const publicUser = toPublicUser(user);

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendUserApprovedEmail(publicUser);
    } catch (err) {
      emailSent = false;
      emailError = clearEmailErrorMessage(err);
      console.error("Error enviando mail de aprobación:", err);
    }

    res.json({
      ok: true,
      data: { user: publicUser, emailSent, emailError },
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo aprobar",
    });
  }
});

router.post("/:id/reject", async (req, res) => {
  try {
    const id = paramId(req);
    const user = await rejectUser(id);
    const publicUser = toPublicUser(user);

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendUserRejectedEmail(publicUser);
    } catch (err) {
      emailSent = false;
      emailError = clearEmailErrorMessage(err);
      console.error("Error enviando mail de rechazo:", err);
    }

    res.json({
      ok: true,
      data: { user: publicUser, emailSent, emailError },
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo rechazar",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = paramId(req);
    const input = parseApproveBody(req.body);
    const user = await updateApprovedUser(id, input);
    res.json({ ok: true, data: toPublicUser(user) });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo actualizar",
    });
  }
});

export default router;
