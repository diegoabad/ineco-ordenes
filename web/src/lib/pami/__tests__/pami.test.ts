import { describe, expect, it } from "vitest";
import { coincidenciasSinNormalizar, cruzarPami } from "../cruzar";
import { normalizarAfiliado } from "../normalizar";
import { parseDebitosFromMatrix } from "../parseDebitos";
import { parsePresentacionFromMatrix } from "../parsePresentacion";
import { ExcelFormatoError } from "../schema";
import type { DebitoRow, PresentacionRow } from "../types";

describe("normalizarAfiliado", () => {
  it("unifica espacio común y NBSP alrededor del guion", () => {
    const a = normalizarAfiliado("150465097406 - 00");
    const b = normalizarAfiliado("150465097406\u00A0-\u00A000");
    expect(a).toBe("15046509740600");
    expect(b).toBe("15046509740600");
    expect(a).toBe(b);
  });

  it("tolera espacios sobrantes al final", () => {
    expect(normalizarAfiliado("150465097406 - 00   ")).toBe("15046509740600");
  });

  it("descarta totales / textos sin afiliado válido", () => {
    expect(normalizarAfiliado("Prestacion")).toBeNull();
    expect(normalizarAfiliado("125")).toBeNull();
    expect(normalizarAfiliado("Debito 140")).toBeNull();
    expect(normalizarAfiliado("")).toBeNull();
  });
});

describe("validación de formato Excel", () => {
  it("acepta Presentación INECO con columnas correctas y N filas dinámicas", () => {
    const rows = [
      ["", "Nombre y apellido", "Modulo", "N° de Afiliado", "N° OME", "Número de OP", "Fecha", "Activada"],
      ["1", "A", "125001", "150465097406 - 00", "1", "11", "01/07/2026", "02/07/2026"],
      ["2", "B", "140010", "145201263009 - 00", "2", "22", "02/07/2026", "02/07/2026"],
      ["3", "C", "125001", "111111111111 - 00", "3", "33", "03/07/2026", "03/07/2026"],
    ];
    const parsed = parsePresentacionFromMatrix(rows, "julio.xlsx");
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]?.fecha).toBe("2026-07-01");
  });

  it("rechaza Presentación INECO si faltan columnas y lista todas", () => {
    const rows = [
      ["Nombre y apellido", "Modulo", "N° de Afiliado"],
      ["A", "125001", "150465097406 - 00"],
    ];
    expect(() => parsePresentacionFromMatrix(rows, "malo.xlsx")).toThrow(ExcelFormatoError);
    try {
      parsePresentacionFromMatrix(rows, "malo.xlsx");
    } catch (e) {
      expect(e).toBeInstanceOf(ExcelFormatoError);
      const err = e as ExcelFormatoError;
      expect(err.archivo).toBe("INECO");
      expect(err.faltantes).toEqual(
        expect.arrayContaining(["N° OME", "Número de OP", "Fecha", "Activada"]),
      );
    }
  });

  it("acepta Débitos PAMI con encabezados en fila 2 y N filas dinámicas", () => {
    const rows = [
      ["", "", "reporte"],
      ["", "", "ORDEn", "Fecha", "Afiliado", "Prestacion", "TIPO"],
      ["", "", "MOTIVO X", "10/07/2026", "150465097406\u00A0-\u00A000", "125", "A"],
      ["", "", "MOTIVO Y", "11/07/2026", "145201263009\u00A0-\u00A000", "140", "B"],
    ];
    const parsed = parseDebitosFromMatrix(rows, "libro.xlsx");
    expect(parsed.rows).toHaveLength(2);
  });

  it("rechaza Débitos PAMI si faltan columnas", () => {
    const rows = [
      ["ORDEn", "Fecha", "Afiliado"],
      ["X", "10/07/2026", "150465097406 - 00"],
    ];
    expect(() => parseDebitosFromMatrix(rows, "malo.xlsx")).toThrow(ExcelFormatoError);
    try {
      parseDebitosFromMatrix(rows, "malo.xlsx");
    } catch (e) {
      const err = e as ExcelFormatoError;
      expect(err.archivo).toBe("PAMI");
      expect(err.faltantes).toEqual(expect.arrayContaining(["Prestacion", "TIPO"]));
    }
  });
});

describe("contrato ResultadoPami", () => {
  const presentacion: PresentacionRow[] = [
    {
      nombreApellido: "COZZO ANA MARIA",
      modulo: "125001",
      afiliadoOriginal: "150465097406 - 00",
      afiliadoKey: normalizarAfiliado("150465097406 - 00")!,
      nroOme: "3326322778296",
      nroOp: "9934584773",
      fecha: "2026-07-01",
      activada: "2026-07-02",
    },
    {
      nombreApellido: "PACHECO MIRTA JOSEFINA",
      modulo: "140010",
      afiliadoOriginal: "145201263009 - 00",
      afiliadoKey: normalizarAfiliado("145201263009 - 00")!,
      nroOme: "3326109204123",
      nroOp: "9934601402",
      fecha: "2026-07-02",
      activada: "2026-07-02",
    },
    {
      nombreApellido: "SOLO PRESENTACION",
      modulo: "140010",
      afiliadoOriginal: "199999999999 - 00",
      afiliadoKey: normalizarAfiliado("199999999999 - 00")!,
      nroOme: "1",
      nroOp: "1",
      fecha: "2026-07-01",
      activada: "2026-07-01",
    },
  ];

  const debitos: DebitoRow[] = [
    {
      orden: "SOLAPAMIENTOS CON INTERNACIONES",
      fecha: "2026-07-02",
      afiliadoOriginal: "150465097406\u00A0-\u00A000",
      afiliadoKey: normalizarAfiliado("150465097406\u00A0-\u00A000")!,
      prestacion: "125",
      tipo: "SESION REHABILITACION NEUROCOGNITIVA",
    },
    {
      orden: "SOLAPAMIENTOS CON INTERNACIONES",
      fecha: "2026-07-07",
      afiliadoOriginal: "150465097406\u00A0-\u00A000",
      afiliadoKey: normalizarAfiliado("150465097406\u00A0-\u00A000")!,
      prestacion: "125",
      tipo: "SESION REHABILITACION NEUROCOGNITIVA",
    },
    {
      orden: "FUERA DE RANGO - ANUAL PRESTACIONAL",
      fecha: "2026-07-03",
      afiliadoOriginal: "145201263009\u00A0-\u00A000",
      afiliadoKey: normalizarAfiliado("145201263009\u00A0-\u00A000")!,
      prestacion: "140",
      tipo: "MODULO MENSUAL DE REHABILITACION JORNADA SIMPLE",
    },
    {
      orden: "FUERA DE RANGO - ANUAL CALENDARIO",
      fecha: "2026-07-10",
      afiliadoOriginal: "188888888888\u00A0-\u00A000",
      afiliadoKey: normalizarAfiliado("188888888888\u00A0-\u00A000")!,
      prestacion: "125",
      tipo: "X",
    },
    // duplicado mismo afiliado+fecha+codigo, motivos distintos
    {
      orden: "NO COINCIDE EL AFILIADO AUTORIZADO EN LA ORDEN DE PRESTACION",
      fecha: "2026-07-31",
      afiliadoOriginal: "140078602307 - 01",
      afiliadoKey: normalizarAfiliado("140078602307 - 01")!,
      prestacion: "125",
      tipo: "X",
    },
    {
      orden: "ORDEN DE PRESTACION NO ACTIVADA POR PRESTADOR",
      fecha: "2026-07-31",
      afiliadoOriginal: "140078602307 - 01",
      afiliadoKey: normalizarAfiliado("140078602307 - 01")!,
      prestacion: "125",
      tipo: "X",
    },
  ];

  it("comparar sin normalizar da 0 coincidencias", () => {
    expect(
      coincidenciasSinNormalizar(
        presentacion.map((p) => p.afiliadoOriginal),
        debitos.map((d) => d.afiliadoOriginal),
      ),
    ).toBe(0);
  });

  it("arma el contrato con resumen, coincidencias, concentración y alertas", () => {
    const result = cruzarPami(
      presentacion,
      debitos,
      { fileName: "Julio2026.xlsx", filasDatos: 3, filasDescartadas: 8 },
      { fileName: "Libro1.xlsx", filasDatos: 6, filasDescartadas: 0 },
    );

    expect(result.carga.archivoA).toEqual({
      nombre: "Julio2026.xlsx",
      filasValidas: 3,
      filasDescartadas: 8,
    });
    expect(result.resumen.afiliadosCoincidentes).toBe(2);
    expect(result.resumen.soloEnPresentacion).toBe(1);
    expect(result.resumen.soloEnDebitos).toBe(2);
    expect(result.resumen.prestacionesPorCodigo["125"]).toBe(5);
    expect(result.resumen.prestacionesPorCodigo["140"]).toBe(1);

    const cozzo = result.coincidencias.find((c) => c.nombre.includes("COZZO"));
    expect(cozzo?.afiliadoOriginal).toBe("150465097406 - 00");
    expect(cozzo?.presentacion[0]?.modulo).toBe(125001);
    expect(cozzo?.presentacion[0]?.numeroOp).toBe("9934584773");
    expect(cozzo?.cantidadObservadas).toBe(2);
    expect(cozzo?.codigosObservados).toEqual([125]);
    expect(cozzo?.codigoDistintoAlModulo).toBe(false);
    expect(cozzo?.detalle[0]?.motivo).toMatch(/SOLAPAMIENTOS/);

    const pacheco = result.coincidencias.find((c) => c.nombre.includes("PACHECO"));
    expect(pacheco?.codigosObservados).toEqual([140]);
    expect(pacheco?.codigoDistintoAlModulo).toBe(false);

    expect(result.resumen.concentracion125.totalPrestaciones).toBe(5);
    expect(result.concentracion125.some((r) => r.estaEnPresentacion)).toBe(true);

    expect(result.duplicadosDebitos).toHaveLength(1);
    expect(result.duplicadosDebitos[0]?.afiliadoOriginal).toContain("140078602307");
    expect(result.duplicadosDebitos[0]?.motivos).toHaveLength(2);
    expect(result.alertas.some((a) => a.tipo === "duplicado_motivos_distintos")).toBe(true);
    expect(result.alertas.some((a) => a.mensaje.includes("NO COINCIDE"))).toBe(true);
    expect(result.alertas.some((a) => a.mensaje.includes("NO ACTIVADA"))).toBe(true);
  });

  it("marca codigoDistintoAlModulo cuando no matchea el mapeo", () => {
    const result = cruzarPami(
      [presentacion[0]!],
      [
        {
          ...debitos[2]!,
          afiliadoKey: presentacion[0]!.afiliadoKey,
          afiliadoOriginal: presentacion[0]!.afiliadoOriginal,
          prestacion: "140",
        },
      ],
      { fileName: "a.xlsx", filasDatos: 1, filasDescartadas: 0 },
      { fileName: "b.xlsx", filasDatos: 1, filasDescartadas: 0 },
    );
    expect(result.coincidencias[0]?.codigoDistintoAlModulo).toBe(true);
  });

  it("mantiene ambas presentaciones si un afiliado tiene dos módulos", () => {
    const doble: PresentacionRow[] = [
      presentacion[0]!,
      {
        ...presentacion[0]!,
        modulo: "140010",
        nroOp: "999",
      },
    ];
    const result = cruzarPami(
      doble,
      debitos.filter((d) => d.afiliadoKey === presentacion[0]!.afiliadoKey),
      { fileName: "a.xlsx", filasDatos: 2, filasDescartadas: 0 },
      { fileName: "b.xlsx", filasDatos: 2, filasDescartadas: 0 },
    );
    const cozzo = result.coincidencias.find((c) => c.nombre.includes("COZZO"));
    expect(cozzo?.presentacion).toHaveLength(2);
    expect(result.alertas.some((a) => a.tipo === "afiliado_multi_modulo")).toBe(true);
  });
});
