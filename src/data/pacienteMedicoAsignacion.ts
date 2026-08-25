/**
 * Asignación paciente → apellido del médico (planilla Ineco).
 * null = sin médico → usa el médico por defecto al imprimir.
 */
export const PACIENTE_MEDICO_REF: Record<string, string | null> = {
  "Lluch Joaquin": "Kes",
  "Garay Zavalia Julio": "Bamondez",
  "Cortes Hernan": "Bamondez",
  "Garnica Nicolas": "Bamondez",
  "Rodriguez Spehir Noelia": "Bamondez",
  "Dueri Valdivieso Yanina": "Bamondez",
  "Mey Joaquin": "Bamondez",
  "Argimon Mercedes": "Bamondez",
  "Matias Martinez": "Bamondez",
  "Couso Eliana": "Bamondez",
  "Fedele Fabrizio": "Bamondez",
  "Constanza Lara Videla": "Bamondez",
  "Dalmedo Lucas": "Cozzarin",
  "Tripichio Graciela": "Cozzarin",
  "Alvarez Jazmin": "Salmeron",
  "Bertuzzi Stefania": "Salmeron",
  "Gomez Maria Teresa": "Salmeron",
  "Gonzalez Quintana Sofia": "Salmeron",
  "Marasco Victor Manuel": "Salmeron",
  "Rowinski Costa Gabriela": "Garrido",
  "Gallo Carolina": "Garrido",
  "Garri Sebastian": "Garrido",
  "Di Liscia Marco": "Garrido",
  "Colla Juan Pablo": "Garrido",
  "Cicala Carolina": "Garrido",
  "Lucca De Guevara Santiago": "Garrido",
  "Fernandez Pellene Aron Daniel": "Garrido",
  "Andrada Maria Victoria": "Garrido",
  "Gomez Silvia Graciela": "Garrido",
  "Herrera Luz": "Garrido",
  "Perez Pablo Fernando": "Garrido",
  "Silva Abril": "Garrido",
  "Miretti Bautista": "Garrido",
  "Tonelli Carolina": "Acuña",
  "Arbo Mariano": "Acuña",
  "Fernandez Pellene Ivonne": "Acuña",
  "Pagliero Clara": "Acuña",
  "Chevallier Boutell Delfina": "Bea",
  "Pachilla Pablo": "Bea",
  "Pannucio Nicolas": "Bea",
  "Brandone Agustina": "Bea",
  "Ruffo Bruno": "Bea",
  "Pagliardini Federico": "Bea",
  "Bobbioni Veronica": "Bea",
  "Cattaneo Iliana": "Bea",
  "Donayre Zinovoy Diana": "Bea",
  "Vivona Valentina": "Bea",
  "Lopez Cristian": "Bea",
  "Almeida Huerta Maria Carolina": "Bea",
  "Guerra Anabel": "Bea",
  "Punzi Carla": "Yezzi",
  "Sanz Lidia": "Yezzi",
  "Broitman Joel": "Yezzi",
  "Szejman Berta": "Patrone",
  "Rial Maria Del Pilar": "Patrone",
  "Lejtman Hugo": "Patrone",
  "Landgrebe Elida Susana": "Patrone",
  "Repun Ernesto": "Patrone",
  "Nieto Marta Teresa": "Fernandez Boccazzi",
  "Molina Maria De Los Milagros Ramona": "Kim",
  "Santana Mirta Elena": "Kim",
  "Ordas Mirta": "Kim",
  "Solowieczyk Lara Jimena": "Thomson",
  "Pertile Paloma": "Thomson",
  "Freile Bain Juan Andres": "Thomson",
  "Di Liscia Mora": "Escobar",
  "Rodriguez Ricardo": "Couto",
  "Stolar Damian": null,
  "Diaco Karina": null,
  "Conde Ignacio Marcelo": null,
  "Defilpo Noemi": "Kim",
  "Morer Camila": null,
  "Benitez Lorena": null,
  "Rodriguez Gaspar": null,
  "Aguirre Julio Cesar": null,
};

export function normalizeNombreKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Busca la ref de médico en la planilla (tolerante a mayúsculas/espacios). */
export function lookupMedicoRef(pacienteNombre: string): string | null | undefined {
  const key = normalizeNombreKey(pacienteNombre);
  for (const [nombre, ref] of Object.entries(PACIENTE_MEDICO_REF)) {
    if (normalizeNombreKey(nombre) === key) return ref;
  }
  return undefined;
}

export function isSinMedicoRef(ref: string | null | undefined): boolean {
  if (ref == null) return true;
  const n = normalizeNombreKey(ref).replace(/\?+$/g, "").trim();
  return !n || n === "no tiene";
}
