import type { Medico } from "../types";

const CHANNEL = "ineco-ordenes-firma";

type FirmaActualizadaMessage = {
  type: "firma-actualizada";
  medico: Medico;
};

export function notificarFirmaActualizada(medico: Medico): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: "firma-actualizada", medico } satisfies FirmaActualizadaMessage);
    channel.close();
  } catch {
    // BroadcastChannel no disponible en este navegador
  }
}

export function subscribeFirmaActualizada(onUpdate: (medico: Medico) => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<FirmaActualizadaMessage>) => {
      if (event.data?.type === "firma-actualizada" && event.data.medico?.id) {
        onUpdate(event.data.medico);
      }
    };
  } catch {
    // sin soporte
  }
  return () => channel?.close();
}
