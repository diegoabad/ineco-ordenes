import { randomUUID } from "node:crypto";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import type { PamiAnalisis, PamiAnalisisCreateInput, PamiAnalisisResumen } from "../types.js";
import { deletePamiAnalisisFiles, savePamiFile } from "./pami-files.service.js";

const PAMI_ANALISIS = "pami_analisis";

function nowIso(): string {
  return new Date().toISOString();
}

const MESES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** Ej: "2026-07" → "Julio 2026" (sin "de"). */
function mesLabelFromKey(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return mes;
  return `${MESES_ES[m - 1]} ${y}`;
}

function normalizeResumen(raw: unknown): PamiAnalisisResumen {
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
    soloEnPresentacion: Number(o.soloEnPresentacion ?? 0) || 0,
    soloEnDebitos: Number(o.soloEnDebitos ?? 0) || 0,
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

function normalizeAnalisis(id: string, raw: Record<string, unknown>): PamiAnalisis {
  const mes = String(raw.mes ?? "").trim();
  return {
    id,
    mes,
    mesLabel: mesLabelFromKey(mes) || String(raw.mesLabel ?? "").trim(),
    presentacionFileName: String(raw.presentacionFileName ?? ""),
    debitosFileName: String(raw.debitosFileName ?? ""),
    presentacionUrl:
      typeof raw.presentacionUrl === "string" && raw.presentacionUrl.trim()
        ? raw.presentacionUrl.trim()
        : null,
    debitosUrl:
      typeof raw.debitosUrl === "string" && raw.debitosUrl.trim()
        ? raw.debitosUrl.trim()
        : null,
    pdfUrl: typeof raw.pdfUrl === "string" && raw.pdfUrl.trim() ? raw.pdfUrl.trim() : null,
    resumen: normalizeResumen(raw.resumen),
    resultado:
      raw.resultado && typeof raw.resultado === "object"
        ? (raw.resultado as Record<string, unknown>)
        : {},
    creadoAt: typeof raw.creadoAt === "string" ? raw.creadoAt : undefined,
  };
}

function payload(a: PamiAnalisis): Record<string, unknown> {
  return {
    mes: a.mes,
    mesLabel: a.mesLabel,
    presentacionFileName: a.presentacionFileName,
    debitosFileName: a.debitosFileName,
    presentacionUrl: a.presentacionUrl,
    debitosUrl: a.debitosUrl,
    pdfUrl: a.pdfUrl,
    resumen: a.resumen,
    resultado: a.resultado,
    creadoAt: a.creadoAt ?? null,
  };
}

export async function listPamiAnalisis(): Promise<PamiAnalisis[]> {
  const snap = await getDocs(collection(firestore, PAMI_ANALISIS));
  const items = snap.docs.map((d) => normalizeAnalisis(d.id, d.data() as Record<string, unknown>));
  return items.sort((a, b) => {
    const mesCmp = b.mes.localeCompare(a.mes);
    if (mesCmp !== 0) return mesCmp;
    return String(b.creadoAt ?? "").localeCompare(String(a.creadoAt ?? ""));
  });
}

export async function getPamiAnalisis(id: string): Promise<PamiAnalisis | null> {
  const snap = await getDoc(doc(firestore, PAMI_ANALISIS, id));
  if (!snap.exists()) return null;
  return normalizeAnalisis(snap.id, snap.data() as Record<string, unknown>);
}

export async function createPamiAnalisis(input: PamiAnalisisCreateInput): Promise<PamiAnalisis> {
  const mes = input.mes.trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new Error("El mes debe tener formato YYYY-MM");
  }

  // Un análisis por mes: si existe, se reemplaza
  const existing = await listPamiAnalisis();
  const prev = existing.find((a) => a.mes === mes);
  const id = prev?.id ?? randomUUID();
  if (prev) {
    await deletePamiAnalisisFiles(prev.id);
  }

  const presentacion = await savePamiFile(id, "presentacion", input.presentacionBase64, "xlsx");
  const debitos = await savePamiFile(id, "debitos", input.debitosBase64, "xlsx");
  const pdf = await savePamiFile(id, "pdf", input.pdfBase64, "pdf");

  const analisis: PamiAnalisis = {
    id,
    mes,
    mesLabel: mesLabelFromKey(mes),
    presentacionFileName: input.presentacionFileName.trim() || "presentacion.xlsx",
    debitosFileName: input.debitosFileName.trim() || "debitos.xlsx",
    presentacionUrl: presentacion.publicUrl,
    debitosUrl: debitos.publicUrl,
    pdfUrl: pdf.publicUrl,
    resumen: normalizeResumen(input.resumen),
    resultado: input.resultado ?? {},
    creadoAt: nowIso(),
  };

  await setDoc(doc(firestore, PAMI_ANALISIS, id), payload(analisis));
  return analisis;
}

export async function deletePamiAnalisis(id: string): Promise<void> {
  const existing = await getDoc(doc(firestore, PAMI_ANALISIS, id));
  if (!existing.exists()) throw new Error("Análisis no encontrado");
  await deletePamiAnalisisFiles(id);
  await deleteDoc(doc(firestore, PAMI_ANALISIS, id));
}
