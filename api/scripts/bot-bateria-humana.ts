/**
 * Batería completa con conversaciones de prueba REALES (Firestore + OpenAI + Medexis),
 * mismo camino que el CRM de prueba (createMessage + runBotTurn).
 *
 * Uso:
 *   npx tsx scripts/bot-bateria-humana.ts
 *   npx tsx scripts/bot-bateria-humana.ts --parallel 8
 *   npx tsx scripts/bot-bateria-humana.ts --case "AD01,AD02"
 *   npx tsx scripts/bot-bateria-humana.ts --category "Turnos: profesional"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { cerrarPorInactividad, runBotTurn, setBotDeliver } from "../src/whatsapp/bot-turn.js";
import {
  createMessage,
  createPruebaConversation,
  fillEmptyContactFields,
  getConversation,
  listMessagesByConversation,
  setConversationAssignee,
} from "../src/whatsapp/firestore-store.js";
import { listWhatsappTagCatalog } from "../src/whatsapp/tags.js";

type Caso = {
  id: string;
  categoria: string;
  titulo: string;
  contexto?: {
    fechaHora?: string;
    datosConocidos?: Record<string, string>;
    primerContacto?: boolean;
  };
  turnos: { lote: string[]; devolverAlBot?: boolean; cerrarPorInactividad?: boolean }[];
};

type Bateria = { casos: Caso[] };

type TurnoReporte = {
  n: number;
  persona: string[];
  devolverAlBot?: boolean;
  cerrarPorInactividad?: boolean;
  bot: string[];
  error?: string;
  estado: string;
};

type CasoReporte = {
  id: string;
  titulo: string;
  categoria: string;
  conversationId: string;
  turnos: TurnoReporte[];
  errorFatal?: string;
  ms: number;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bateriaPath = path.join(root, "tests", "bateria", "bateria_ineco.json");

setBotDeliver(async (conversationId, text) => {
  const conversation = await getConversation(conversationId);
  if (!conversation?.contactId) throw new Error("Conversación no encontrada");
  await createMessage({
    conversationId,
    contactId: conversation.contactId,
    direction: "OUTBOUND",
    type: "TEXT",
    text,
    externalMessageId: `bat-hum-out-${randomUUID()}`,
    status: "SENT",
  });
});

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function aplicarDatosConocidos(contactId: string, datos: Record<string, string>): Promise<void> {
  if (!Object.keys(datos).length) return;
  const nombre = (datos.nombre ?? "").trim();
  const partes = nombre.split(/\s+/).filter(Boolean);
  await fillEmptyContactFields(contactId, {
    pacienteNombre: partes[0] ?? datos.pacienteNombre ?? "",
    pacienteApellido: partes.slice(1).join(" ") || datos.pacienteApellido || "",
    dni: datos.dni ?? "",
    sexo: datos.sexo === "masculino" || datos.sexo === "femenino" ? datos.sexo : "",
    grupoEtario: datos.grupoEtario === "infanto" || datos.grupoEtario === "adulto" ? datos.grupoEtario : "",
    email: datos.email ?? "",
    consultaPara: datos.consultaPara === "propio" || datos.consultaPara === "tercero" ? datos.consultaPara : "",
    relacionFamiliar: datos.relacionFamiliar ?? "",
    contactoNombre: datos.contactoNombre ?? "",
    contactoApellido: datos.contactoApellido ?? "",
    cobertura: datos.cobertura ?? "",
    esPaciente: datos.esPaciente === "si" || datos.esPaciente === "no" ? datos.esPaciente : "",
  });
}

async function estadoTexto(
  conversationId: string,
  nombresEtiqueta: Map<string, string>,
): Promise<string> {
  const c = await getConversation(conversationId);
  if (!c) return "(sin conversación)";
  const etiquetas = (c.tagIds ?? []).map((id) => nombresEtiqueta.get(id) ?? id);
  return [
    `asignado ${c.assigneeKind}${c.assigneeName ? ` (${c.assigneeName})` : ""}`,
    `derivación ${c.derivacionPendiente ? "pendiente" : "no"}`,
    `intención ${c.intencionAbierta || "-"} concluida ${c.intencionConcluida ? "sí" : "no"}`,
    `dato ${c.datoPedido || "-"}`,
    `etiquetas ${etiquetas.length ? etiquetas.join(", ") : "(ninguna)"}`,
    `resultado ${
      c.ultimoResultado
        ? `${c.ultimoResultado.accion} ${c.ultimoResultado.ok ? "ok" : "fallo"}`
        : "-"
    }`,
    `ficha ${
      [
        c.contact?.firstName,
        c.contact?.lastName,
        c.contact?.dni,
        c.contact?.sexo,
        c.contact?.grupoEtario,
        c.contact?.email,
      ]
        .filter(Boolean)
        .join(" ") || "(vacía)"
    }`,
  ].join(" · ");
}

async function correrCaso(caso: Caso, nombresEtiqueta: Map<string, string>): Promise<CasoReporte> {
  const t0 = Date.now();
  const reporte: CasoReporte = {
    id: caso.id,
    titulo: caso.titulo,
    categoria: caso.categoria,
    conversationId: "",
    turnos: [],
    ms: 0,
  };
  try {
    const conv = await createPruebaConversation(
      { id: "bateria-humana", nombre: `Batería ${caso.id}` },
      "ia",
    );
    reporte.conversationId = conv.id;
    await aplicarDatosConocidos(conv.contactId, caso.contexto?.datosConocidos ?? {});

    for (let i = 0; i < caso.turnos.length; i += 1) {
      const turno = caso.turnos[i]!;
      if (turno.devolverAlBot) {
        await setConversationAssignee(conv.id, { kind: "bot", name: "Bot" });
      }
      const antes = await listMessagesByConversation(conv.id, 300);
      const vistos = new Set(antes.map((m) => m.id));
      let error = "";
      try {
        if (turno.cerrarPorInactividad) {
          await cerrarPorInactividad(conv.id, { forzar: true });
        } else {
          for (const texto of turno.lote) {
            await createMessage({
              conversationId: conv.id,
              contactId: conv.contactId,
              direction: "INBOUND",
              type: "TEXT",
              text: texto,
              externalMessageId: `bat-hum-in-${randomUUID()}`,
              status: "RECEIVED",
            });
          }
          await runBotTurn(conv.id);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const despues = await listMessagesByConversation(conv.id, 300);
      const bot = despues
        .filter((m) => m.direction === "OUTBOUND" && !vistos.has(m.id))
        .map((m) => m.text.trim())
        .filter(Boolean);
      reporte.turnos.push({
        n: i + 1,
        persona: turno.lote.length ? turno.lote : turno.cerrarPorInactividad ? ["(sin respuesta · cierre por inactividad)"] : [],
        devolverAlBot: turno.devolverAlBot,
        cerrarPorInactividad: turno.cerrarPorInactividad,
        bot,
        error: error || undefined,
        estado: await estadoTexto(conv.id, nombresEtiqueta),
      });
    }
  } catch (err) {
    reporte.errorFatal = err instanceof Error ? err.message : String(err);
  }
  reporte.ms = Date.now() - t0;
  return reporte;
}

function renderMarkdown(reportes: CasoReporte[]): string {
  const lineas: string[] = [
    "# Batería humana (conversaciones reales de prueba)",
    "",
    `Casos: ${reportes.length}`,
    `Con respuesta: ${reportes.filter((r) => r.turnos.some((t) => t.bot.length)).length}`,
    `Con error: ${reportes.filter((r) => r.errorFatal || r.turnos.some((t) => t.error)).length}`,
    "",
  ];
  for (const caso of reportes) {
    lineas.push(`## ${caso.id} — ${caso.titulo}`, "");
    lineas.push(`Categoría: ${caso.categoria}`, "");
    lineas.push(`Conversación: ${caso.conversationId || "(no creada)"} · ${caso.ms} ms`, "");
    if (caso.errorFatal) lineas.push(`Error fatal: ${caso.errorFatal}`, "");
    for (const turno of caso.turnos) {
      lineas.push(`### Turno ${turno.n}`, "");
      if (turno.devolverAlBot) lineas.push("Operador: devuelve la charla al bot.", "");
      if (turno.cerrarPorInactividad) lineas.push("Sistema: cierre por inactividad.", "");
      lineas.push("Persona:", ...turno.persona.map((t) => `> ${t}`), "");
      if (turno.error) lineas.push(`Error: ${turno.error}`, "");
      lineas.push(`Estado: ${turno.estado}`, "");
      lineas.push("Respuesta:", turno.bot.length ? turno.bot.join("\n\n") : "(ninguna)", "");
    }
    lineas.push("---", "");
  }
  return lineas.join("\n");
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
  const parallel = Math.max(1, Math.min(12, Number(arg("--parallel") ?? 6) || 6));
  const casos = raw.casos.filter((caso) => {
    if (filtroCaso.size && !filtroCaso.has(caso.id)) return false;
    if (
      categoria &&
      !caso.categoria.toLowerCase().includes(categoria) &&
      !caso.id.toLowerCase().startsWith(categoria)
    ) {
      return false;
    }
    return true;
  });
  if (!casos.length) throw new Error("Ningún caso coincide con el filtro");

  const catalogo = await listWhatsappTagCatalog();
  const nombresEtiqueta = new Map(catalogo.items.map((item) => [item.id, item.name]));

  console.log(`Batería humana: ${casos.length} casos · paralelo ${parallel}`);
  const t0 = Date.now();
  let listos = 0;
  const reportes = await mapPool(casos, parallel, async (caso) => {
    const r = await correrCaso(caso, nombresEtiqueta);
    listos += 1;
    const marca = r.errorFatal || r.turnos.some((t) => t.error) ? "ERR" : "ok ";
    process.stdout.write(
      `${marca} ${caso.id} (${listos}/${casos.length}) ${Math.round(r.ms / 1000)}s\n`,
    );
    return r;
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "tests", "bateria", "reportes", stamp);
  await mkdir(dir, { recursive: true });
  const reporte = path.join(dir, "reporte-humana.md");
  await writeFile(reporte, renderMarkdown(reportes), "utf8");
  const errores = reportes.filter((r) => r.errorFatal || r.turnos.some((t) => t.error));
  console.log(`\nListo en ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`Errores de ejecución: ${errores.length}`);
  for (const e of errores.slice(0, 20)) {
    console.log(`- ${e.id}: ${e.errorFatal || e.turnos.find((t) => t.error)?.error}`);
  }
  console.log(`\n${reporte}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
