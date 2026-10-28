import type {
  WaCasoTurno,
  WaEventoDato,
  WaPausaDialogo,
  WaResultadoAccion,
  WaTemaPila,
} from "./estado-dialogo.js";

export type WaConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "WAITING_QR"
  | "CONNECTED"
  | "RECONNECTING"
  | "ERROR";

export type WaMessageDirection = "INBOUND" | "OUTBOUND";
export type WaMessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "STICKER"
  | "UNKNOWN";
export type WaMessageStatus = "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
export type WaConversationStatus = "OPEN" | "ARCHIVED";

export type WaContactGrupoEtario = "infanto" | "adulto";
export type WaContactConsultaPara = "propio" | "tercero";
export type WaContactSexo = "masculino" | "femenino";

export type WaContact = {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  whatsappName: string | null;
  cobertura: string | null;
  email: string | null;
  grupoEtario: WaContactGrupoEtario | null;
  consultaPara: WaContactConsultaPara | null;
  /** Quien escribe por WhatsApp cuando no es el paciente. */
  contactoNombre: string | null;
  contactoApellido: string | null;
  relacionFamiliar: string | null;
  dni: string | null;
  sexo: WaContactSexo | null;
  esPaciente: boolean | null;
  isBlocked: boolean;
  lastInteractionAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WaAuditoriaPaso = {
  en: string;
  intencion: string;
  secundaria: string;
  abierta: string;
  concluida: boolean;
  peligro: boolean;
  duda: boolean;
  cortesia: "" | "saludo" | "cierre";
  /** Qué pasó en este mensaje. El resumen de la charla va aparte. */
  hecho: string;
  resumen: string;
  etiquetas: string[];
};

export type WaPruebaAclaracion = {
  messageId: string;
  texto: string;
};

export type MenuPaso =
  | "sede"
  | "algoMas"
  | "pacienteTipo"
  | "primeraVezDatos"
  | "otrasConsultas"
  | "menu"
  | "turnos"
  | "info"
  | "infoTema"
  | "queja"
  | "dni"
  | "nombre"
  | "apellido"
  | "sexo"
  | "email"
  | "fechaNacimiento"
  | "pedidoDatos"
  | "profesional"
  | "tratamiento"
  | "cobertura"
  | "afiliado"
  | "horarios"
  | "elegirTurno"
  | "motivoCancelacion"
  | "confirmar";

export type MenuModo =
  | ""
  | "sacar"
  | "ver"
  | "cancelar"
  | "cambiar"
  | "sucursales"
  | "coberturas"
  | "profesionales"
  | "tratamientos"
  | "institucion"
  | "queja";

export type MenuEstado = {
  paso: MenuPaso;
  modo: MenuModo;
  dni: string;
  nombre: string;
  apellido: string;
  sexo: "" | "masculino" | "femenino";
  email: string;
  telefono: string;
  fechaNacimiento: string;
  cobertura: string;
  nAfiliado: string;
  motivoConsulta: string;
  edad: string;
  esPaciente: "" | "si" | "no";
  profesional: string;
  tratamiento: string;
  /** Nombre del profesional en BuscaTurno (match interno para el equipo). */
  profesionalCatalogo: string;
  /** Prestación en BuscaTurno (match interno para el equipo). */
  tratamientoCatalogo: string;
  /** Doc Medexis del profesional matcheado (para Busca Turno). */
  profesionalDoc: string;
  /** Código de prestación matcheada (para Busca Turno). */
  prestacionCodigo: string;
  /** Modalidad pedida: presencial, virtual o indistinto. */
  modalidad: "" | "presencial" | "virtual" | "indistinto";
  pendiente: string;
  opciones: string[];
  horarios: string;
  hastaDia: number;
  busqueda: string;
  anularLuego: string;
  /** Ya mostramos el resumen de datos del pedido de turno. */
  pedidoIntro: boolean;
  pila: { paso: MenuPaso; opciones: string[] }[];
};

export type WaConversation = {
  id: string;
  contactId: string;
  status: WaConversationStatus;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  assigneeKind: "none" | "bot" | "user";
  assigneeUserId: string | null;
  assigneeName: string | null;
  tagIds: string[];
  /** Rastro corto de la charla, para el equipo y para el próximo mensaje. */
  resumen: string | null;
  /** Intención en curso. No es un saludo: la conversación puede seguir con otra. */
  intencionAbierta: string | null;
  intencionConcluida: boolean;
  /** Otra intención detectada mientras la abierta no está concluida. */
  intencionPropuesta: string | null;
  /** Trámites más largos, en orden, para seguir cuando se cierra el de ahora. */
  intencionCola?: string[];
  /** Veces seguidas que escribió algo que no es de INECO. A la segunda se deriva. */
  advertenciasFuera?: number;
  /** Un tema quedó para el equipo y el bot sigue si hay otra consulta. */
  derivacionPendiente?: boolean;
  /** Pedidos distintos aunque compartan la misma intención: dos turnos, dos tratamientos. */
  temasAnotados?: string[];
  casos?: WaCasoTurno[];
  casoActivoId?: string | null;
  datoPedido?: string | null;
  historialDatos?: WaEventoDato[];
  pilaTemas?: WaTemaPila[];
  ultimoResultado?: WaResultadoAccion | null;
  pausa?: WaPausaDialogo | null;
  /** Charla local, con número ficticio. No sale por WhatsApp. */
  prueba: boolean;
  /** ia: el bot con modelo. menu: el bot de opciones, sin modelo. */
  pruebaMotor?: "ia" | "menu";
  /** Paso del bot de opciones. */
  menuPaso?: string | null;
  /** Datos que el bot de opciones ya juntó, un campo por vez. */
  menuEstado?: MenuEstado | null;
  /** correctá o incorrecta, según la revisión de la prueba. */
  pruebaResultado: "correcta" | "incorrecta" | null;
  /** Resumen de las aclaraciones, para lecturas viejas. */
  pruebaNota: string | null;
  pruebaNotaEn: string | null;
  /** Aclaración por cada mensaje enviado a la IA que se marcó mal. */
    pruebaAclaraciones: WaPruebaAclaracion[];
  /** Quien abrió la prueba. */
  pruebaCreadorId?: string | null;
  pruebaCreadorNombre?: string | null;
  /** Una entrada por turno, para revisar qué detectó el bot. */
  auditoria: WaAuditoriaPaso[];
  createdAt: string;
  updatedAt: string;
  contact?: WaContact;
};

export type WaMessage = {
  id: string;
  conversationId: string;
  contactId: string;
  direction: WaMessageDirection;
  type: WaMessageType;
  text: string;
  externalMessageId: string | null;
  status: WaMessageStatus;
  mimeType: string | null;
  fileName: string | null;
  mediaPath: string | null;
  mediaUrl: string | null;
  isDeleted: boolean;
  createdAt: string;
};

export type WaStatusSnapshot = {
  status: WaConnectionStatus;
  qr?: string | null;
  phoneNumber?: string | null;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  error?: string | null;
};

export type NormalizedWaMessage = {
  externalId: string;
  peerPhone: string;
  pushName?: string;
  text: string;
  type: WaMessageType;
  direction: WaMessageDirection;
  timestamp: Date;
  isGroup: boolean;
  raw: unknown;
};
