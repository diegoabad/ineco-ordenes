type BuscaTurnoTab = "turnos" | "config";

type CatalogStatus = {
  cacheDot: string;
  cacheLabel: string;
};

type Props = {
  section?: BuscaTurnoTab;
  onRequestSection?: (tab: BuscaTurnoTab) => void;
  onCatalogStatus?: (status: CatalogStatus) => void;
};

declare function BuscaTurnoApp(props: Props): JSX.Element;
export default BuscaTurnoApp;
