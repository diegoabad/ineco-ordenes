import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBotTurn, type BotTurnIO } from "../src/whatsapp/bot-turn.js";
import {
  datosVaciosParaContacto,
  type DatosVaciosContacto,
} from "../src/whatsapp/firestore-store.js";
import { listWhatsappTagCatalog } from "../src/whatsapp/tags.js";
import type { WaContact, WaConversation, WaMessage } from "../src/whatsapp/types.js";

type Caso = {
  id: string;
  categoria: string;
  titulo: string;
  contexto?: {
    fechaHora?: string;
    datosConocidos?: Record<string, string>;
    primerContacto?: boolean;
  };
  turnos: { lote: string[]; devolverAlBot?: boolean }[];
};

type Bateria = { casos: Caso[] };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bateriaPath = path.join(root, "tests", "bateria", "bateria_ineco.json");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parseFecha(texto: string): Date {
  const match = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return new Date();
  const [, dia, mes, anio, hora, minuto] = match;
  return new Date(
    `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}T${hora.padStart(2, "0")}:${minuto}:00-03:00`,
  );
}

function contactoInicial(datos: Record<string, string>): WaContact {
  const ahora = new Date().toISOString();
  const nombre = (datos.nombre ?? "").trim();
  const partes = nombre.split(/\s+/).filter(Boolean);
  const firstName = partes[0] ?? null;
  const lastName = partes.slice(1).join(" ") || null;
  return {
    id: "contacto-prueba",
    phoneNumber: datos.telefono ?? "5491100000000",
    firstName,
    lastName,
    displayName: nombre || null,
    whatsappName: null,
    cobertura: datos.cobertura ?? null,
    email: datos.email ?? null,
    grupoEtario: datos.grupoEtario === "infanto" || datos.grupoEtario === "adulto" ? datos.grupoEtario : null,
    consultaPara: datos.consultaPara === "propio" || datos.consultaPara === "tercero" ? datos.consultaPara : null,
    contactoNombre: null,
    contactoApellido: null,
    relacionFamiliar: null,
    dni: datos.dni ?? null,
    sexo: datos.sexo === "masculino" || datos.sexo === "femenino" ? datos.sexo : null,
    esPaciente: null,
    isBlocked: false,
    lastInteractionAt: ahora,
    createdAt: ahora,
    updatedAt: ahora,
  };
}

function sesion(caso: Caso, nombresEtiqueta: Map<string, string>) {
  const ahora = new Date().toISOString();
  const datos = caso.contexto?.datosConocidos ?? {};
  const contact = contactoInicial(datos);
  const motivo = datos.motivo?.trim();
  let conversation: WaConversation = {
    id: `prueba-${caso.id}`,
    contactId: contact.id,
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    assigneeKind: "none",
    assigneeUserId: null,
    assigneeName: null,
    tagIds: [],
    resumen: motivo ? `Motivo ya conocido: ${motivo}` : null,
    intencionAbierta: null,
    intencionConcluida: false,
    intencionPropuesta: null,
    prueba: false,
    pruebaResultado: null,
    pruebaNota: null,
    pruebaNotaEn: null,
    auditoria: [],
    createdAt: ahora,
    updatedAt: ahora,
    contact,
  };
  const messages: WaMessage[] = [];
  const enviados: string[] = [];
  let n = 0;

  const io: BotTurnIO = {
    now: () => parseFecha(caso.contexto?.fechaHora ?? "viernes 16/10/2026 10:30"),
    skipUsage: true,
    getConversation: async () => conversation,
    listMessages: async () => messages,
    fillEmptyContactFields: async (_id, input) => {
      if (!conversation.contact) return null;
      const patch = datosVaciosParaContacto(conversation.contact, input as DatosVaciosContacto);
      conversation = {
        ...conversation,
        contact: { ...conversation.contact, ...patch } as WaContact,
      };
      return conversation.contact;
    },
    replaceContactFields: async (_id, input) => {
      if (!conversation.contact) return null;
      const nombre = input.pacienteNombre.trim();
      const apellido = input.pacienteApellido.trim();
      conversation = {
        ...conversation,
        contact: {
          ...conversation.contact,
          firstName: nombre || null,
          lastName: apellido || null,
          displayName: [nombre, apellido].filter(Boolean).join(" ") || null,
          consultaPara: input.consultaPara === "propio" || input.consultaPara === "tercero" ? input.consultaPara : null,
          relacionFamiliar: input.relacionFamiliar.trim() || null,
          contactoNombre: input.contactoNombre.trim() || null,
          contactoApellido: input.contactoApellido.trim() || null,
          grupoEtario: input.grupoEtario === "infanto" || input.grupoEtario === "adulto" ? input.grupoEtario : null,
          dni: input.dni.trim() || null,
          sexo: input.sexo === "masculino" || input.sexo === "femenino" ? input.sexo : null,
        },
      };
      return conversation.contact;
    },
    setConversationResumen: async (_id, resumen) => {
      const text = resumen.trim().replace(/\s+/g, " ").slice(0, 240);
      if (!text) return conversation.resumen;
      conversation = { ...conversation, resumen: text };
      return text;
    },
    setConversationTags: async (_id, tagIds) => {
      conversation = { ...conversation, tagIds };
      return conversation;
    },
    setConversationAssignee: async (_id, input) => {
      conversation = {
        ...conversation,
        assigneeKind: input.kind,
        assigneeUserId: input.kind === "user" ? input.userId ?? null : null,
        assigneeName: input.kind === "none" ? null : input.name ?? null,
      };
      return conversation;
    },
    setConversationIntencion: async (_id, input) => {
      conversation = { ...conversation, ...input };
    },
    appendAuditoria: async (_id, paso) => {
      conversation = { ...conversation, auditoria: [...conversation.auditoria, paso].slice(-40) };
    },
    deliver: async (_id, text) => {
      enviados.push(text);
      n += 1;
      messages.push({
        id: `out-${n}`,
        conversationId: conversation.id,
        contactId: contact.id,
        direction: "OUTBOUND",
        type: "TEXT",
        text,
        externalMessageId: null,
        status: "SENT",
        mimeType: null,
        fileName: null,
        mediaPath: null,
        mediaUrl: null,
        isDeleted: false,
        createdAt: new Date(Date.now() + n).toISOString(),
      });
    },
  };

  return {
    io,
    enviados,
    devolverAlBot() {
      if (conversation.assigneeKind !== "user") return;
      conversation = { ...conversation, assigneeKind: "bot", assigneeUserId: null, assigneeName: "Nina" };
    },
    agregarLote(lote: string[]) {
      enviados.length = 0;
      for (const text of lote) {
        n += 1;
        messages.push({
          id: `in-${n}`,
          conversationId: conversation.id,
          contactId: contact.id,
          direction: "INBOUND",
          type: "TEXT",
          text,
          externalMessageId: null,
          status: "RECEIVED",
          mimeType: null,
          fileName: null,
          mediaPath: null,
          mediaUrl: null,
          isDeleted: false,
          createdAt: new Date(Date.now() + n).toISOString(),
        });
      }
    },
    estado: () => ({
      asignado: conversation.assigneeKind,
      asignadoA: conversation.assigneeName,
      derivacion: conversation.derivacionPendiente === true,
      intencion: conversation.intencionAbierta,
      concluida: conversation.intencionConcluida,
      etiquetas: conversation.tagIds.map((id) => nombresEtiqueta.get(id) ?? id),
      datoPedido: conversation.datoPedido ?? "",
      casos: (conversation.casos ?? []).map((caso) => `${caso.etiqueta}:${caso.estado}`).join(" | "),
      historial: (conversation.historialDatos ?? [])
        .map((evento) => `${evento.campo} ${evento.anterior || "-"}→${evento.nuevo}`)
        .join(" | "),
      pila: (conversation.pilaTemas ?? [])
        .map((tema) => {
          const etiqueta = conversation.casos?.find((caso) => caso.id === tema.casoId)?.etiqueta ?? tema.casoId;
          return `${tema.clave}:${etiqueta}:${tema.datoPedido || "-"}`;
        })
        .join(" | "),
      resultado: conversation.ultimoResultado
        ? `${conversation.ultimoResultado.accion} ${conversation.ultimoResultado.ok ? "ok" : "fallo"}`
        : "",
      pausa: conversation.pausa
        ? `${conversation.pausa.intencion || "-"} dato ${conversation.pausa.datoPedido || "-"}`
        : "",
      ficha: [
        conversation.contact?.firstName,
        conversation.contact?.lastName,
        conversation.contact?.grupoEtario,
        conversation.contact?.dni,
        conversation.contact?.sexo,
        conversation.contact?.email,
        conversation.contact?.consultaPara,
      ]
        .filter(Boolean)
        .join(" "),
    }),
  };
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(bateriaPath, "utf8")) as Bateria;
  const filtroCaso = new Set(
    (arg("--case") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const categoria = (arg("--category") ?? "").trim().toLowerCase();
  const casos = raw.casos.filter((caso) => {
    if (filtroCaso.size && !filtroCaso.has(caso.id)) return false;
    if (categoria && !caso.categoria.toLowerCase().includes(categoria) && !caso.id.toLowerCase().startsWith(categoria)) {
      return false;
    }
    return true;
  });
  if (!casos.length) throw new Error("Ningún caso coincide con el filtro");
  const catalogo = await listWhatsappTagCatalog();
  const nombresEtiqueta = new Map(catalogo.items.map((item) => [item.id, item.name]));

  const lineas: string[] = ["# Respuestas del bot", ""];
  for (const caso of casos) {
    const memoria = sesion(caso, nombresEtiqueta);
    lineas.push(`## ${caso.id} — ${caso.titulo}`, "");
    for (let i = 0; i < caso.turnos.length; i += 1) {
      const turno = caso.turnos[i]!;
      const trace: { terra?: unknown; lunaLlamada: boolean } = { lunaLlamada: false };
      if (turno.devolverAlBot) memoria.devolverAlBot();
      memoria.agregarLote(turno.lote);
      let error = "";
      try {
        await runBotTurn(memoria.io.getConversation ? `prueba-${caso.id}` : caso.id, {
          ...memoria.io,
          trace,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const terra = trace.terra as {
        intencion?: string;
        intencionSecundaria?: string;
        hayPedido?: boolean;
        cortesia?: string;
        peligroActual?: boolean;
        dudaSinPeligro?: boolean;
        etiquetas?: string[];
      } | undefined;
      const estado = memoria.estado();
      lineas.push(`### Turno ${i + 1}`, "");
      if (turno.devolverAlBot) lineas.push("Operador: devuelve la charla al bot.", "");
      lineas.push("Persona:", ...turno.lote.map((texto) => `> ${texto}`), "");
      if (error) lineas.push(`Error: ${error}`, "");
      lineas.push(
        terra
          ? `Terra: ${terra.intencion ?? "?"} · secundaria ${terra.intencionSecundaria || "ninguna"} · pedido ${terra.hayPedido === false ? "no" : "sí"} · cortesía ${terra.cortesia || "ninguna"} · peligro ${terra.peligroActual ? "sí" : "no"} · duda ${terra.dudaSinPeligro ? "sí" : "no"} · etiquetas ${(terra.etiquetas ?? []).join(", ") || "ninguna"}`
          : "Terra: no se llamó",
        `Luna: ${trace.lunaLlamada ? "sí" : "no"}`,
        `Estado: asignado ${estado.asignado}${estado.asignadoA ? ` (${estado.asignadoA})` : ""} · derivación ${estado.derivacion ? "pendiente" : "no"} · etiquetas ${estado.etiquetas.length ? estado.etiquetas.join(", ") : "(ninguna)"} · dato ${estado.datoPedido || "-"} · casos ${estado.casos || "-"} · ficha ${estado.ficha || "(vacía)"}`,
        `Diálogo: historial ${estado.historial || "-"} · pila ${estado.pila || "-"} · resultado ${estado.resultado || "-"} · pausa ${estado.pausa || "-"}`,
        "",
        "Respuesta:",
        memoria.enviados.length ? memoria.enviados.join("\n\n") : "(ninguna)",
        "",
      );
    }
    lineas.push("---", "");
    process.stdout.write(`${caso.id} listo\n`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "tests", "bateria", "reportes", stamp);
  await mkdir(dir, { recursive: true });
  const reporte = path.join(dir, "reporte.md");
  await writeFile(reporte, lineas.join("\n"), "utf8");
  process.stdout.write(`\n${reporte}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
