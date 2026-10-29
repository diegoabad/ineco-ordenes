type BuscaTurnoTab = "turnos" | "config";

type CatalogStatus = {
  cacheDot: string;
  cacheLabel: string;
};

type PedidoPacienteSeed = {
  dni?: string;
  fechaNacimiento?: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  telefono?: string;
  sexo?: "" | "masculino" | "femenino";
};

type PedidoSeed = {
  key: string;
  prestacionCodigo?: string;
  prestacionNombre?: string;
  /** Motivo / texto libre del paciente para rematch en catálogo del dr. */
  tratamiento?: string;
  profesionalDoc?: string;
  profesionalNombre?: string;
  modalidad?: "" | "presencial" | "virtual" | "indistinto";
  /** Datos del contacto/pedido WA para prellenar al asignar turno. */
  paciente?: PedidoPacienteSeed | null;
};

type Props = {
  section?: BuscaTurnoTab;
  onRequestSection?: (tab: BuscaTurnoTab) => void;
  onCatalogStatus?: (status: CatalogStatus) => void;
  /** Barra lateral angosta: solo búsqueda + resultados */
  mode?: "full" | "compact";
  /** true mientras hay un modal abierto (prestadores, asignar, etc.) */
  onUiLockChange?: (locked: boolean) => void;
  /** Prefill desde pedido de turno del bot WhatsApp. */
  pedidoSeed?: PedidoSeed | null;
  /** Al limpiar búsqueda: avisar al padre para soltar el seed. */
  onPedidoSeedClear?: () => void;
  /** Si true, oculta turnos ocupados en la grilla. */
  soloLibres?: boolean;
  onSoloLibresChange?: (soloLibres: boolean) => void;
  /** CRM: texto con turnos libres elegidos → borrador WhatsApp. */
  onProponerTurnosLibres?: (texto: string) => void;
  /** CRM: se disparó tras asignar un turno con éxito. */
  onTurnoAsignado?: () => void;
};

declare function BuscaTurnoApp(props: Props): JSX.Element;
export default BuscaTurnoApp;
