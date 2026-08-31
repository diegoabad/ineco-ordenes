import { cruzarPami } from "./cruzar";
import { parseDebitosFromArrayBuffer } from "./parseDebitos";
import { parsePresentacionFromArrayBuffer } from "./parsePresentacion";
import type { ResultadoPami } from "./types";

export type PamiParseInput = {
  presentacion: { buffer: ArrayBuffer; fileName: string };
  debitos: { buffer: ArrayBuffer; fileName: string };
};

/**
 * Parsea ambos Excel y cruza. Valida columnas de cada archivo por separado;
 * la cantidad de filas/pacientes es dinámica.
 */
export function analizarPamiExcels(input: PamiParseInput): ResultadoPami {
  let presentacion;
  try {
    presentacion = parsePresentacionFromArrayBuffer(
      input.presentacion.buffer,
      input.presentacion.fileName,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ExcelFormatoError") throw error;
    throw new Error(
      `Excel INECO (${input.presentacion.fileName}): ${
        error instanceof Error ? error.message : "no se pudo leer"
      }`,
    );
  }

  let debitos;
  try {
    debitos = parseDebitosFromArrayBuffer(input.debitos.buffer, input.debitos.fileName);
  } catch (error) {
    if (error instanceof Error && error.name === "ExcelFormatoError") throw error;
    throw new Error(
      `Excel PAMI (${input.debitos.fileName}): ${
        error instanceof Error ? error.message : "no se pudo leer"
      }`,
    );
  }

  return cruzarPami(presentacion.rows, debitos.rows, presentacion.meta, debitos.meta);
}
