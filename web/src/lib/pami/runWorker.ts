import type { PamiWorkerRequest, PamiWorkerResponse } from "../../workers/pamiParse.worker";
import { analizarPamiExcels } from "./analyze";
import type { ResultadoPami } from "./types";

export function analizarPamiEnWorker(
  presentacion: { buffer: ArrayBuffer; fileName: string },
  debitos: { buffer: ArrayBuffer; fileName: string },
): Promise<ResultadoPami> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../workers/pamiParse.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (err) {
      // Fallback: mismo hilo (p. ej. entornos sin workers)
      try {
        resolve(
          analizarPamiExcels({
            presentacion: {
              buffer: presentacion.buffer.slice(0),
              fileName: presentacion.fileName,
            },
            debitos: {
              buffer: debitos.buffer.slice(0),
              fileName: debitos.fileName,
            },
          }),
        );
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Error al procesar los Excel"));
      }
      return;
    }

    const id = crypto.randomUUID();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      fn();
    };

    worker.addEventListener("message", (ev: MessageEvent<PamiWorkerResponse>) => {
      if (ev.data?.id !== id) return;
      finish(() => {
        if (ev.data.ok) resolve(ev.data.result);
        else reject(new Error(ev.data.message));
      });
    });

    worker.addEventListener("error", (err) => {
      finish(() => {
        // Fallback en main thread si el worker no carga / crashea al iniciar
        try {
          resolve(
            analizarPamiExcels({
              presentacion: {
                buffer: presentacion.buffer.slice(0),
                fileName: presentacion.fileName,
              },
              debitos: {
                buffer: debitos.buffer.slice(0),
                fileName: debitos.fileName,
              },
            }),
          );
        } catch (e) {
          const detail =
            err.message ||
            (e instanceof Error ? e.message : null) ||
            "Falló el worker de PAMI";
          reject(new Error(detail));
        }
      });
    });

    worker.addEventListener("messageerror", () => {
      finish(() => reject(new Error("No se pudo transferir los Excel al worker")));
    });

    const req: PamiWorkerRequest = {
      id,
      presentacion: {
        buffer: presentacion.buffer.slice(0),
        fileName: presentacion.fileName,
      },
      debitos: {
        buffer: debitos.buffer.slice(0),
        fileName: debitos.fileName,
      },
    };
    worker.postMessage(req, [req.presentacion.buffer, req.debitos.buffer]);
  });
}
