import type { TipoPrestacion } from "../types";
import { chipStyleForColor, colorForTipo } from "../lib/tipoPrestacion";

type Props = {
  nombre: string;
  tipos: TipoPrestacion[];
};

export function TipoPrestacionChip({ nombre, tipos }: Props) {
  if (!nombre) {
    return <span className="text-muted">—</span>;
  }

  const color = colorForTipo(tipos, nombre);
  return (
    <span className="chip chip--tipo" style={chipStyleForColor(color)}>
      {nombre}
    </span>
  );
}
