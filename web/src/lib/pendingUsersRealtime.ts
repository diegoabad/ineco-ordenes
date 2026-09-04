import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { ensureFirebase } from "./firebaseAuth";

const USUARIOS = "ordenes_usuarios";

/**
 * Escucha en tiempo real cuántos usuarios están en status=pending.
 * Devuelve una función para cancelar la suscripción.
 */
export async function subscribePendingUsersCount(
  onCount: (count: number) => void,
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const { firestore } = await ensureFirebase();
  const q = query(collection(firestore, USUARIOS), where("status", "==", "pending"));
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
