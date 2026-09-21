type Listener = () => void;

const listeners = new Set<Listener>();

/** Avisa a paneles/watcher que la lista de Inicio cambió (recordatorios, etc.). */
export function notifyInicioItemsChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeInicioItemsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
