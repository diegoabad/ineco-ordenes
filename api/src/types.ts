export type Paciente = {
  id: string;
  paciente: string;
  email: string;
  obraSocial: string;
  afiliado: string;
  prestacion: string;
  diagnostico: string;
  medicoId: string | null;
  activo: boolean;
  /** ISO 8601; registros nuevos primero en tablas. */
  creadoAt?: string;
};

export type Medico = {
  id: string;
  nombre: string;
  especialidad: string;
  matricula: string;
  firmaUrl: string | null;
  activo: boolean;
  creadoAt?: string;
};

export type EmailEnvioStatus = "ok" | "error";

export type EmailEnvio = {
  id: string;
  pacienteId: string;
  pacienteNombre: string;
  toEmail: string;
  medicoId: string | null;
  medicoNombre: string;
  fechaOrden: string;
  filename: string;
  /** URL pública del PDF adjunto guardado (éxito o fallo). */
  pdfUrl: string | null;
  subject: string;
  status: EmailEnvioStatus;
  errorMessage: string | null;
  enviadoAt: string;
};

export type EmailEnvioInput = Omit<EmailEnvio, "id">;

/** Prestación del módulo presupuestos (varios precios de pago). */
export type Prestacion = {
  id: string;
  titulo: string;
  descripcion: string;
  /** Ej. Evaluación, Tratamiento (valores de config presupuestos). */
  tipo: string;
  /** Duración estimada en minutos (0 = sin cargar). */
  duracionMinutos: number;
  /** Precio efectivo / transferencia (mismo valor). */
  precioEfectivo: number;
  precio3Cuotas: number;
  creadoAt?: string;
};

export type TipoPrestacion = {
  nombre: string;
  /** Color hex (#rrggbb) para chips en la UI. */
  color: string;
};

export type PresupuestosConfig = {
  tiposPrestacion: TipoPrestacion[];
  profesionales: ProfesionalPresupuesto[];
  modalidades: ModalidadPresupuesto[];
  motivosRechazo: MotivoRechazoPresupuesto[];
};

export type MotivoRechazoPresupuesto = {
  id: string;
  label: string;
};

export type ProfesionalPresupuesto = {
  id: string;
  titulo: string;
  nombreApellido: string;
};

export type ModalidadPresupuesto = {
  id: string;
  titulo: string;
  textoPdf: string;
};

export const DEFAULT_MODALIDADES_PRESUPUESTO: ModalidadPresupuesto[] = [
  {
    id: "presencial",
    titulo: "Presencial",
    textoPdf: "INECO - Marcelo T. de Alvear 1632, CABA",
  },
  {
    id: "virtual",
    titulo: "Virtual",
    textoPdf: "modalidad virtual",
  },
];

export const TIPO_COLOR_PALETTE = [
  "#2563eb",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#db2777",
  "#4f46e5",
] as const;

export type PresupuestoEstado = "pendiente" | "enviado" | "aceptado" | "rechazado" | "fallido";

export type PresupuestoItem = {
  prestacionId: string;
  titulo: string;
  descripcion: string;
  tipo: string;
  duracionMinutos: number;
  precioEfectivo: number;
  precio3Cuotas: number;
};

export type Presupuesto = {
  id: string;
  fecha: string;
  nombrePaciente: string;
  profesional: string;
  modalidadId: string;
  modalidadTitulo: string;
  modalidadTextoPdf: string;
  email: string;
  items: PresupuestoItem[];
  totalEfectivo: number;
  total3Cuotas: number;
  estado: PresupuestoEstado;
  pdfUrl: string | null;
  /** Motivo elegido o escrito al marcar como rechazado. */
  motivoRechazo: string | null;
  /** ISO del último intento de envío (éxito o fallo). */
  ultimoEnvioAt: string | null;
  /** Preferencia Checkout Pro de Mercado Pago. */
  mpPreferenceId: string | null;
  /** Link de pago (init_point) de Mercado Pago. */
  mpInitPoint: string | null;
  /** ISO del último envío del mail con link de pago. */
  linkPagoEnviadoAt: string | null;
  creadoAt?: string;
};

export type PresupuestoCreateInput = {
  nombrePaciente: string;
  profesional: string;
  modalidadId: string;
  email: string;
  prestacionIds: string[];
  pdfBase64?: string;
  enviar?: boolean;
};

export type PresupuestoUpdateInput = PresupuestoCreateInput;

export const DEFAULT_TIPOS_PRESTACION: TipoPrestacion[] = [
  { nombre: "Evaluación", color: TIPO_COLOR_PALETTE[0]! },
  { nombre: "Tratamiento", color: TIPO_COLOR_PALETTE[1]! },
];

export type AppDb = {
  version: number;
  medicoSeleccionadoId: string | null;
  medicos: Medico[];
  pacientes: Paciente[];
};

/** Alta/edición: el flag activo se gestiona aparte. */
export type PacienteInput = Omit<Paciente, "id" | "activo" | "creadoAt">;
export type MedicoInput = Omit<Medico, "id" | "firmaUrl" | "activo" | "creadoAt">;
export type PrestacionInput = Omit<Prestacion, "id" | "creadoAt">;

/** Análisis mensual PAMI (cruce Presentación INECO × Débitos). */
export type PamiAnalisisResumen = {
  coincidentes: number;
  prestacionesObservadas: number;
  opsPresentadas: number;
  afiliadosUnicosObservados: number;
  soloEnPresentacion: number;
  soloEnDebitos: number;
  conteoModulo: Record<string, number>;
  conteoPrestacion: Record<string, number>;
  concentracion125: {
    afiliados: number;
    totalPrestaciones: number;
    conMasDeUna: number;
  };
  motivoDominante: string | null;
  motivoDominanteCantidad: number;
};

export type PamiAnalisis = {
  id: string;
  /** YYYY-MM */
  mes: string;
  mesLabel: string;
  presentacionFileName: string;
  debitosFileName: string;
  presentacionUrl: string | null;
  debitosUrl: string | null;
  pdfUrl: string | null;
  resumen: PamiAnalisisResumen;
  /** Resultado completo del cruce (JSON serializable). */
  resultado: Record<string, unknown>;
  creadoAt?: string;
};

export type PamiAnalisisCreateInput = {
  mes: string;
  presentacionFileName: string;
  debitosFileName: string;
  /** base64 del .xlsx Presentación */
  presentacionBase64: string;
  /** base64 del .xlsx Débitos */
  debitosBase64: string;
  /** base64 del PDF generado */
  pdfBase64: string;
  resumen: PamiAnalisisResumen;
  resultado: Record<string, unknown>;
};

/** Módulos / pantallas de la app. */
export type AppModuleId =
  | "inicio"
  | "ordenes"
  | "presupuestos"
  | "pami"
  | "busca-turno"
  | "whatsapp"
  | "pedidos-sistema"
  | "usuarios";

export const ALL_APP_MODULES: AppModuleId[] = [
  "inicio",
  "ordenes",
  "presupuestos",
  "pami",
  "busca-turno",
  "whatsapp",
  "pedidos-sistema",
  "usuarios",
];

export type PedidoSistemaSeccion =
  | "ordenes"
  | "presupuestos"
  | "pami"
  | "busca-turno"
  | "whatsapp"
  | "nueva";

export type PedidoSistemaPrioridad = "baja" | "media" | "alta";
export type PedidoSistemaEstado = "pendiente" | "en_proceso" | "finalizado";

export type PedidoSistemaFoto = {
  url: string;
  nombre: string;
};

export type PedidoSistema = {
  id: string;
  seccion: PedidoSistemaSeccion;
  seccionNueva: string;
  titulo: string;
  detalle: string;
  cuando: string;
  solicitadoPor: string;
  prioridad: PedidoSistemaPrioridad;
  estado: PedidoSistemaEstado;
  fotos: PedidoSistemaFoto[];
  creadoPorUserId: string | null;
  creadoPorEmail: string | null;
  creadoAt: string;
  actualizadoAt: string;
};

export type PedidoSistemaFotoInput = {
  base64: string;
  nombre: string;
  mime?: string;
};

export type PedidoSistemaCreateInput = {
  seccion: PedidoSistemaSeccion;
  seccionNueva?: string;
  titulo: string;
  detalle: string;
  cuando?: string;
  solicitadoPor: string;
  prioridad?: PedidoSistemaPrioridad;
  fotos?: PedidoSistemaFotoInput[];
};

export type PedidoSistemaUpdateInput = {
  prioridad?: PedidoSistemaPrioridad;
  estado?: PedidoSistemaEstado;
  titulo?: string;
  detalle?: string;
  cuando?: string;
};

/** Items personales de la pantalla Inicio. */
export type InicioItemTipo = "tarea" | "nota" | "recordatorio";

/** Frecuencia de repetición de un recordatorio. */
export type InicioRecurrencia = "none" | "semanal" | "mensual" | "cada_n_dias";

export type InicioNotaColor =
  | "gris"
  | "amarillo"
  | "verde"
  | "azul"
  | "rosa"
  | "naranja";

export const INICIO_NOTA_COLORES: InicioNotaColor[] = [
  "gris",
  "amarillo",
  "verde",
  "azul",
  "rosa",
  "naranja",
];

/** Usuario referenciado en asignación / compartido (denormalizado para UI). */
export type InicioUserRef = {
  id: string;
  nombre: string;
  email: string;
};

export type InicioItem = {
  id: string;
  tipo: InicioItemTipo;
  titulo: string;
  detalle: string;
  /** ISO datetime (recordatorios; opcional en tareas). */
  fechaHora: string | null;
  hecha: boolean;
  /** Orden de visualización (menor = primero). */
  orden: number;
  /** Color del papel (notas). */
  color: InicioNotaColor;
  /** Aviso en la aplicación (recordatorios). */
  avisoApp: boolean;
  /** Aviso por mail (recordatorios). */
  avisoEmail: boolean;
  /** Cuándo se envió el mail de aviso (anti-duplicado). */
  emailEnviadoAt: string | null;
  /** Repetición del recordatorio (solo tipo recordatorio). */
  recurrencia: InicioRecurrencia;
  /** Cada cuántos días (solo si recurrencia = cada_n_dias). */
  intervaloDias: number | null;
  /** Nota fijada al frente. */
  pinned: boolean;
  /** Id de la tarea de origen (si el recordatorio se creó desde una tarea). */
  origenTareaId: string | null;
  /**
   * Usuarios con acceso (incluye al dueño). Indexable con array-contains.
   * En tareas = asignados + dueño; en notas = compartidos + dueño.
   */
  participantIds: string[];
  /** Otros usuarios (sin el dueño) para chips/UI. */
  sharedWith: InicioUserRef[];
  /** Nombre del dueño (denormalizado). */
  ownerNombre: string;
  userId: string;
  creadoAt: string;
  actualizadoAt: string;
};

export type InicioItemCreateInput = {
  tipo: InicioItemTipo;
  titulo: string;
  detalle?: string;
  fechaHora?: string | null;
  color?: InicioNotaColor;
  avisoApp?: boolean;
  avisoEmail?: boolean;
  recurrencia?: InicioRecurrencia;
  intervaloDias?: number | null;
  pinned?: boolean;
  origenTareaId?: string | null;
  /** Ids de usuarios a asignar/compartir (sin el dueño). */
  sharedWithIds?: string[];
};

export type InicioItemUpdateInput = {
  titulo?: string;
  detalle?: string;
  fechaHora?: string | null;
  hecha?: boolean;
  color?: InicioNotaColor;
  avisoApp?: boolean;
  avisoEmail?: boolean;
  emailEnviadoAt?: string | null;
  recurrencia?: InicioRecurrencia;
  intervaloDias?: number | null;
  pinned?: boolean;
  sharedWithIds?: string[];
};

export type InicioItemReorderInput = {
  tipo: InicioItemTipo;
  ids: string[];
};

export type UserRole = "user" | "admin";
export type UserStatus = "pending" | "approved" | "rejected";

export type AppUser = {
  id: string;
  email: string;
  nombre: string;
  passwordHash: string;
  role: UserRole;
  modules: AppModuleId[];
  status: UserStatus;
  creadoAt: string;
  actualizadoAt: string;
  aprobadoAt?: string | null;
  rechazadoAt?: string | null;
};

/** Usuario sin hash de contraseña (respuestas API). */
export type AppUserPublic = Omit<AppUser, "passwordHash">;

/** Entrada liviana para pickers de asignación/compartir. */
export type UserDirectoryEntry = {
  id: string;
  nombre: string;
  email: string;
};

export type ApproveUserInput = {
  role: UserRole;
  modules: AppModuleId[];
};

/** Catálogo + flags del módulo Busca turno (compartido en Firestore). */
export type BuscaTurnoProfesional = {
  doc: string;
  nombre: string;
  sede: string;
  enabled: boolean;
};

export type BuscaTurnoPrestacionProf = {
  doc: string;
  nombre: string;
  sede: string;
};

export type BuscaTurnoPrestacion = {
  nombre: string;
  duracion: number;
  enabled: boolean;
  profesionales: BuscaTurnoPrestacionProf[];
};

export type BuscaTurnoConfig = {
  version: 2;
  updatedAt: string;
  updatedBy?: string | null;
  sedesCarga: string[];
  profesionales: BuscaTurnoProfesional[];
  prestaciones: Record<string, BuscaTurnoPrestacion>;
};

