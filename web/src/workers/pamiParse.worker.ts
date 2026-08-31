import { analizarPamiExcels, type PamiParseInput } from "../lib/pami/analyze";

export type PamiWorkerRequest = {
  id: string;
  presentacion: { buffer: ArrayBuffer; fileName: string };
  debitos: { buffer: ArrayBuffer; fileName: string };
};

export type PamiWorkerResponse =
  | { id: string; ok: true; result: ReturnType<typeof analizarPamiExcels> }
  | { id: string; ok: false; message: string };

self.onmessage = (ev: MessageEvent<PamiWorkerRequest>) => {
  const msg = ev.data;
  try {
    const input: PamiParseInput = {
      presentacion: msg.presentacion,
      debitos: msg.debitos,
    };
    const result = analizarPamiExcels(input);
    const res: PamiWorkerResponse = { id: msg.id, ok: true, result };
    self.postMessage(res);
  } catch (error) {
    const res: PamiWorkerResponse = {
      id: msg.id,
      ok: false,
      message: error instanceof Error ? error.message : "Error al procesar los Excel",
    };
    self.postMessage(res);
  }
};

export {};
