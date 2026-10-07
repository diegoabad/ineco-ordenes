import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { ensureFirebase } from "./firebaseAuth";

const PEDIDOS = "ordenes_pedidos_sistema";

/** Escucha cuántos pedidos están pendientes. */
export async function subscribePedidosPendientesCount(
  onCount: (count: number) => void,
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const { firestore } = await ensureFirebase();
  const q = query(collection(firestore, PEDIDOS), where("estado", "==", "pendiente"));
  return onSnapshot(
    q,
    (snap) => {
      onCount(snap.size);
    },
    (err) => {
      onError?.(err);
    },
  );
}
