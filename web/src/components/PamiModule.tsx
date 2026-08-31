import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  analizarPamiEnWorker,
  buildPamiPdfBase64,
  downloadPamiPdf,
  exportTodoXlsx,
  fileSlotFromStored,
  loadPamiDraft,
  mesLabelFromKey,
  parseDebitosFromArrayBuffer,
  parsePresentacionFromArrayBuffer,
  savePamiDraft,
  clearPamiDraft,
  storedFromSlot,
  arrayBufferToBase64,
  type FileParseMeta,
  type PamiAnalisisResult,
} from "../lib/pami";
import {
  deletePamiAnalisis,
  listPamiAnalisis,
  savePamiAnalisis,
} from "../services/dataService";
import { resumenFromResult, type PamiAnalisisGuardado } from "../types/pami";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconEye, IconTrash } from "./Icons";
import { PamiDetalleModal } from "./PamiDetalleModal";
import { PamiResultados } from "./PamiResultados";

type Tab = "analisis" | "historial";

type FileSlot = {
  file: File;
  buffer: ArrayBuffer;
  meta: FileParseMeta;
};

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function currentMesKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MES_INICIO_PAMI = "2026-07"; // Julio 2026

/** Mes anterior al actual (acotado a ≥ Julio 2026). */
function mesAnteriorKey(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return key < MES_INICIO_PAMI ? MES_INICIO_PAMI : key;
}

/** Meses desde Julio 2026 hasta el mes actual (inclusive). */
function buildMesOptions(): Array<{ value: string; label: string }> {
  const end = currentMesKey();
  const [endY, endM] = end.split("-").map(Number);
  const [startY, startM] = MES_INICIO_PAMI.split("-").map(Number);
  const opts: Array<{ value: string; label: string }> = [];
  let y = startY!;
  let m = startM!;
  // Si hoy es anterior a Julio 2026, igual mostrar al menos ese mes.
  const lastY = endY! < startY! || (endY === startY && endM! < startM!) ? startY! : endY!;
  const lastM = endY! < startY! || (endY === startY && endM! < startM!) ? startM! : endM!;
  while (y < lastY || (y === lastY && m <= lastM)) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    opts.push({ value, label: mesLabelFromKey(value) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return opts.reverse();
}

function DropZone({
  label,
  subtitle,
  slot,
  onFile,
}: {
  label: string;
  subtitle: string;
  slot: FileSlot | null;
  onFile: (file: File | null) => void;
}) {
  const [drag, setDrag] = useState(false);

  return (
    <div
      className={`pami-drop${drag ? " is-drag" : ""}${slot ? " has-file" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div className="pami-drop__head">
        <h3>{label}</h3>
        <p>{subtitle}</p>
      </div>
      {slot ? (
        <div className="pami-drop__file">
          <div>
            <p className="pami-drop__name">{slot.file.name}</p>
            <p className="pami-drop__meta">
              Formato OK · {slot.meta.filasDatos} filas válidas
              {slot.meta.filasDescartadas > 0
                ? ` · ${slot.meta.filasDescartadas} descartadas`
                : ""}
            </p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onFile(null)}>
            Quitar
          </button>
        </div>
      ) : (
        <label className="pami-drop__cta">
          <span>Arrastrá el Excel acá o hacé clic para elegir</span>
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

function readInitialDraft(): {
  mes: string;
  presentacion: FileSlot | null;
  debitos: FileSlot | null;
  result: PamiAnalisisResult | null;
} {
  const draft = loadPamiDraft();
  if (!draft) {
    return {
      mes: mesAnteriorKey(),
      presentacion: null,
      debitos: null,
      result: null,
    };
  }
  return {
    mes: draft.mes || mesAnteriorKey(),
    presentacion: draft.presentacion ? fileSlotFromStored(draft.presentacion) : null,
    debitos: draft.debitos ? fileSlotFromStored(draft.debitos) : null,
    result: draft.result ?? null,
  };
}

export function PamiModule() {
  const initial = useMemo(() => readInitialDraft(), []);
  const [tab, setTab] = useState<Tab>("analisis");
  const mesOptions = useMemo(() => buildMesOptions(), []);
  const [mes, setMes] = useState(initial.mes);
  const [presentacion, setPresentacion] = useState<FileSlot | null>(initial.presentacion);
  const [debitos, setDebitos] = useState<FileSlot | null>(initial.debitos);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PamiAnalisisResult | null>(initial.result);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<PamiAnalisisGuardado[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [aBorrar, setABorrar] = useState<PamiAnalisisGuardado | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Persistir borrador automáticamente (sobrevive cambio de módulo / F5)
  useEffect(() => {
    if (!hydrated) return;
    savePamiDraft({
      mes,
      presentacion: presentacion ? storedFromSlot(presentacion) : null,
      debitos: debitos ? storedFromSlot(debitos) : null,
      result,
    });
  }, [hydrated, mes, presentacion, debitos, result]);

  const loadHistorial = useCallback(async () => {
    setLoadingHist(true);
    try {
      const data = await listPamiAnalisis();
      setHistorial(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar el historial");
    } finally {
      setLoadingHist(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "historial") void loadHistorial();
  }, [tab, loadHistorial]);

  const assignPresentacion = async (file: File | null) => {
    setResult(null);
    setError(null);
    if (!file) {
      setPresentacion(null);
      return;
    }
    if (!isExcelFile(file)) {
      toast.error("Excel INECO: el archivo debe ser .xlsx o .xls");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parsePresentacionFromArrayBuffer(buffer, file.name);
      setPresentacion({ file, buffer, meta: parsed.meta });
      toast.success(`Excel ${file.name} OK`);
    } catch (err) {
      setPresentacion(null);
      const msg = err instanceof Error ? err.message : "No se pudo validar el Excel INECO";
      setError(msg);
      toast.error(msg, { autoClose: 8000 });
    }
  };

  const assignDebitos = async (file: File | null) => {
    setResult(null);
    setError(null);
    if (!file) {
      setDebitos(null);
      return;
    }
    if (!isExcelFile(file)) {
      toast.error("Excel PAMI: el archivo debe ser .xlsx o .xls");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseDebitosFromArrayBuffer(buffer, file.name);
      setDebitos({ file, buffer, meta: parsed.meta });
      toast.success(`Excel ${file.name} OK`);
    } catch (err) {
      setDebitos(null);
      const msg = err instanceof Error ? err.message : "No se pudo validar el Excel PAMI";
      setError(msg);
      toast.error(msg, { autoClose: 8000 });
    }
  };

  const onProcesar = async () => {
    if (!presentacion || !debitos) {
      toast.warn("Cargá ambos Excel (INECO y PAMI) antes de procesar");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      // Copiar buffers: el worker transfiere ownership
      const pBuf = presentacion.buffer.slice(0);
      const dBuf = debitos.buffer.slice(0);
      const out = await analizarPamiEnWorker(
        { buffer: pBuf, fileName: presentacion.file.name },
        { buffer: dBuf, fileName: debitos.file.name },
      );
      setResult(out);
      toast.success("Análisis listo");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al procesar";
      setError(msg);
      setResult(null);
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const onLimpiar = () => {
    setPresentacion(null);
    setDebitos(null);
    setResult(null);
    setError(null);
    clearPamiDraft();
    toast.info("Análisis limpiado");
  };

  const onGuardar = async () => {
    if (!result || !presentacion || !debitos) {
      toast.warn("Procesá ambos archivos antes de guardar");
      return;
    }
    setSaving(true);
    try {
      const pdfBase64 = buildPamiPdfBase64(result, mes);
      const saved = await savePamiAnalisis({
        mes,
        presentacionFileName: presentacion.file.name,
        debitosFileName: debitos.file.name,
        presentacionBase64: arrayBufferToBase64(presentacion.buffer),
        debitosBase64: arrayBufferToBase64(debitos.buffer),
        pdfBase64,
        resumen: resumenFromResult(result),
        resultado: result,
      });
      toast.success(`Guardado: ${saved.mesLabel}`);
      setPresentacion(null);
      setDebitos(null);
      setResult(null);
      setError(null);
      clearPamiDraft();
      await loadHistorial();
      setTab("historial");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const selected = historial.find((h) => h.id === selectedId) ?? null;

  const confirmarBorrar = async () => {
    if (!aBorrar) return;
    const id = aBorrar.id;
    setABorrar(null);
    try {
      await deletePamiAnalisis(id);
      if (selectedId === id) setSelectedId(null);
      await loadHistorial();
      toast.success("Eliminado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  };

  return (
    <div className={`app-shell${tab === "analisis" ? " app-shell--scroll" : ""}`}>
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>PAMI</h1>
            <p>Cruce Presentación INECO × Débitos PAMI</p>
          </div>
        </div>
      </header>

      <nav className="app-tabs app-tabs--full" aria-label="Secciones PAMI">
        <button
          type="button"
          className={`app-tabs__btn${tab === "analisis" ? " is-active" : ""}`}
          onClick={() => setTab("analisis")}
        >
          Análisis
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "historial" ? " is-active" : ""}`}
          onClick={() => setTab("historial")}
        >
          Historial
        </button>
      </nav>

      {tab === "analisis" ? (
        <>
          <section className="fl-table-card pami-upload-card">
            <div className="pami-upload-toolbar">
              <select
                id="pami-mes"
                className="pami-mes-select"
                aria-label="Mes"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              >
                {mesOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="pami-upload-actions">
                <button
                  type="button"
                  className="btn btn-secondary pami-btn-limpiar"
                  disabled={!presentacion && !debitos && !result && !error}
                  onClick={onLimpiar}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!result}
                  onClick={() => {
                    if (!result) return;
                    exportTodoXlsx(result, `pami-${mes}.xlsx`, { mesKey: mes });
                  }}
                >
                  Exportar Excel
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!result}
                  onClick={() => {
                    if (!result) return;
                    downloadPamiPdf(result, mes);
                  }}
                >
                  Descargar PDF
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={saving || !result}
                  onClick={() => void onGuardar()}
                >
                  {saving ? "Guardando…" : "Guardar mes"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary pami-btn-procesar"
                  disabled={processing || !presentacion || !debitos}
                  onClick={() => void onProcesar()}
                >
                  {processing ? "Procesando…" : "Procesar mes"}
                </button>
              </div>
            </div>

            <div className="pami-drops">
              <DropZone
                label="Excel INECO"
                subtitle="Presentación del mes (órdenes presentadas / activadas)"
                slot={presentacion}
                onFile={(f) => void assignPresentacion(f)}
              />
              <DropZone
                label="Excel PAMI"
                subtitle="Débitos / observaciones de la obra social"
                slot={debitos}
                onFile={(f) => void assignDebitos(f)}
              />
            </div>

            {error && (
              <p className="pami-error" role="alert">
                {error}
              </p>
            )}
          </section>

          {result && <PamiResultados result={result} />}
        </>
      ) : (
        <div className="pami-historial">
          <section className="fl-table-card">
            <div className="table-toolbar">
              <h2 className="pami-section__title">Meses guardados</h2>
            </div>
            <div className="table-wrap">
              <table className="pami-table pami-table--historial">
                <thead>
                  <tr>
                    <th className="pami-col-mes">Mes</th>
                    <th className="pami-col-num">Coincidentes</th>
                    <th className="pami-col-num">Observadas</th>
                    <th className="pami-col-num">OPs</th>
                    <th className="pami-col-motivo">Motivo</th>
                    <th className="fl-col-actions fl-col-actions--2">Acciones</th>
                  </tr>
                </thead>
                {!loadingHist && historial.length > 0 ? (
                  <tbody>
                    {historial.map((h) => {
                      const motivos = h.resultado?.motivos ?? [];
                      const coincidencias = h.resultado?.coincidencias ?? [];
                      const soloPres =
                        h.resumen.soloEnPresentacion ??
                        h.resultado?.resumen?.soloEnPresentacion ??
                        0;
                      const soloDeb =
                        h.resumen.soloEnDebitos ??
                        h.resultado?.resumen?.soloEnDebitos ??
                        0;
                      const cant =
                        h.resumen.motivoDominanteCantidad ||
                        motivos[0]?.cantidad ||
                        0;
                      return (
                      <tr
                        key={h.id}
                        className={selectedId === h.id ? "is-selected" : undefined}
                      >
                        <td className="pami-col-mes">{h.mesLabel}</td>
                        <td className="pami-col-num">
                          {h.resumen.coincidentes > 0 ? (
                            <span className="pami-tip pami-tip--start">
                              <button
                                type="button"
                                className="pami-tip__trigger"
                                aria-describedby={`pami-coinc-${h.id}`}
                              >
                                {h.resumen.coincidentes}
                              </button>
                              <span
                                id={`pami-coinc-${h.id}`}
                                className="pami-tip__bubble"
                                role="tooltip"
                              >
                                <span className="pami-tip__title">Afiliados coincidentes</span>
                                {coincidencias.length > 0 ? (
                                  <ul className="pami-tip__list pami-tip__list--coinc">
                                    {coincidencias.slice(0, 12).map((c) => (
                                      <li key={c.afiliadoNormalizado}>
                                        <span className="pami-tip__nombre" title={c.nombre}>
                                          {c.nombre}
                                        </span>
                                        <span className="pami-tip__meta" title={c.afiliadoOriginal}>
                                          {c.afiliadoOriginal}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="pami-tip__fallback">
                                    {h.resumen.coincidentes} afiliado(s) en ambos archivos
                                  </p>
                                )}
                                <p className="pami-tip__foot">
                                  Solo presentación: {soloPres}
                                  {" · "}
                                  Solo débitos: {soloDeb}
                                  {coincidencias.length > 12
                                    ? ` · +${coincidencias.length - 12} más`
                                    : null}
                                </p>
                              </span>
                            </span>
                          ) : (
                            h.resumen.coincidentes
                          )}
                        </td>
                        <td className="pami-col-num">{h.resumen.prestacionesObservadas}</td>
                        <td className="pami-col-num">{h.resumen.opsPresentadas}</td>
                        <td className="pami-col-motivo">
                          {cant > 0 ? (
                            <span className="pami-tip">
                              <button
                                type="button"
                                className="pami-tip__trigger"
                                aria-describedby={`pami-motivos-${h.id}`}
                              >
                                {cant}
                              </button>
                              <span
                                id={`pami-motivos-${h.id}`}
                                className="pami-tip__bubble"
                                role="tooltip"
                              >
                                <span className="pami-tip__title">Motivos de rechazo</span>
                                {motivos.length > 0 ? (
                                  <ul className="pami-tip__list pami-tip__list--motivos">
                                    {motivos.map((m) => (
                                      <li key={m.motivo}>
                                        <span className="pami-tip__motivo" title={m.motivo}>
                                          {m.motivo}
                                        </span>
                                        <span className="pami-tip__stats">
                                          <span className="pami-tip__cant">{m.cantidad}</span>
                                          <span className="pami-tip__pct">
                                            {m.porcentaje.toFixed(0)}%
                                          </span>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : h.resumen.motivoDominante ? (
                                  <p className="pami-tip__fallback" title={h.resumen.motivoDominante}>
                                    {h.resumen.motivoDominante}
                                  </p>
                                ) : null}
                              </span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="fl-col-actions fl-col-actions--2">
                          <div className="fl-table-actions fl-table-actions--2">
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--view"
                              title="Ver detalle"
                              onClick={() => setSelectedId(h.id)}
                            >
                              <IconEye size={15} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--danger"
                              title="Eliminar"
                              onClick={() => setABorrar(h)}
                            >
                              <IconTrash size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                ) : null}
              </table>
              {loadingHist && historial.length === 0 ? (
                <div className="fl-table-empty fl-table-empty--fill">
                  <p className="fl-table-empty__title">Cargando…</p>
                </div>
              ) : historial.length === 0 ? (
                <div className="fl-table-empty fl-table-empty--fill">
                  <p className="fl-table-empty__title">Sin análisis guardados</p>
                  <p className="fl-table-empty__hint">
                    Procesá un mes en la pestaña Análisis y usá «Guardar mes».
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <PamiDetalleModal
            open={Boolean(selected)}
            item={selected}
            onClose={() => setSelectedId(null)}
          />

          <ConfirmDialog
            open={aBorrar !== null}
            title="Eliminar análisis"
            message={
              aBorrar
                ? `¿Eliminar el análisis de ${aBorrar.mesLabel}? Esta acción no se puede deshacer.`
                : ""
            }
            confirmLabel="Eliminar"
            onConfirm={() => void confirmarBorrar()}
            onCancel={() => setABorrar(null)}
          />
        </div>
      )}
    </div>
  );
}
