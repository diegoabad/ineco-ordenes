import { listMedicos, listPresupuestos, setMedicoFirmaUrl } from "./db.service.js";
import { firmaPublicUrl, resolveFirmaPath } from "./image.service.js";
import { resolvePresupuestoPdfPath } from "./presupuesto-pdf.service.js";

export type UploadsReconcileReport = {
  firmasOk: number;
  firmasRecuperadas: number;
  firmasFaltantes: number;
  presupuestosOk: number;
  presupuestosFaltantes: number;
};

/**
 * Al levantar el contenedor: busca firmas/PDFs en rutas legacy y los deja
 * en la carpeta canónica del volumen para que nginx/API los sirvan.
 */
export async function reconcileUploadsOnStartup(): Promise<UploadsReconcileReport> {
  const report: UploadsReconcileReport = {
    firmasOk: 0,
    firmasRecuperadas: 0,
    firmasFaltantes: 0,
    presupuestosOk: 0,
    presupuestosFaltantes: 0,
  };

  try {
    const medicos = await listMedicos();
    for (const medico of medicos) {
      if (!medico.firmaUrl?.trim()) continue;

      const resolved = await resolveFirmaPath(medico.id, medico.firmaUrl);
      if (!resolved) {
        report.firmasFaltantes += 1;
        console.warn(
          `[uploads-reconcile] Firma faltante medico=${medico.id} url=${medico.firmaUrl}`,
        );
        continue;
      }

      const expected = firmaPublicUrl(medico.id);
      let touched = resolved.recovered;
      if (medico.firmaUrl !== expected) {
        try {
          await setMedicoFirmaUrl(medico.id, expected);
          touched = true;
          console.warn(
            `[uploads-reconcile] firmaUrl actualizada ${medico.id}: ${medico.firmaUrl} → ${expected}`,
          );
        } catch (error) {
          console.error(`[uploads-reconcile] No se pudo actualizar firmaUrl de ${medico.id}`, error);
        }
      }

      if (touched) report.firmasRecuperadas += 1;
      else report.firmasOk += 1;
    }
  } catch (error) {
    console.error("[uploads-reconcile] Error reconciliando firmas", error);
  }

  try {
    const presupuestos = await listPresupuestos();
    for (const p of presupuestos) {
      if (!p.pdfUrl?.trim()) continue;
      const resolved = await resolvePresupuestoPdfPath(p.id);
      if (!resolved) {
        report.presupuestosFaltantes += 1;
        continue;
      }
      report.presupuestosOk += 1;
    }
  } catch (error) {
    console.error("[uploads-reconcile] Error reconciliando PDFs de presupuestos", error);
  }

  console.log(
    `[uploads-reconcile] firmas ok=${report.firmasOk} recuperadas=${report.firmasRecuperadas} faltantes=${report.firmasFaltantes} | ` +
      `presupuestos ok=${report.presupuestosOk} faltantes=${report.presupuestosFaltantes}`,
  );

  return report;
}
