/**
 * Borra todas las conversaciones de prueba WhatsApp (Firestore + memoria del proceso).
 * Uso: npx tsx scripts/wipe-pruebas-whatsapp.ts
 */
import "dotenv/config";
import { deleteAllPruebaConversations } from "../src/whatsapp/firestore-store.js";

const result = await deleteAllPruebaConversations();
console.log("Pruebas borradas:", result);
process.exit(0);
