export function buildFirmaLink(medicoId: string): string {
  const path = `/firmar/${encodeURIComponent(medicoId)}`;
  return `${window.location.origin}${path}`;
}
