/**
 * Batería del bot de opciones (sin IA).
 *
 * Réplicas de la batería de IA (`tests/bateria/bateria_ineco.json`)
 * que el menú puede emular con opciones fijas y Medexis mockeado.
 *
 * No se replican (necesitan modelo o texto libre):
 * urgencias/riesgo (I*, P03–P07, P30, Q04, Q14, U22),
 * jailbreak (P27, W12), fuera de INECO libre (P01–P02),
 * varias intenciones en un mensaje (F03, Q*),
 * varios casos/personas (R18, S*, U*, V*, AA05),
 * historial/pila/pausa del diálogo IA (U09–U24),
 * reservas reales Medexis (Z01, AA01–AA06): acá se mockea.
 */
import { abrirBotMenu, runMenuTurn, usarMemoriaMenu } from "../src/whatsapp/bot-menu.js";
import { esSlotVirtual, modalidadDePrestacion } from "../src/whatsapp/acciones.js";
import type { WaConversation, WaMessage } from "../src/whatsapp/types.js";
import type { WaTagCatalog } from "../src/whatsapp/tags.js";
import type { AccionClave, SalidaAccion } from "../src/whatsapp/acciones.js";

const catalogo: WaTagCatalog = {
  groups: [
    { id: "g-sedes", name: "Sedes", color: "#000000", createdAt: "", updatedAt: "" },
    { id: "g-cob", name: "Coberturas", color: "#000000", createdAt: "", updatedAt: "" },
    { id: "g-otros", name: "Otros", color: "#000000", createdAt: "", updatedAt: "" },
  ],
  items: [
    tag("t-caba", "CABA", "g-sedes"),
    tag("t-ramos", "Ramos Mejía", "g-sedes"),
    tag("t-quilmes", "Quilmes", "g-sedes"),
    tag("t-moreno", "Moreno", "g-sedes"),
    tag("t-pilar", "Pilar", "g-sedes"),
    tag("t-rosario", "Rosario", "g-sedes"),
    tag("t-ioma", "IOMA", "g-cob"),
    tag("t-swiss", "Swiss Medical", "g-cob"),
    tag("t-ospis", "OSPIS", "g-cob"),
    tag("t-prev", "Prevención", "g-cob"),
    tag("t-part", "Particular", "g-cob"),
    tag("t-sin", "OS no soportada", "g-cob"),
    tag("t-pac", "Paciente", "g-otros"),
    tag("t-nopac", "No paciente", "g-otros"),
    tag("t-turno", "Pedido de turno", "g-otros"),
    tag("t-queja", "Queja", "g-otros"),
    tag("t-psi", "Psiquiatría", "g-otros"),
  ],
};

function tag(id: string, name: string, groupId: string) {
  return { id, name, groupId, createdAt: "", updatedAt: "" };
}

const conocimiento = `## Sedes
### CABA
Marcelo Torcuato de Alvear 1632, Recoleta. Teléfono 0810-266-4203.

### Gran Buenos Aires — Zona Oeste

**INECO Ramos Mejía (INDELO — Neurociencias del Oeste)**
- Castelli 86, esquina Moreno, Ramos Mejía (partido de La Matanza).
- Tel: (011) 5199-5600 · WhatsApp: 11 5035-4568.
- Email: ramos@ineco.org.ar

**INECO Moreno**
- 12 de Octubre 1097, Moreno.
- Tel: (011) 5199-5600 · WhatsApp: 11 4070-5558.
- Email: moreno@ineco.org.ar

### Quilmes
Calle Quilmes 45. WhatsApp 11 2555-1020.

### Pilar
Dirección Pilar 20. Teléfono 6666-7777.

### Rosario
Dirección Rosario 123. Teléfono 1111-2222.

## Coberturas
OSDE: la cobertura depende del plan. Escribí a coberturas@ineco.org.ar.

## Tratamientos
La psiquiatría en INECO incluye consulta presencial y online.
`;

const fallos: string[] = [];
let actuales: string[] = [];

function nombres(ids: string[]): string {
  return ids.map((id) => catalogo.items.find((item) => item.id === id)?.name ?? id).join(", ");
}

function ultimo(messages: WaMessage[]): string {
  return messages.filter((item) => item.direction === "OUTBOUND").at(-1)?.text ?? "";
}

function todos(messages: WaMessage[]): string {
  return messages.filter((item) => item.direction === "OUTBOUND").map((item) => item.text).join("\n\n");
}

function esperar(nombre: string, ok: boolean, detalle: string): void {
  const etiqueta = actuales.length ? `${actuales.join(" / ")} · ${nombre}` : nombre;
  if (ok) {
    process.stdout.write(`ok  ${etiqueta}\n`);
    return;
  }
  fallos.push(`${etiqueta}: ${detalle}`);
  process.stdout.write(`MAL ${etiqueta}: ${detalle}\n`);
}

type Mocks = {
  paciente?: (dni: string) => Promise<{ texto: string; ficha: Record<string, string> }>;
  accion?: (clave: AccionClave, consulta: string) => Promise<SalidaAccion>;
};

function mocksBase(): Required<Mocks> {
  return {
    async paciente(dni) {
      if (dni === "22222222" || dni === "20.111.222" || dni === "20111222" || dni === "AB123456") {
        const limpio = dni.replace(/[\s.\-_/]/g, "").toUpperCase();
        return {
          texto: "Es paciente",
          ficha: {
            dni: limpio,
            esPaciente: "si",
            pacienteNombre: "Ana",
            pacienteApellido: "Pérez",
            email: "ana@ineco.test",
            sexo: "femenino",
          },
        };
      }
      return { texto: "No es paciente", ficha: { dni, esPaciente: "no" } };
    },
    async accion(clave, consulta) {
      const t = consulta
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();
      if (clave === "turnos.listarTratamientos" && !consulta.trim()) {
        return { texto: "CONSULTA PSIQUIATRIA INECO (09001)\nCONSULTA PSIQUIATRIA ONLINE (09002)" };
      }
      if (clave === "turnos.listarTratamientos") {
        if (/invent|fulano|xyz|nadie/.test(t)) {
          return { texto: "Falta el profesional. No hay uno habilitado con ese nombre." };
        }
        if (/^bianchi$/.test(t.trim()) || (/\bbianchi\b/.test(t) && !/\bveronica\b|\bvaler/.test(t))) {
          return {
            texto: "Profesionales con ese nombre:\nBIANCHI VERÓNICA (29455053)\nBIANCHI VALERIA (30137225)",
          };
        }
        // Solo el nombre suelto pide confirmación; el nombre completo ya pasa a tratamientos.
        if (/^marcelo$/.test(t.trim()) || (/\bmarcelo\b/.test(t) && !/\bcetkovich\b|\bgustavo\b/.test(t))) {
          return { texto: "Buscás a CETKOVICH MARCELO GUSTAVO." };
        }
        if (/\bcetkovich\b|\bmarcelo\b|\bveronica\b|\bvaler/.test(t)) {
          const nombre = /\bveronica\b/.test(t)
            ? "BIANCHI VERÓNICA (29455053)"
            : /\bvaler/.test(t)
              ? "BIANCHI VALERIA (30137225)"
              : "CETKOVICH MARCELO GUSTAVO (12719943)";
          return {
            texto: `${nombre}: CONSULTA PSIQUIATRIA INECO (09001); CONSULTA PSIQUIATRIA ONLINE (09002)`,
          };
        }
        return { texto: "Falta el profesional. No hay uno habilitado con ese nombre." };
      }
      if (clave === "turnos.listarProfesionales") {
        return { texto: "CETKOVICH MARCELO GUSTAVO (12719943)" };
      }
      if (clave === "turnos.delPaciente") {
        return { texto: "futuro: 2026-12-02T09:00:00 con CETKOVICH MARCELO GUSTAVO" };
      }
      if (clave === "turnos.libres") {
        return {
          texto: "Horarios libres",
          horarios:
            "mar 2/12 09:00, presencial (2026-12-02 09:00:00)\nmar 2/12 10:00, virtual (2026-12-02 10:00:00)",
          hastaDia: 20,
          busqueda: "12719943|09001",
        };
      }
      if (clave === "turnos.reservar") {
        return { texto: "Turno dado: CETKOVICH MARCELO GUSTAVO, 2026-12-02 09:00:00." };
      }
      if (clave === "turnos.cancelar") {
        return { texto: "Turno cancelado: CETKOVICH MARCELO GUSTAVO, 2026-12-02 09:00:00." };
      }
      return { texto: "Falta el profesional. No hay uno habilitado con ese nombre." };
    },
  };
}

type Sesion = {
  conversation: WaConversation;
  messages: WaMessage[];
  decir: (texto: string) => Promise<void>;
};

async function sesion(id: string, mocks: Mocks = {}): Promise<Sesion> {
  const base = mocksBase();
  const conversation: WaConversation = {
    id,
    contactId: "contacto",
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    assigneeKind: "bot",
    assigneeUserId: null,
    assigneeName: "Bot",
    tagIds: [],
    resumen: null,
    intencionAbierta: null,
    intencionConcluida: false,
    intencionPropuesta: null,
    prueba: true,
    pruebaMotor: "menu",
    pruebaResultado: null,
    pruebaNota: null,
    pruebaNotaEn: null,
    pruebaAclaraciones: [],
    auditoria: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const messages: WaMessage[] = [];
  usarMemoriaMenu({
    conversation,
    messages,
    catalogo,
    conocimiento,
    paciente: mocks.paciente ?? base.paciente,
    accion: mocks.accion ?? base.accion,
  });
  await abrirBotMenu(conversation.id);
  return {
    conversation,
    messages,
    async decir(texto: string) {
      messages.push({
        id: `in-${messages.length + 1}`,
        conversationId: conversation.id,
        contactId: conversation.contactId,
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
      await runMenuTurn(conversation.id);
    },
  };
}

async function irACaba(s: Sesion): Promise<void> {
  await s.decir("1");
}

async function caso(ids: string[], titulo: string, fn: () => Promise<void>): Promise<void> {
  actuales = ids;
  process.stdout.write(`\n## ${ids.join(", ")} — ${titulo}\n`);
  try {
    await fn();
  } catch (error) {
    esperar("excepción", false, error instanceof Error ? error.message : String(error));
  }
  actuales = [];
}

async function main(): Promise<void> {
  process.stdout.write("# Batería bot de opciones (réplicas de IA)\n");

  esperar("online es virtual", modalidadDePrestacion("CONSULTA PSIQUIATRIA ONLINE") === "virtual", "");
  esperar("ineco es presencial", modalidadDePrestacion("CONSULTA PSIQUIATRIA INECO") === "presencial", "");
  esperar(
    "edificio video es virtual",
    esSlotVirtual({ edificio: "Video-Consulta Medexis" }) && !esSlotVirtual({ edificio: "INECO CABA" }),
    "",
  );

  await caso(["F01"], "Saludo y lista de sedes", async () => {
    const s = await sesion("F01");
    esperar("lista sedes", /sucursal/i.test(ultimo(s.messages)) && /CABA/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 100));
  });

  await caso(["D01", "P08"], "Dirección / datos de CABA vía info", async () => {
    const s = await sesion("D01");
    await irACaba(s);
    await s.decir("2");
    await s.decir("1");
    await s.decir("1");
    esperar("datos CABA", /Alvear 1632|0810-266-4203/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    esperar("etiqueta CABA", nombres(s.conversation.tagIds).includes("CABA"), nombres(s.conversation.tagIds));
  });

  await caso(["P12"], "Queja sin pedir turno", async () => {
    const s = await sesion("P12");
    await irACaba(s);
    await s.decir("4");
    await s.decir("Me atendieron mal en recepción");
    esperar("etiqueta Queja", nombres(s.conversation.tagIds).includes("Queja"), nombres(s.conversation.tagIds));
    await s.decir("44");
    esperar("opción inválida", /no es válida/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 120));
    esperar("sigue en bot", s.conversation.assigneeKind !== "user", s.conversation.assigneeKind);
  });

  await caso(["P14", "R16"], "Sede Ramos Mejía (no CABA)", async () => {
    const s = await sesion("P14");
    await s.decir("2");
    const ramos = ultimo(s.messages);
    esperar("datos Ramos", /5199-5600|5035-4568/.test(ramos), ramos.slice(0, 180));
    esperar("solo Ramos, no Moreno sede", /Ramos Mej[ií]a/.test(ramos) && !/12 de Octubre|4070-5558|moreno@ineco/.test(ramos), ramos.slice(0, 280));
    esperar("etiqueta Ramos", nombres(s.conversation.tagIds).includes("Ramos Mejía") && !nombres(s.conversation.tagIds).includes("CABA"), nombres(s.conversation.tagIds));
    esperar("pregunta algo más", /Te puedo ayudar en algo más/i.test(ramos), ramos.slice(0, 200));
    esperar("no repite lista completa", !/¿Para qué sucursal/.test(ramos), ramos.slice(0, 160));
    await s.decir("1");
    esperar("ofrece CABA o otra", /Continuar con CABA|Ver otra sucursal/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    await s.decir("1");
    esperar("pasa a menú CABA", /Desde acá puedo ayudarte|Turnos|Información/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    esperar("etiqueta CABA", nombres(s.conversation.tagIds).includes("CABA") && !nombres(s.conversation.tagIds).includes("Ramos Mejía"), nombres(s.conversation.tagIds));
  });

  await caso(["P14b"], "Sede no CABA → ver otra sucursal", async () => {
    const s = await sesion("P14b");
    await s.decir("2");
    await s.decir("1");
    await s.decir("2");
    esperar("vuelve lista sedes", /¿Para qué sucursal/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 120));
  });

  await caso(["P14c"], "Sede no CABA → no, gracias", async () => {
    const s = await sesion("P14c");
    await s.decir("2");
    await s.decir("2");
    esperar("cierra amable", /disposición|escribime/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 120));
  });

  await caso(["P15"], "Quilmes: datos de la sede", async () => {
    const s = await sesion("P15");
    await irACaba(s);
    await s.decir("2");
    await s.decir("1");
    await s.decir("3");
    const quilmes = ultimo(s.messages);
    esperar("datos Quilmes", /Quilmes 45|2555-1020/.test(quilmes), quilmes.slice(0, 180));
    esperar("pregunta algo más", /Te puedo ayudar en algo más/i.test(quilmes), quilmes.slice(0, 200));
    esperar("etiqueta Quilmes", nombres(s.conversation.tagIds).includes("Quilmes"), nombres(s.conversation.tagIds));
    await s.decir("1");
    await s.decir("1");
    esperar("menú acciones CABA", /Turnos|Información|Tratamientos|Quejas/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
  });

  await caso(["P16"], "Corrige de CABA a Rosario (última sede gana)", async () => {
    const s = await sesion("P16");
    await s.decir("1");
    esperar("primera CABA", nombres(s.conversation.tagIds).includes("CABA"), nombres(s.conversation.tagIds));
    await s.decir("0");
    await s.decir("8");
    esperar("solo Rosario", nombres(s.conversation.tagIds).includes("Rosario") && !nombres(s.conversation.tagIds).includes("CABA"), nombres(s.conversation.tagIds));
    esperar("datos Rosario", /Rosario 123|1111-2222/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
  });

  await caso(["P18"], "Moreno desde la lista de sedes", async () => {
    const s = await sesion("P18");
    await s.decir("5");
    const moreno = ultimo(s.messages);
    esperar("datos Moreno", /12 de Octubre|4070-5558|moreno@ineco/.test(moreno), moreno.slice(0, 180));
    esperar("solo Moreno, no Ramos sede", /Moreno/.test(moreno) && !/5035-4568|ramos@ineco|Castelli 86/.test(moreno), moreno.slice(0, 280));
    esperar("etiqueta Moreno", nombres(s.conversation.tagIds).includes("Moreno"), nombres(s.conversation.tagIds));
  });

  await caso(["P19"], "Cobertura IOMA", async () => {
    const s = await sesion("P19");
    await irACaba(s);
    await s.decir("2");
    await s.decir("2");
    await s.decir("1");
    esperar("etiqueta IOMA", nombres(s.conversation.tagIds).includes("IOMA"), nombres(s.conversation.tagIds));
    esperar("anotó IOMA", /IOMA|Anoté IOMA/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 180));
  });

  await caso(["P29"], "Otra obra social → OS no soportada", async () => {
    const s = await sesion("P29");
    await irACaba(s);
    await s.decir("2");
    await s.decir("2");
    // Lista: IOMA, OSPIS, Particular, Prevención, Swiss Medical + Otra / OS no soportada
    await s.decir("44");
    esperar(
      "44 no etiqueta",
      !nombres(s.conversation.tagIds).includes("OS no soportada") && /no es válida/i.test(ultimo(s.messages)),
      nombres(s.conversation.tagIds),
    );
    await s.decir("6");
    esperar(
      "OS no soportada",
      nombres(s.conversation.tagIds).includes("OS no soportada"),
      nombres(s.conversation.tagIds),
    );
  });

  await caso(["P28"], "No paciente + pedido de turno", async () => {
    const s = await sesion("P28");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("11111111");
    esperar("pide nombre", /nombre/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 120));
    esperar("No paciente", nombres(s.conversation.tagIds).includes("No paciente"), nombres(s.conversation.tagIds));
    esperar("Pedido de turno", nombres(s.conversation.tagIds).includes("Pedido de turno"), nombres(s.conversation.tagIds));
  });

  await caso(["R01"], "Turno sin datos: pide DNI", async () => {
    const s = await sesion("R01");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    const dniMsg = ultimo(s.messages);
    esperar("pide DNI", /DNI/i.test(dniMsg) && /sin puntos ni espacios/i.test(dniMsg), dniMsg.slice(0, 160));
    esperar("volver en la misma frase", /tocá 0 para volver/i.test(dniMsg) && !/00\.\s*Cancelar/i.test(dniMsg), dniMsg.slice(0, 180));
    esperar("Pedido de turno + CABA", nombres(s.conversation.tagIds).includes("Pedido de turno") && nombres(s.conversation.tagIds).includes("CABA"), nombres(s.conversation.tagIds));
  });

  await caso(["R06", "U05"], "Datos de a uno (no paciente)", async () => {
    const s = await sesion("R06");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("33333333");
    await s.decir("Martín");
    esperar("pide apellido", /apellido/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 100));
    await s.decir("Pereyra");
    // Martín ⇒ masculino inferido; no pregunta sexo.
    esperar("pide email", /email/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 100));
    esperar("sexo inferido", s.conversation.menuEstado?.sexo === "masculino", String(s.conversation.menuEstado?.sexo));
    await s.decir("mail-malo");
    esperar("email inválido", /email no es válido/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 120));
    await s.decir("martin@ineco.test");
    esperar(
      "pide profesional",
      /médico en particular|indistinto/i.test(ultimo(s.messages)),
      ultimo(s.messages).slice(0, 160),
    );
    esperar(
      "ficha junta",
      s.conversation.menuEstado?.nombre === "Martín" &&
        s.conversation.menuEstado?.apellido === "Pereyra" &&
        s.conversation.menuEstado?.sexo === "masculino" &&
        s.conversation.menuEstado?.email === "martin@ineco.test",
      JSON.stringify(s.conversation.menuEstado),
    );
  });

  await caso(["U08"], "DNI con puntos, corto y extranjero", async () => {
    const s = await sesion("U08");
    await irACaba(s);
    await s.decir("1");
    await s.decir("3");
    await s.decir("asdf");
    esperar("letras no", /no parece un dni/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 140));
    await s.decir("1234");
    esperar("muy corto no", /no parece un dni/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 140));
    await s.decir("20.111.222");
    esperar("con puntos sí", /confirmar|sí o no|Elegí el turno|anular/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
  });

  await caso(["W06", "Z02"], "Ver turnos del paciente (mock)", async () => {
    const s = await sesion("W06");
    await irACaba(s);
    await s.decir("1");
    await s.decir("2");
    await s.decir("22222222");
    esperar("lista turnos", /CETKOVICH|2026-12-02/i.test(todos(s.messages)), todos(s.messages).slice(-200));
    esperar("Paciente", nombres(s.conversation.tagIds).includes("Paciente"), nombres(s.conversation.tagIds));
  });

  await caso(["AA06"], "Cancelar: primero no, después sí (mock)", async () => {
    const s = await sesion("AA06");
    await irACaba(s);
    await s.decir("1");
    await s.decir("3");
    await s.decir("22222222");
    esperar("pide confirmación", /sí o no/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    await s.decir("no");
    esperar("quedó sin anular", /sin anular|Sacar un turno/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    await s.decir("3");
    await s.decir("sí");
    esperar("cancelado", /Turno cancelado/i.test(todos(s.messages)), todos(s.messages).slice(-180));
  });

  await caso(["AB02", "P22"], "Profesional inventado", async () => {
    const s = await sesion("AB02");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("22222222");
    await s.decir("Fulano Inventado XYZ");
    esperar(
      "no hay profesional",
      /no hay un profesional habilitado|no encontré ese nombre/i.test(ultimo(s.messages)),
      ultimo(s.messages).slice(0, 160),
    );
  });

  await caso(["AC01", "AC04"], "Varios con el apellido y confirmar Buscás a", async () => {
    const s = await sesion("AC01");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("22222222");
    await s.decir("Bianchi");
    esperar("lista varios", /BIANCHI VERÓNICA|BIANCHI VALERIA/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 200));
    await s.decir("1");
    esperar("tratamientos", /tratamientos de|CONSULTA PSIQUIATRIA/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 200));
  });

  await caso(["AC04b"], "Confirma el profesional propuesto", async () => {
    const s = await sesion("AC04b");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("22222222");
    await s.decir("Marcelo");
    esperar(
      "confirma Cetkovich",
      /Buscás a CETKOVICH|te referís a CETKOVICH/i.test(ultimo(s.messages)),
      ultimo(s.messages).slice(0, 160),
    );
    await s.decir("sí");
    esperar("tratamientos", /tratamientos de|CONSULTA PSIQUIATRIA/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 200));
  });

  await caso(["W04", "Z01m"], "Horarios y reserva mock (sin Medexis real)", async () => {
    const s = await sesion("W04");
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("22222222");
    await s.decir("Marcelo");
    await s.decir("sí");
    await s.decir("1");
    esperar(
      "horarios",
      /horarios libres|turnos libres|presencial|virtual|\d{1,2}:\d{2}/i.test(ultimo(s.messages)),
      ultimo(s.messages).slice(0, 220),
    );
    await s.decir("1");
    esperar("turno dado", /Turno dado/i.test(todos(s.messages)), todos(s.messages).slice(-160));
  });

  await caso(["W04err"], "Reserva falla: mensaje amigable + menú turnos", async () => {
    const s = await sesion("W04err", {
      async accion(clave, consulta = "") {
        if (clave === "turnos.listarTratamientos") {
          if (/cetkovich/i.test(consulta) && !/marcelo|gustavo/i.test(consulta)) {
            return { texto: "Buscás a CETKOVICH MARCELO GUSTAVO." };
          }
          return {
            texto: "Estos son los tratamientos de CETKOVICH MARCELO GUSTAVO:\nCONSULTA PSIQUIATRIA INECO (09001)",
          };
        }
        if (clave === "turnos.libres") {
          return {
            texto: "Horarios libres",
            horarios: "jue 3/12 11:00, presencial (2026-12-03 11:00:00)",
            hastaDia: 20,
            busqueda: "12719943|09001",
          };
        }
        if (clave === "turnos.reservar") {
          return { texto: "El codigo de prestacion no puede tener precio cero" };
        }
        return { texto: "ok" };
      },
    });
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("22222222");
    await s.decir("Cetkovich");
    await s.decir("sí");
    await s.decir("1");
    await s.decir("1");
    const t = ultimo(s.messages);
    esperar("sin error técnico", !/precio cero|codigo de prestacion/i.test(t), t.slice(0, 200));
    esperar("dijo que no pudo", /no pude darte ese turno|no pudo registrar/i.test(t), t.slice(0, 200));
    esperar("menú turnos", /Sacar un turno|Ver mis turnos|Cancelar un turno/i.test(t), t.slice(0, 220));
    esperar("paso turnos", s.conversation.menuEstado?.paso === "turnos", String(s.conversation.menuEstado?.paso));
  });

  await caso(["E08", "tratamientos"], "Lista de tratamientos + etiqueta", async () => {
    const s = await sesion("E08");
    await irACaba(s);
    await s.decir("3");
    await s.decir("1");
    esperar("info tratamiento", /psiquiat/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    esperar("etiqueta Psiquiatría", nombres(s.conversation.tagIds).includes("Psiquiatría"), nombres(s.conversation.tagIds));
  });

  await caso(["nav"], "Opción inválida y volver atrás cancela el flujo", async () => {
    const s = await sesion("nav");
    await s.decir("44");
    esperar("sede inválida", /no es válida/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 100));
    await irACaba(s);
    await s.decir("9");
    esperar("menú inválido", /no es válida/i.test(ultimo(s.messages)) && /Volver atrás/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 140));
    await s.decir("1");
    await s.decir("1");
    await s.decir("33333333");
    await s.decir("0");
    esperar("0 cancela a turnos", /Listo, cancelé esto|Sacar un turno/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    esperar("sin cancelar proceso", !/Cancelé este proceso|00\./i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    await s.decir("0");
    esperar("0 desde turnos al menú", /Turnos|Información|Tratamientos|Quejas/i.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
  });

  await caso(["indistinto"], "Sin médico preferido: lista con indistinto", async () => {
    const s = await sesion("indistinto", {
      async accion(clave) {
        if (clave === "turnos.listarProfesionales") {
          return { texto: "CETKOVICH MARCELO GUSTAVO (12719943)\nBIANCHI VERÓNICA (29455053)" };
        }
        return { texto: "ok" };
      },
    });
    await irACaba(s);
    await s.decir("1");
    await s.decir("1");
    await s.decir("22222222");
    await s.decir("indistinto");
    const t = ultimo(s.messages);
    esperar("lista médicos", /CETKOVICH|BIANCHI/i.test(t) && /Elegí un número/i.test(t), t.slice(0, 220));
    esperar("pide profesional claro", /médico|indistinto/i.test(todos(s.messages)), todos(s.messages).slice(-300));
  });

  await caso(["Pilar"], "Pilar no CABA", async () => {
    const s = await sesion("Pilar");
    await s.decir("6");
    esperar("datos Pilar", /Pilar 20|6666-7777/.test(ultimo(s.messages)), ultimo(s.messages).slice(0, 160));
    esperar("etiqueta Pilar", nombres(s.conversation.tagIds).includes("Pilar"), nombres(s.conversation.tagIds));
  });

  usarMemoriaMenu(null);
  process.stdout.write(`\n---\n`);
  if (fallos.length) {
    process.stderr.write(`${fallos.length} fallos\n${fallos.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("Menu sin IA: réplicas de la batería IA ok\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
