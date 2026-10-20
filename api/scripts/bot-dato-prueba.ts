import { avisoDato, datoTieneForma, runBotTurn, type BotTurnIO } from "../src/whatsapp/bot-turn.js";
import type { WaConversation, WaMessage } from "../src/whatsapp/types.js";

const fallos: string[] = [];

function esperar(nombre: string, ok: boolean, detalle: string): void {
  if (ok) {
    process.stdout.write(`ok  ${nombre}\n`);
    return;
  }
  fallos.push(`${nombre}: ${detalle}`);
  process.stdout.write(`MAL ${nombre}: ${detalle}\n`);
}

esperar("dni letras", !datoTieneForma("dni", "juan perez"), "");
esperar("dni muy corto", !datoTieneForma("dni", "1234"), "");
esperar("dni corto", datoTieneForma("dni", "123456"), "");
esperar("dni con puntos", datoTieneForma("dni", "20.111.222"), "");
esperar("dni sin puntos", datoTieneForma("dni", "20111222"), "");
esperar("dni extranjero", datoTieneForma("dni", "AB123456"), "");
esperar("mail sin arroba", !datoTieneForma("email", "ana mail.com"), "");
esperar("mail sin dominio", !datoTieneForma("email", "ana@mail"), "");
esperar("mail valido", datoTieneForma("email", "Ana@Mail.com"), "");
esperar("nombre con numeros", !datoTieneForma("pacienteNombre", "12345678"), "");
esperar("sexo cualquiera", !datoTieneForma("sexo", "asdf"), "");
esperar("sexo valido", datoTieneForma("sexo", "femenino"), "");
esperar("edad letras", !datoTieneForma("grupoEtario", "qwerty"), "");
esperar("edad numero", datoTieneForma("grupoEtario", "41"), "");

function conversacion(dato: string): { conversation: WaConversation; messages: WaMessage[]; enviados: string[] } {
  const ahora = new Date().toISOString();
  const conversation: WaConversation = {
    id: `dato-${dato}`,
    contactId: "contacto",
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    assigneeKind: "bot",
    assigneeUserId: null,
    assigneeName: "Nina",
    tagIds: [],
    resumen: null,
    intencionAbierta: "TURNOS",
    intencionConcluida: false,
    intencionPropuesta: null,
    prueba: true,
    pruebaResultado: null,
    pruebaNota: null,
    pruebaNotaEn: null,
    pruebaAclaraciones: [],
    auditoria: [],
    datoPedido: dato,
    createdAt: ahora,
    updatedAt: ahora,
    contact: {
      id: "contacto",
      phoneNumber: "5491100000000",
      firstName: "Ana",
      lastName: "López",
      displayName: "Ana López",
      whatsappName: null,
      cobertura: null,
      email: null,
      grupoEtario: null,
      consultaPara: "propio",
      contactoNombre: null,
      contactoApellido: null,
      relacionFamiliar: null,
      dni: null,
      sexo: null,
      esPaciente: false,
      isBlocked: false,
      lastInteractionAt: ahora,
      createdAt: ahora,
      updatedAt: ahora,
    },
  };
  const messages: WaMessage[] = [
    {
      id: "out-1",
      conversationId: conversation.id,
      contactId: conversation.contactId,
      direction: "OUTBOUND",
      type: "TEXT",
      text: dato === "email" ? "¿Cuál es el email?" : "¿Me pasás el DNI del paciente?",
      externalMessageId: null,
      status: "SENT",
      mimeType: null,
      fileName: null,
      mediaPath: null,
      mediaUrl: null,
      isDeleted: false,
      createdAt: new Date(Date.now() - 1000).toISOString(),
    },
  ];
  return { conversation, messages, enviados: [] };
}

async function turno(dato: string, texto: string): Promise<{ respuesta: string; dni: string; email: string; pedido: string }> {
  const memoria = conversacion(dato);
  memoria.messages.push({
    id: "in-1",
    conversationId: memoria.conversation.id,
    contactId: memoria.conversation.contactId,
    direction: "INBOUND",
    type: "TEXT",
    text: texto,
    externalMessageId: null,
    status: "RECEIVED",
    mimeType: null,
    fileName: null,
    mediaPath: null,
    mediaUrl: null,
    isDeleted: false,
    createdAt: new Date().toISOString(),
  });
  const io: BotTurnIO = {
    skipUsage: true,
    now: () => new Date("2026-10-16T10:30:00-03:00"),
    getConversation: async () => memoria.conversation,
    listMessages: async () => memoria.messages,
    fillEmptyContactFields: async (_id, input) => {
      const contact = memoria.conversation.contact;
      if (!contact) return null;
      if (input.dni?.replace(/\D/g, "").length >= 7) contact.dni = input.dni.replace(/\D/g, "");
      if (input.email && /@/.test(input.email)) contact.email = input.email;
      if (input.pacienteNombre) contact.firstName = input.pacienteNombre;
      if (input.pacienteApellido) contact.lastName = input.pacienteApellido;
      return contact;
    },
    setConversationResumen: async (_id, resumen) => {
      memoria.conversation.resumen = resumen;
      return resumen;
    },
    setConversationTags: async () => memoria.conversation,
    setConversationAssignee: async () => memoria.conversation,
    setConversationIntencion: async (_id, input) => {
      memoria.conversation = { ...memoria.conversation, ...input };
    },
    appendAuditoria: async () => undefined,
    deliver: async (_id, text) => {
      memoria.enviados.push(text);
    },
  };
  await runBotTurn(memoria.conversation.id, io);
  return {
    respuesta: memoria.enviados.join("\n"),
    dni: memoria.conversation.contact?.dni ?? "",
    email: memoria.conversation.contact?.email ?? "",
    pedido: memoria.conversation.datoPedido ?? "",
  };
}

async function main(): Promise<void> {
  const dni = await turno("dni", "juan perez");
  esperar("rechaza nombre como dni", /no parece un documento/i.test(dni.respuesta), dni.respuesta);
  esperar("no guarda el dni", dni.dni === "", dni.dni);
  esperar("sigue pidiendo dni", dni.pedido === "dni", dni.pedido);

  const mail = await turno("email", "asdf qwerty");
  esperar("rechaza mail sin formato", /email no es válido/i.test(mail.respuesta), mail.respuesta);
  esperar("no guarda el mail", mail.email === "", mail.email || "(vacío)");
  esperar("sigue pidiendo mail", mail.pedido === "email", mail.pedido);

  const aviso = avisoDato("dni");
  esperar("aviso de dni", aviso.includes("otro país"), aviso);

  if (fallos.length) {
    process.stderr.write(`\n${fallos.length} fallos\n`);
    process.exit(1);
  }
  process.stdout.write("\nDatos con forma: todo ok\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
