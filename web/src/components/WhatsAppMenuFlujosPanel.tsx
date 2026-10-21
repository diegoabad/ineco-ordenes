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
    mensaje: "Saludo (config del Bot) + pregunta de sucursal.",
    opciones: [
      {
        clave: "1…N",
        titulo: "Elegir sucursal",
        accion: "Guardar sede y etiquetar",
        siguiente: "Si es CABA → Menú principal. Si no → Algo más (con datos de esa sede).",
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
        accion: "Abrir menú principal",
        respuesta: "Desde acá puedo ayudarte con:…",
        siguiente: "Menú principal",
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
    id: "menu",
    titulo: "Menú principal",
    mensaje: "Desde acá puedo ayudarte con:\n\n1. Turnos\n2. Información\n3. Tratamientos\n4. Quejas\n\n0. Volver atrás",
    opciones: [
      {
        clave: "1",
        titulo: "Turnos",
        accion: "Entrar a menú de turnos",
        siguiente: "Menú turnos",
      },
      {
        clave: "2",
        titulo: "Información",
        accion: "Entrar a menú de información",
        siguiente: "Menú información",
      },
      {
        clave: "3",
        titulo: "Tratamientos",
        accion: "Atajo a información → tratamientos",
        siguiente: "Menú información (opción 4)",
      },
      {
        clave: "4",
        titulo: "Quejas",
        accion: "Etiquetar Queja + derivar a equipo",
        respuesta: "Se la dejo al equipo.",
        siguiente: "Fin / menú",
      },
      {
        clave: "0",
        titulo: "Volver atrás",
        accion: "Volver a sucursales",
        siguiente: "Sucursal",
      },
    ],
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
      "¿Qué necesitás con los turnos?\n\n1. Sacar un turno\n2. Ver mis turnos\n3. Cancelar un turno\n4. Cambiar un turno\n\n0. Volver atrás",
    opciones: [
      {
        clave: "1",
        titulo: "Sacar",
        accion: "Etiquetar Pedido de turno + CABA → pedir DNI (o ficha si no da turnos)",
        siguiente: "Camino turnos (DNI → datos → profesional…)",
      },
      {
        clave: "2",
        titulo: "Ver mis turnos",
        accion: "Pedir DNI → Medexis turnos.delPaciente",
        siguiente: "Camino turnos",
      },
      {
        clave: "3",
        titulo: "Cancelar",
        accion: "Pedir DNI → listar → confirmar anulación",
        siguiente: "Camino turnos",
      },
      {
        clave: "4",
        titulo: "Cambiar",
        accion: "Pedir DNI → anular y buscar nuevo",
        siguiente: "Camino turnos",
      },
      {
        clave: "0",
        titulo: "Volver atrás",
        accion: "Volver al menú principal",
        siguiente: "Menú principal",
      },
    ],
    nota: "Si «dar turnos» está apagado en Bot, sacar/cambiar toma datos y deriva al equipo.",
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
        titulo: "Nombre, apellido, sexo, email",
        accion: "Completar ficha del paciente",
        siguiente: "profesional (si sacar/cambiar y puede dar turnos)",
      },
      {
        clave: "profesional",
        titulo: "Profesional",
        accion: "Nombre libre o «indistinto» → lista",
        respuesta: "¿Tenés algún médico en particular…?",
        siguiente: "confirmar (si ambiguo) → tratamiento",
      },
      {
        clave: "tratamiento",
        titulo: "Tratamiento",
        accion: "Elegir de lista → turnos.libres",
        siguiente: "horarios",
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
