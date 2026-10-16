const STORAGE_KEY = "wa_open_contact_id";
const EVENT_NAME = "wa-open-contact";

/** Pide abrir la conversación de un contacto al entrar a WhatsApp. */
export function requestOpenWaContact(contactId: string): void {
  const id = contactId.trim();
  if (!id) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { contactId: id } }));
}

export function consumePendingWaContact(): string | null {
  try {
    const id = sessionStorage.getItem(STORAGE_KEY)?.trim() || null;
    if (id) sessionStorage.removeItem(STORAGE_KEY);
    return id;
  } catch {
    return null;
  }
}

export function subscribeOpenWaContact(
  listener: (contactId: string) => void,
): () => void {
  const handler = (event: Event) => {
    const id = String((event as CustomEvent<{ contactId?: string }>).detail?.contactId ?? "").trim();
    if (id) listener(id);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
