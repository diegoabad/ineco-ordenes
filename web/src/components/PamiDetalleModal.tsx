import { resolveAssetUrl } from "../config/api";
import { downloadPamiPdf, exportTodoXlsx } from "../lib/pami";
import type { PamiAnalisisGuardado } from "../types/pami";
import { IconDownload, IconFile, IconPdf, IconX } from "./Icons";
import { PamiResultados } from "./PamiResultados";

type Props = {
  open: boolean;
  item: PamiAnalisisGuardado | null;
  onClose: () => void;
};

export function PamiDetalleModal({ open, item, onClose }: Props) {
  if (!open || !item) return null;

  const puedeExportar = Boolean(item.resultado?.resumen || item.resultado?.coincidencias);
  const tieneAnalizados = Boolean(item.presentacionUrl || item.debitosUrl);

  return (
    <div
      className="fl-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="fl-modal fl-modal--pami"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pami-detalle-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-modal__header">
          <div>
            <h2 id="pami-detalle-title">{item.mesLabel}</h2>
            <p className="fl-modal__subtitle">
              {item.presentacionFileName} · {item.debitosFileName}
            </p>
          </div>
          <button type="button" className="fl-icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX size={18} />
          </button>
        </div>

        <div className="pami-detalle-toolbar">
          <div className="pami-detalle-toolbar__group">
            <span className="pami-detalle-toolbar__label">Exportar resultados</span>
            <div className="pami-detalle-toolbar__actions">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!puedeExportar}
                onClick={() => {
                  if (!item.resultado) return;
                  exportTodoXlsx(item.resultado, `pami-${item.mes}.xlsx`, {
                mesKey: item.mes,
              });
                }}
              >
                <IconDownload size={14} />
                Excel
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!puedeExportar}
                onClick={() => {
                  if (!item.resultado) return;
                  downloadPamiPdf(item.resultado, item.mes);
                }}
              >
                <IconPdf size={14} />
                PDF
              </button>
            </div>
          </div>

          {tieneAnalizados ? (
            <div className="pami-detalle-toolbar__group">
              <span className="pami-detalle-toolbar__label">Excels analizados</span>
              <div className="pami-detalle-toolbar__actions">
                {item.presentacionUrl && (
                  <a
                    className="btn btn-outline btn-sm"
                    href={resolveAssetUrl(item.presentacionUrl) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    title={item.presentacionFileName}
                  >
                    <IconFile size={14} />
                    INECO
                  </a>
                )}
                {item.debitosUrl && (
                  <a
                    className="btn btn-outline btn-sm"
                    href={resolveAssetUrl(item.debitosUrl) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    title={item.debitosFileName}
                  >
                    <IconFile size={14} />
                    PAMI
                  </a>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="fl-modal__body fl-modal__body--pami">
          {puedeExportar && item.resultado ? (
            <PamiResultados result={item.resultado} compact />
          ) : (
            <p className="text-muted">No hay detalle de resultados guardado.</p>
          )}
        </div>
      </div>
    </div>
  );
}
