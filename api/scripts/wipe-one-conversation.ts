import "dotenv/config";
import { collection, deleteDoc, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { firestore } from "../src/config/firebase.js";

const convId = process.argv[2] || "ce53781c-ddd1-47ac-a7a4-3808e30ec0fd";
const contactId = process.argv[3] || "2f6f5108-4940-4a7d-b1fd-692361996771";

const mq = query(collection(firestore, "whatsapp_messages"), where("conversationId", "==", convId));
const ms = await getDocs(mq);
let mensajes = 0;
for (let i = 0; i < ms.docs.length; i += 400) {
  const batch = writeBatch(firestore);
  for (const m of ms.docs.slice(i, i + 400)) {
    batch.delete(m.ref);
    mensajes += 1;
  }
  await batch.commit();
}
await deleteDoc(doc(firestore, "whatsapp_conversations", convId));
try {
  await deleteDoc(doc(firestore, "whatsapp_contacts", contactId));
} catch {
  /* contacto ya borrado */
}
console.log({ ok: true, mensajes, convId, contactId });
process.exit(0);
