type BuscaTurnoTab = "turnos" | "config";

type CatalogStatus = {
  cacheDot: string;
  cacheLabel: string;
};

type Props = {
  section?: BuscaTurnoTab;
  onRequestSection?: (tab: BuscaTurnoTab) => void;
  onCatalogStatus?: (status: CatalogStatus) => void;
  /** Barra lateral angosta: solo búsqueda + resultados */
  mode?: "full" | "compact";
  /** true mientras hay un modal abierto (prestadores, asignar, etc.) */
  onUiLockChange?: (locked: boolean) => void;
};

declare function BuscaTurnoApp(props: Props): JSX.Element;
export default BuscaTurnoApp;
