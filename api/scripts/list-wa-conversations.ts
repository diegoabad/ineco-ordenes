/**
 * Lista conversaciones WhatsApp (prueba y reales).
 * Uso: npx tsx scripts/list-wa-conversations.ts
 */
import "dotenv/config";
import { collection, getDocs } from "firebase/firestore";
import { firestore } from "../src/config/firebase.js";

const snap = await getDocs(collection(firestore, "whatsapp_conversations"));
const rows = snap.docs.map((d) => {
  const raw = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    prueba: raw.prueba === true,
    pruebaMotor: raw.pruebaMotor ?? "",
    status: raw.status ?? "",
    phone: "",
    contactId: String(raw.contactId ?? ""),
    assignee: `${raw.assigneeKind ?? ""}:${raw.assigneeName ?? ""}`,
    preview: String(raw.lastMessagePreview ?? "").slice(0, 80),
    lastMessageAt: raw.lastMessageAt ?? raw.updatedAt ?? "",
    createdAt: raw.createdAt ?? "",
  };
});

const contacts = await getDocs(collection(firestore, "whatsapp_contacts"));
const phoneById = new Map(
  contacts.docs.map((d) => [d.id, String((d.data() as { phoneNumber?: unknown }).phoneNumber ?? "")]),
);
for (const row of rows) {
  row.phone = phoneById.get(row.contactId) ?? "";
}

rows.sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
console.log(JSON.stringify(rows, null, 2));
console.log(`Total: ${rows.length}`);
process.exit(0);
