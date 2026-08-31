import type { ResultadoPami } from "../lib/pami";

export type PamiAnalisisResumen = {
  coincidentes: number;
  prestacionesObservadas: number;
  opsPresentadas: number;
  afiliadosUnicosObservados: number;
  soloEnPresentacion: number;
  soloEnDebitos: number;
  conteoModulo: Record<string, number>;
  conteoPrestacion: Record<string, number>;
  concentracion125: {
    afiliados: number;
    totalPrestaciones: number;
    conMasDeUna: number;
  };
  motivoDominante: string | null;
  motivoDominanteCantidad: number;
};

export type PamiAnalisisGuardado = {
  id: string;
  mes: string;
  mesLabel: string;
  presentacionFileName: string;
  debitosFileName: string;
  presentacionUrl: string | null;
  debitosUrl: string | null;
  pdfUrl: string | null;
  resumen: PamiAnalisisResumen;
  resultado: ResultadoPami;
  creadoAt?: string;
};

export function resumenFromResult(result: ResultadoPami): PamiAnalisisResumen {
  const dominante = result.motivos[0];
  const r = result.resumen;
  return {
    coincidentes: r.afiliadosCoincidentes,
    prestacionesObservadas: r.prestacionesObservadas,
    opsPresentadas: r.opsPresentadas,
    afiliadosUnicosObservados: r.afiliadosObservados,
    soloEnPresentacion: r.soloEnPresentacion,
    soloEnDebitos: r.soloEnDebitos,
    conteoModulo: r.opsPorModulo,
    conteoPrestacion: r.prestacionesPorCodigo,
    concentracion125: {
      afiliados: r.concentracion125.afiliadosUnicos,
      totalPrestaciones: r.concentracion125.totalPrestaciones,
      conMasDeUna: r.concentracion125.conMasDeUna,
    },
    motivoDominante: dominante?.motivo ?? null,
    motivoDominanteCantidad: dominante?.cantidad ?? 0,
  };
}
