import { Router } from "express";
import {
  createPamiAnalisis,
  deletePamiAnalisis,
  getPamiAnalisis,
  listPamiAnalisis,
} from "../services/pami.service.js";
import type { PamiAnalisisCreateInput, PamiAnalisisResumen } from "../types.js";

const router = Router();

function parseResumen(raw: unknown): PamiAnalisisResumen {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const conc =
    o.concentracion125 && typeof o.concentracion125 === "object"
      ? (o.concentracion125 as Record<string, unknown>)
      : {};
  return {
    coincidentes: Number(o.coincidentes ?? 0) || 0,
    prestacionesObservadas: Number(o.prestacionesObservadas ?? 0) || 0,
    opsPresentadas: Number(o.opsPresentadas ?? 0) || 0,
    afiliadosUnicosObservados: Number(o.afiliadosUnicosObservados ?? 0) || 0,
    conteoModulo:
      o.conteoModulo && typeof o.conteoModulo === "object"
        ? (o.conteoModulo as Record<string, number>)
        : {},
    conteoPrestacion:
      o.conteoPrestacion && typeof o.conteoPrestacion === "object"
        ? (o.conteoPrestacion as Record<string, number>)
        : {},
    concentracion125: {
      afiliados: Number(conc.afiliados ?? 0) || 0,
      totalPrestaciones: Number(conc.totalPrestaciones ?? 0) || 0,
      conMasDeUna: Number(conc.conMasDeUna ?? 0) || 0,
    },
    motivoDominante:
      typeof o.motivoDominante === "string" && o.motivoDominante.trim()
        ? o.motivoDominante.trim()
        : null,
    motivoDominanteCantidad: Number(o.motivoDominanteCantidad ?? 0) || 0,
  };
}

function parseCreateBody(body: unknown): PamiAnalisisCreateInput {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const mes = String(o.mes ?? "").trim();
  if (!mes) throw new Error("Falta el mes");
  const presentacionBase64 = String(o.presentacionBase64 ?? "").trim();
  const debitosBase64 = String(o.debitosBase64 ?? "").trim();
  const pdfBase64 = String(o.pdfBase64 ?? "").trim();
  if (!presentacionBase64 || !debitosBase64 || !pdfBase64) {
    throw new Error("Faltan archivos (presentación, débitos o PDF)");
  }
  if (!o.resultado || typeof o.resultado !== "object") {
    throw new Error("Falta el resultado del análisis");
  }
  return {
    mes,
    presentacionFileName: String(o.presentacionFileName ?? "presentacion.xlsx"),
    debitosFileName: String(o.debitosFileName ?? "debitos.xlsx"),
    presentacionBase64,
    debitosBase64,
    pdfBase64,
    resumen: parseResumen(o.resumen),
    resultado: o.resultado as Record<string, unknown>,
  };
}

router.get("/", async (_req, res) => {
  try {
    const data = await listPamiAnalisis();
    res.json({ ok: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar análisis PAMI",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const data = await getPamiAnalisis(String(req.params.id));
    if (!data) {
      res.status(404).json({ ok: false, message: "Análisis no encontrado" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al obtener análisis PAMI",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = parseCreateBody(req.body);
    const data = await createPamiAnalisis(input);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar análisis PAMI",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deletePamiAnalisis(String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : "Error al eliminar";
    const status = msg.includes("no encontrado") ? 404 : 500;
    res.status(status).json({ ok: false, message: msg });
  }
});

export default router;
