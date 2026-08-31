import type { FileParseMeta, ResultadoPami } from "./types";

const LS_KEY = "ineco-pami-borrador-v1";

export type PamiStoredFile = {
  name: string;
  base64: string;
  meta: FileParseMeta;
};

export type PamiDraft = {
  mes: string;
  presentacion: PamiStoredFile | null;
  debitos: PamiStoredFile | null;
  result: ResultadoPami | null;
};

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function loadPamiDraft(): PamiDraft | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PamiDraft;
    if (!data || typeof data.mes !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export function savePamiDraft(draft: PamiDraft): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(draft));
  } catch (err) {
    console.warn("No se pudo guardar el borrador PAMI en localStorage", err);
  }
}

export function clearPamiDraft(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function fileSlotFromStored(stored: PamiStoredFile): {
  file: File;
  buffer: ArrayBuffer;
  meta: FileParseMeta;
} {
  const buffer = base64ToArrayBuffer(stored.base64);
  const file = new File([buffer], stored.name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return { file, buffer, meta: stored.meta };
}

export function storedFromSlot(slot: {
  file: File;
  buffer: ArrayBuffer;
  meta: FileParseMeta;
}): PamiStoredFile {
  return {
    name: slot.file.name,
    base64: arrayBufferToBase64(slot.buffer),
    meta: slot.meta,
  };
}
