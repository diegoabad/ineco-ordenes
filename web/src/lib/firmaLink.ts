import { toast } from "react-toastify";

export function buildFirmaLink(medicoId: string): string {
  const path = `/firmar/${encodeURIComponent(medicoId)}`;
  return `${window.location.origin}${path}`;
}

export async function copiarLinkFirma(medicoId: string): Promise<void> {
  const link = buildFirmaLink(medicoId);
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado. Enviáselo al profesional para que firme.");
  } catch {
    toast.info(link, { autoClose: 8000 });
    toast.warning("No se pudo copiar automáticamente. Copiá el link del mensaje anterior.");
  }
}
