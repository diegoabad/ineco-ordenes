type BuscaTurnoTab = "turnos" | "config";

type CatalogStatus = {
  cacheDot: string;
  cacheLabel: string;
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
};

declare function BuscaTurnoApp(props: Props): JSX.Element;
export default BuscaTurnoApp;
