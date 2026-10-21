/**
 * Borra todas las conversaciones de prueba (prueba=true) y sus mensajes.
 * También limpia contactos ficticios de batería (teléfonos 54911…).
 *
 * Uso:
 *   npx tsx scripts/borrar-pruebas.ts
 *   npx tsx scripts/borrar-pruebas.ts --dry
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../src/config/firebase.js";

const CONTACTS = "whatsapp_contacts";
const CONVERSATIONS = "whatsapp_conversations";
const MESSAGES = "whatsapp_messages";

const dry = process.argv.includes("--dry");

async function borrarEnLotes(
  refs: ReturnType<typeof doc>[],
  etiqueta: string,
): Promise<number> {
  let borrados = 0;
  for (let i = 0; i < refs.length; i += 400) {
    const slice = refs.slice(i, i + 400);
    if (!dry) {
      const batch = writeBatch(firestore);
      for (const ref of slice) batch.delete(ref);
      await batch.commit();
    }
    borrados += slice.length;
    console.log(`  ${etiqueta}: ${borrados}/${refs.length}`);
  }
  return borrados;
}

async function main(): Promise<void> {
  console.log(dry ? "DRY RUN — no se borra nada" : "Borrando conversaciones de prueba…");

  const convSnap = await getDocs(
    query(collection(firestore, CONVERSATIONS), where("prueba", "==", true)),
  );
  const conversaciones = convSnap.docs;
  console.log(`Conversaciones prueba: ${conversaciones.length}`);

  const contactIds = new Set<string>();
  const convRefs = conversaciones.map((d) => {
    const data = d.data() as Record<string, unknown>;
    if (typeof data.contactId === "string" && data.contactId) contactIds.add(data.contactId);
    return d.ref;
  });

  const msgRefs: ReturnType<typeof doc>[] = [];
  for (const d of conversaciones) {
    const msgSnap = await getDocs(
      query(collection(firestore, MESSAGES), where("conversationId", "==", d.id)),
    );
    for (const m of msgSnap.docs) msgRefs.push(m.ref);
  }
  console.log(`Mensajes a borrar: ${msgRefs.length}`);

  const nMsg = await borrarEnLotes(msgRefs, "mensajes");
  const nConv = await borrarEnLotes(convRefs, "conversaciones");

  const aBorrarContactos: ReturnType<typeof doc>[] = [];
  for (const id of contactIds) {
    const snap = await getDoc(doc(firestore, CONTACTS, id));
    if (!snap.exists()) continue;
    const phone = String((snap.data() as Record<string, unknown>).phoneNumber ?? "");
    if (/^54911\d{8}$/.test(phone) || phone.startsWith("54911000")) {
      aBorrarContactos.push(snap.ref);
    }
  }
  console.log(`Contactos de prueba a borrar: ${aBorrarContactos.length}`);
  const nContact = await borrarEnLotes(aBorrarContactos, "contactos");

  console.log(
    `\nListo${dry ? " (dry)" : ""}: mensajes=${nMsg} conversaciones=${nConv} contactos=${nContact}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
