/**
 * Batería E2E del bot de opciones (sin IA): conversaciones reales en Firestore
 * + Medexis, una a la vez. Mismo camino que Prueba bot en el CRM.
 *
 * Uso:
 *   npx tsx scripts/bot-bateria-menu-humana.ts --case F01
 *   npx tsx scripts/bot-bateria-menu-humana.ts --case "F01,D01,P14"
 *   npx tsx scripts/bot-bateria-menu-humana.ts --list
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { abrirBotMenu, runMenuTurn } from "../src/whatsapp/bot-menu.js";
import {
  createMessage,
  createPruebaConversation,
  getConversation,
  listMessagesByConversation,
} from "../src/whatsapp/firestore-store.js";
import { listWhatsappTagCatalog } from "../src/whatsapp/tags.js";

type Paso = { user: string } | { auto: "completarFicha" };

type Caso = {
  id: string;
  categoria: string;
  titulo: string;
  pasos: Paso[];
};

/** Completa sexo/email si el bot los pide (Medexis a veces no los trae). */
async function completarFichaSiPide(
  conversationId: string,
  contactId: string,
  ultima: string[],
): Promise<{ enviados: string[]; bot: string[] }> {
  const enviados: string[] = [];
  let bot = ultima;
  for (let i = 0; i < 4; i += 1) {
    const t = bot.join("\n");
    if (/sexo es 1 femenino|1\. Femenino/i.test(t)) {
      // Respuesta humana según el nombre ya dicho (Ana → mujer).
      enviados.push("mujer");
      bot = await decir(conversationId, contactId, "mujer");
      continue;
    }
    if (/cuál es el email|el email\?/i.test(t)) {
      enviados.push("ana.prueba.nina@example.com");
      bot = await decir(conversationId, contactId, "ana.prueba.nina@example.com");
      continue;
    }
    if (/cuál es el nombre/i.test(t)) {
      enviados.push("Ana");
      bot = await decir(conversationId, contactId, "Ana");
      continue;
    }
    if (/cuál es el apellido/i.test(t)) {
      enviados.push("Pérez");
      bot = await decir(conversationId, contactId, "Pérez");
      continue;
    }
    break;
  }
  return { enviados, bot };
}

type TurnoReporte = {
  n: number;
  persona: string;
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

/** Flujos en opciones numéricas (réplicas útiles de la batería IA). */
const casos: Caso[] = [
  {
    id: "F01",
    categoria: "Inicio",
    titulo: "Saludo y lista de sedes (apertura automática)",
    pasos: [],
  },
  {
    id: "D01",
    categoria: "Información",
    titulo: "CABA → Info → Sedes → CABA (dirección)",
    pasos: [{ user: "1" }, { user: "2" }, { user: "1" }, { user: "1" }],
  },
  {
    id: "P14",
    categoria: "Sede no CABA",
    titulo: "Ramos Mejía desde la lista de sedes",
    pasos: [{ user: "2" }],
  },
  {
    id: "P19",
    categoria: "Coberturas",
    titulo: "CABA → Info → Coberturas → OSDE",
    pasos: [{ user: "1" }, { user: "2" }, { user: "2" }, { user: "1" }],
  },
  {
    id: "P12",
    categoria: "Quejas",
    titulo: "CABA → Quejas → texto libre",
    pasos: [
      { user: "1" },
      { user: "4" },
      { user: "Me atendieron mal en recepción" },
    ],
  },
  {
    id: "R01",
    categoria: "Turnos",
    titulo: "CABA → Turnos → Sacar → pide DNI",
    pasos: [{ user: "1" }, { user: "1" }, { user: "1" }],
  },
  {
    id: "R06",
    categoria: "Turnos",
    titulo: "No paciente: DNI + nombre + apellido + sexo + email",
    pasos: [
      { user: "1" },
      { user: "1" },
      { user: "1" },
      { user: "33333333" },
      { user: "Martín" },
      { user: "Pereyra" },
      { user: "2" },
      { user: "martin.menu.prueba@example.com" },
    ],
  },
  {
    id: "AB02",
    categoria: "Turnos",
    titulo: "Paciente real: profesional inventado",
    pasos: [
      { user: "1" },
      { user: "1" },
      { user: "1" },
      { user: "45999881" },
      { auto: "completarFicha" },
      { user: "Fulano Inventado XYZ" },
    ],
  },
  {
    id: "AC04",
    categoria: "Turnos",
    titulo: "Cetkovich: confirmar Marcelo y ver tratamientos",
    pasos: [
      { user: "1" },
      { user: "1" },
      { user: "1" },
      { user: "45999881" },
      { auto: "completarFicha" },
      { user: "Marcelo" },
      { user: "sí" },
    ],
  },
  {
    id: "W04",
    categoria: "Turnos",
    titulo: "Reserva: profesional → tratamiento → horario (Medexis real)",
    pasos: [
      { user: "1" },
      { user: "1" },
      { user: "1" },
      { user: "45999881" },
      { auto: "completarFicha" },
      { user: "Cetkovich" },
      { user: "1" },
      { user: "1" },
    ],
  },
  {
    id: "W06",
    categoria: "Turnos",
    titulo: "Ver turnos del paciente (DNI 45999881)",
    pasos: [{ user: "1" }, { user: "1" }, { user: "2" }, { user: "45999881" }],
  },
  {
    id: "E08",
    categoria: "Tratamientos",
    titulo: "CABA → Tratamientos → primera opción",
    pasos: [{ user: "1" }, { user: "3" }, { user: "1" }],
  },
  {
    id: "nav",
    categoria: "Navegación",
    titulo: "Opción inválida, volver y cancelar",
    pasos: [
      { user: "44" },
      { user: "1" },
      { user: "1" },
      { user: "1" },
      { user: "33333333" },
      { user: "0" },
      { user: "00" },
    ],
  },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function estadoTexto(
  conversationId: string,
  nombresEtiqueta: Map<string, string>,
): Promise<string> {
  const c = await getConversation(conversationId);
  if (!c) return "(sin conversación)";
  const etiquetas = (c.tagIds ?? []).map((id) => nombresEtiqueta.get(id) ?? id);
  const menu = c.menuEstado;
  return [
    `asignado ${c.assigneeKind}${c.assigneeName ? ` (${c.assigneeName})` : ""}`,
    `paso ${c.menuPaso || menu?.paso || "-"}`,
    `modo ${menu?.modo || "-"}`,
    `dni ${menu?.dni || "-"}`,
    `etiquetas ${etiquetas.length ? etiquetas.join(", ") : "(ninguna)"}`,
    `ficha ${
      [c.contact?.firstName, c.contact?.lastName, c.contact?.dni, c.contact?.email]
        .filter(Boolean)
        .join(" ") || "(vacía)"
    }`,
  ].join(" · ");
}

async function decir(conversationId: string, contactId: string, texto: string): Promise<string[]> {
  const antes = await listMessagesByConversation(conversationId, 300);
  const vistos = new Set(antes.map((m) => m.id));
  await createMessage({
    conversationId,
    contactId,
    direction: "INBOUND",
    type: "TEXT",
    text: texto,
    externalMessageId: `bat-menu-in-${randomUUID()}`,
    status: "RECEIVED",
  });
  await runMenuTurn(conversationId);
  const despues = await listMessagesByConversation(conversationId, 300);
  return despues
    .filter((m) => m.direction === "OUTBOUND" && !vistos.has(m.id))
    .map((m) => m.text.trim())
    .filter(Boolean);
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
      { id: "bateria-menu", nombre: `Menú ${caso.id}` },
      "menu",
    );
    reporte.conversationId = conv.id;

    const antesApertura = await listMessagesByConversation(conv.id, 50);
    const vistosApertura = new Set(antesApertura.map((m) => m.id));
    await abrirBotMenu(conv.id);
    const despuesApertura = await listMessagesByConversation(conv.id, 50);
    const apertura = despuesApertura
      .filter((m) => m.direction === "OUTBOUND" && !vistosApertura.has(m.id))
      .map((m) => m.text.trim())
      .filter(Boolean);
    reporte.turnos.push({
      n: 0,
      persona: "(apertura automática)",
      bot: apertura,
      estado: await estadoTexto(conv.id, nombresEtiqueta),
    });

    let ultimoBot = apertura;
    for (let i = 0; i < caso.pasos.length; i += 1) {
      const paso = caso.pasos[i]!;
      let error = "";
      let bot: string[] = [];
      let persona = "";
      try {
        if ("auto" in paso && paso.auto === "completarFicha") {
          const r = await completarFichaSiPide(conv.id, conv.contactId, ultimoBot);
          if (!r.enviados.length) {
            reporte.turnos.push({
              n: i + 1,
              persona: "(ficha ya completa)",
              bot: ["(sin mensaje: no pedía más datos)"],
              estado: await estadoTexto(conv.id, nombresEtiqueta),
            });
            continue;
          }
          persona = r.enviados.join(" → ");
          bot = r.bot;
        } else if ("user" in paso) {
          persona = paso.user;
          bot = await decir(conv.id, conv.contactId, paso.user);
        }
        ultimoBot = bot;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      reporte.turnos.push({
        n: i + 1,
        persona,
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
    "# Batería menú (sin IA) — conversaciones reales",
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
      lineas.push("Persona:", `> ${turno.persona}`, "");
      if (turno.error) lineas.push(`Error: ${turno.error}`, "");
      lineas.push(`Estado: ${turno.estado}`, "");
      lineas.push("Respuesta:", turno.bot.length ? turno.bot.join("\n\n") : "(ninguna)", "");
    }
    lineas.push("---", "");
  }
  return lineas.join("\n");
}

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    for (const c of casos) console.log(`${c.id}\t${c.categoria}\t${c.titulo}`);
    return;
  }

  const filtro = new Set(
    (arg("--case") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const elegidos = filtro.size ? casos.filter((c) => filtro.has(c.id)) : casos;
  if (!elegidos.length) {
    throw new Error(
      `Ningún caso coincide. Disponibles: ${casos.map((c) => c.id).join(", ")}`,
    );
  }

  const catalogo = await listWhatsappTagCatalog();
  const nombresEtiqueta = new Map(catalogo.items.map((item) => [item.id, item.name]));

  console.log(`Batería menú (sin IA): ${elegidos.length} caso(s), uno por uno`);
  const t0 = Date.now();
  const reportes: CasoReporte[] = [];
  for (let i = 0; i < elegidos.length; i += 1) {
    const caso = elegidos[i]!;
    const r = await correrCaso(caso, nombresEtiqueta);
    reportes.push(r);
    const marca = r.errorFatal || r.turnos.some((t) => t.error) ? "ERR" : "ok ";
    console.log(`${marca} ${caso.id} (${i + 1}/${elegidos.length}) ${Math.round(r.ms / 1000)}s`);
    for (const t of r.turnos) {
      const preview = t.bot.join(" | ").replace(/\s+/g, " ").slice(0, 140);
      console.log(`   T${t.n} USER: ${t.persona}`);
      console.log(`      BOT: ${preview || "(ninguna)"}${t.error ? ` ERR:${t.error}` : ""}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "tests", "bateria", "reportes", stamp);
  await mkdir(dir, { recursive: true });
  const reporte = path.join(dir, "reporte-menu.md");
  await writeFile(reporte, renderMarkdown(reportes), "utf8");
  console.log(`\nListo en ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(reporte);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
