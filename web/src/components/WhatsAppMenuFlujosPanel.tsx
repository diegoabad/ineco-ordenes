import { useState } from "react";

type Opcion = {
  clave: string;
  titulo: string;
  accion: string;
  respuesta?: string;
  siguiente?: string;
};

type Paso = {
  id: string;
  titulo: string;
  mensaje: string;
  opciones: Opcion[];
  nota?: string;
};

const PASOS: Paso[] = [
  {
    id: "inicio",
    titulo: "Inicio",
    mensaje:
      "Saludo (config del Bot) + aviso de urgencias + pregunta de sucursal.\n\nEste canal no atiende urgencias. Si las tiene, comuníquese con su médico o servicio de emergencias.",
    opciones: [
      {
        clave: "1…N",
        titulo: "Elegir sucursal",
        accion: "Guardar sede y etiquetar",
        siguiente: "Si es CABA → Tipo de paciente. Si no → Algo más (con datos de esa sede).",
      },
    ],
    nota: "Sedes fijas: CABA, Ramos Mejía, Quilmes, Temperley, Moreno, Pilar, Junín, Rosario, Comodoro Rivadavia, San Juan.",
  },
  {
    id: "sede",
    titulo: "Sucursal",
    mensaje:
      "¿Para qué sucursal es tu consulta?\nRespondé con el número.\n\n1. CABA\n2. Ramos Mejía\n…",
    opciones: [
      {
        clave: "CABA",
        titulo: "Sede CABA",
        accion: "Etiquetar CABA → preguntar tipo de paciente",
        siguiente: "Tipo de paciente",
      },
      {
        clave: "Otra",
        titulo: "Otra sede",
        accion: "Buscar texto de contacto en Conocimiento",
        respuesta: "Datos de la sucursal + ¿Te puedo ayudar en algo más?",
        siguiente: "Algo más",
      },
      {
        clave: "0",
        titulo: "Volver atrás",
        accion: "Deshacer / paso anterior",
        siguiente: "Según la pila",
      },
    ],
  },
  {
    id: "pacienteTipo",
    titulo: "Tipo de paciente",
    mensaje: "1. Ya soy paciente\n2. Primera vez en INECO\n3. Otras consultas\n\n0. Volver atrás",
    opciones: [
      {
        clave: "1",
        titulo: "Ya soy paciente",
        accion: "Pedir DNI → identificar en Medexis → saludar con nombre",
        siguiente: "Menú servicios",
      },
      {
        clave: "2",
        titulo: "Primera vez en INECO",
        accion:
          "Etiquetar Oportunidad → pedir datos + motivo → IA interpreta y cataloga diagnóstico/síntomas (Alzheimer, TDAH, migraña, etc.) → etiqueta → si falta dato, pide lo pendiente → Adulto/Infanto → deriva a asesor",
        siguiente: "Asesor humano",
      },
      {
        clave: "3",
        titulo: "Otras consultas",
        accion:
          "Pedir breve consulta (admin, coberturas, reclamos…) → etiqueta Temas varios → deriva a asesor (fin del bot)",
        siguiente: "Bandeja Temas varios",
      },
    ],
    nota: "Crear en Etiquetas si falta: Temas varios.",
  },
  {
    id: "menu",
    titulo: "Menú servicios",
    mensaje:
      "¿Con qué te puedo ayudar? (tras identificar) / ¿Necesitás ayuda con algo más? (si vuelve)\n\n1. Turnos\n2. Informar pago\n3. Solicitar recetas\n\n0. Volver atrás (terminar conversación)",
    opciones: [
      {
        clave: "1",
        titulo: "Turnos",
        accion: "Etiquetar turnos → menú turnos",
        siguiente: "Menú turnos",
      },
      {
        clave: "2",
        titulo: "Informar pago",
        accion: "Etiquetar pagos + texto de pagos@ineco.ar",
        respuesta: "Instrucciones de mail + volver al menú",
        siguiente: "Menú servicios",
      },
      {
        clave: "3",
        titulo: "Solicitar recetas",
        accion: "Etiquetar recetas + texto de la app INECO",
        respuesta: "Link app + volver al menú",
        siguiente: "Menú servicios",
      },
      {
        clave: "0",
        titulo: "Volver atrás (terminar conversación)",
        accion: "Cerrar charla con mensaje de despedida",
        siguiente: "Fin",
      },
    ],
    nota: "Crear en Etiquetas: turnos, pagos, recetas, pedir-turno, cancelar-turno, proximos-turnos.",
  },
  {
    id: "algoMas",
    titulo: "Algo más",
    mensaje:
      "(Si no es CABA) Este WhatsApp gestiona solo la sede de CABA…\n¿Te puedo ayudar en algo más?\n\n1. Sí\n2. No, gracias",
    opciones: [
      {
        clave: "1",
        titulo: "Sí",
        accion: "Mostrar opciones de continuación",
        respuesta:
          "1. Continuar con CABA / Menú principal\n2. Ver otra sucursal",
        siguiente: "Según elección",
      },
      {
        clave: "2",
        titulo: "No, gracias",
        accion: "Cerrar charla amable",
        siguiente: "Fin",
      },
    ],
  },
  {
    id: "turnos",
    titulo: "Menú turnos",
    mensaje:
      "¿En qué te puedo ayudar con los turnos?\n\n1. Próximos turnos\n2. Cancelar turnos\n3. Pedir turno\n\n0. Volver atrás",
    opciones: [
      {
        clave: "1",
        titulo: "Próximos turnos",
        accion:
          "Etiquetar turnos + proximos-turnos → listado y menú de turnos en un solo mensaje",
        siguiente: "Listado + menú turnos",
      },
      {
        clave: "2",
        titulo: "Cancelar turnos",
        accion:
          "Listar próximos 6 meses numerados → elegir → «Perfecto, el turno será cancelado» → motivo (costo, horario, etc.) → guardar pedido (sin anular en Medexis)",
        siguiente: "Menú turnos",
      },
      {
        clave: "3",
        titulo: "Pedir turno",
        accion:
          "Un mensaje pidiendo todo lo que falte junto → el paciente responde en un solo mensaje → IA ubica cada dato → si falta algo se pide de nuevo → resumen y deriva",
        siguiente: "Camino turnos / pedido",
      },
      {
        clave: "0",
        titulo: "Volver atrás",
        accion: "Volver al menú servicios",
        siguiente: "Menú servicios",
      },
    ],
    nota: "Si «dar turnos» está apagado en Bot, pedir turno toma datos y deriva al equipo. Tags: turnos, proximos-turnos, cancelar-turno, pedir-turno.",
  },
  {
    id: "caminoTurnos",
    titulo: "Camino turnos (pasos)",
    mensaje: "Secuencia interna después de elegir 1–4.",
    opciones: [
      {
        clave: "dni",
        titulo: "DNI",
        accion: "Validar documento → consultarPaciente / Medexis",
        respuesta: "¿Me pasás el DNI…?",
        siguiente: "nombre / apellido / sexo / email si faltan",
      },
      {
        clave: "datos",
        titulo: "Pedido de turno (datos)",
        accion:
          "Mostrar lo ya conocido + pedir faltantes en un solo mensaje (mail, fecha nac., profesional, prestación o motivo, cobertura, afiliado…). La IA parsea y matchea profesional/prestación con BuscaTurno",
        siguiente: "Resumen en chat (con match de catálogo) + derivado a equipo",
      },
      {
        clave: "profesional",
        titulo: "Profesional",
        accion:
          "Texto libre del paciente; por detrás se matchea con el listado de BuscaTurno para el equipo",
        respuesta: "¿Con qué profesional…?",
        siguiente: "prestación o motivo",
      },
      {
        clave: "tratamiento",
        titulo: "Prestación o motivo",
        accion:
          "Texto libre; la IA / match intenta ubicar la prestación del catálogo BuscaTurno",
        siguiente: "cierre pedido, o horarios si reserva",
      },
      {
        clave: "horarios",
        titulo: "Horarios",
        accion: "Mostrar libres Medexis; más fechas / más temprano",
        siguiente: "elegirTurno → confirmar reserva",
      },
      {
        clave: "0",
        titulo: "Volver atrás",
        accion: "Cancelar el subpaso y volver al menú de turnos",
        siguiente: "Menú turnos",
      },
    ],
  },
  {
    id: "info",
    titulo: "Menú información",
    mensaje:
      "¿Sobre qué querés información?\n\n1. Sucursales\n2. Coberturas\n3. Profesionales\n4. Tratamientos\n5. Datos de INECO\n\n0. Volver atrás",
    opciones: [
      {
        clave: "1",
        titulo: "Sucursales",
        accion: "Leer capítulo de Conocimiento / pedir sede",
        siguiente: "Respuesta + algo más / menú info",
      },
      {
        clave: "2",
        titulo: "Coberturas",
        accion: "Texto de Conocimiento (coberturas)",
        siguiente: "Respuesta",
      },
      {
        clave: "3",
        titulo: "Profesionales",
        accion: "Buscar profesional o listar desde Conocimiento / busca turno",
        siguiente: "Respuesta",
      },
      {
        clave: "4",
        titulo: "Tratamientos",
        accion: "Buscar tratamiento / prestaciones",
        siguiente: "Respuesta",
      },
      {
        clave: "5",
        titulo: "Datos de INECO",
        accion: "Capítulo Institución de Conocimiento",
        siguiente: "Respuesta",
      },
      {
        clave: "0",
        titulo: "Volver atrás",
        accion: "Volver al menú principal",
        siguiente: "Menú principal",
      },
    ],
    nota: "El contenido de las respuestas de info se edita en la solapa Conocimiento.",
  },
];

function PasoCard({ paso }: { paso: Paso }) {
  const [open, setOpen] = useState(paso.id === "menu" || paso.id === "inicio");
  return (
    <section className={`wa-motor-card${open ? " is-open" : ""}`}>
      <button type="button" className="wa-motor-card__title" onClick={() => setOpen((v) => !v)}>
        {paso.titulo}
      </button>
      {open ? (
        <div className="wa-motor-card__body wa-menu-flujo__body">
          <div className="wa-menu-flujo__mensaje">
            <span className="wa-menu-flujo__label">Mensaje / pantalla</span>
            <pre>{paso.mensaje}</pre>
          </div>
          {paso.nota ? <p className="wa-menu-flujo__nota">{paso.nota}</p> : null}
          <div className="wa-menu-flujo__opciones">
            <span className="wa-menu-flujo__label">Opciones</span>
            <ul>
              {paso.opciones.map((op) => (
                <li key={`${paso.id}-${op.clave}-${op.titulo}`}>
                  <div className="wa-menu-flujo__op-head">
                    <strong>{op.clave}</strong>
                    <span>{op.titulo}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Acción</dt>
                      <dd>{op.accion}</dd>
                    </div>
                    {op.respuesta ? (
                      <div>
                        <dt>Respuesta</dt>
                        <dd>
                          <pre>{op.respuesta}</pre>
                        </dd>
                      </div>
                    ) : null}
                    {op.siguiente ? (
                      <div>
                        <dt>Siguiente</dt>
                        <dd>{op.siguiente}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function WhatsAppMenuFlujosPanel() {
  return (
    <div className="wa-config-panel fl-table-card wa-menu-flujo">
      <p className="wa-config-panel__hint">
        Mapa del bot de opciones (sin IA). Los menús y textos fijos viven en el código; el contenido de
        Información se edita en Conocimiento; el saludo y «dar turnos» en Bot.
      </p>
      <div className="wa-motor-list">
        {PASOS.map((paso) => (
          <PasoCard key={paso.id} paso={paso} />
        ))}
      </div>
    </div>
  );
}
