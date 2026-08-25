import type { PacienteFormData } from "../types";

/** Pacientes iniciales (planilla Ineco). Médico y diagnóstico se resuelven al generar el seed. */
export const PACIENTES_SEED: Omit<PacienteFormData, "medicoId" | "diagnostico">[] = [
  {
    paciente: "Lluch Joaquin",
    obraSocial: "Swiss Medical",
    afiliado: "8000060416365 02 1002",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Garay Zavalia Julio",
    obraSocial: "Swiss Medical",
    afiliado: "8000061467417 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Cortes Hernan",
    obraSocial: "Swiss Medical",
    afiliado: "8000061730641 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Garnica Nicolas",
    obraSocial: "Swiss Medical",
    afiliado: "8000061159132 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Rodriguez Spehir Noelia",
    obraSocial: "Swiss Medical",
    afiliado: "8000061878399 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Dueri Valdivieso Yanina",
    obraSocial: "Swiss Medical",
    afiliado: "8000061991434 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Mey Joaquin",
    obraSocial: "Swiss Medical",
    afiliado: "8000061991434 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Argimon Mercedes",
    obraSocial: "Swiss Medical",
    afiliado: "8000060333760 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Matias Martinez",
    obraSocial: "Swiss Medical",
    afiliado: "8000061936541 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Couso Eliana",
    obraSocial: "Swiss Medical",
    afiliado: "8000061912093 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Fedele Fabrizio",
    obraSocial: "Swiss Medical",
    afiliado: "8000061453353 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Constanza Lara Videla",
    obraSocial: "Swiss Medical",
    afiliado: "8000062133725 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Dalmedo Lucas",
    obraSocial: "Swiss Medical",
    afiliado: "8000067213506 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Tripichio Graciela",
    obraSocial: "Swiss Medical",
    afiliado: "8000061117427 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Alvarez Jazmin",
    obraSocial: "Swiss Medical",
    afiliado: "8000061610628 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Bertuzzi Stefania",
    obraSocial: "Swiss Medical",
    afiliado: "8000060175558 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Gomez Maria Teresa",
    obraSocial: "Swiss Medical",
    afiliado: "8000062160087 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Gonzalez Quintana Sofia",
    obraSocial: "Swiss Medical",
    afiliado: "8000061376363 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Marasco Victor Manuel",
    obraSocial: "Swiss Medical",
    afiliado: "8000060470102 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Rowinski Costa Gabriela",
    obraSocial: "Swiss Medical",
    afiliado: "8000060924457 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Gallo Carolina",
    obraSocial: "Swiss Medical",
    afiliado: "8000061884950 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Garri Sebastian",
    obraSocial: "Swiss Medical",
    afiliado: "8000062312693 01 1005",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Di Liscia Marco",
    obraSocial: "Swiss Medical",
    afiliado: "8000060533595 04 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Colla Juan Pablo",
    obraSocial: "Swiss Medical",
    afiliado: "8000062161061 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Cicala Carolina",
    obraSocial: "Swiss Medical",
    afiliado: "800006 0587372 01 1044",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Lucca De Guevara Santiago",
    obraSocial: "Swiss Medical",
    afiliado: "8000061623915 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Fernandez Pellene Aron Daniel",
    obraSocial: "Swiss Medical",
    afiliado: "8000061958278 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Andrada Maria Victoria",
    obraSocial: "Swiss Medical",
    afiliado: "8000061003313 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Gomez Silvia Graciela",
    obraSocial: "Swiss Medical",
    afiliado: "8000060216163 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Herrera Luz",
    obraSocial: "Swiss Medical",
    afiliado: "8000067278348 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Perez Pablo Fernando",
    obraSocial: "Swiss Medical",
    afiliado: "8000062029068 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Silva Abril",
    obraSocial: "Swiss Medical",
    afiliado: "8000060840063 03 1031",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Miretti Bautista",
    obraSocial: "Prevencion Salud",
    afiliado: "8323502053",
    prestacion: "SOLICITO PRI 8 Prestador: 189789",
  },
  {
    paciente: "Tonelli Carolina",
    obraSocial: "Swiss Medical",
    afiliado: "8000065001060 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Arbo Mariano",
    obraSocial: "Swiss Medical",
    afiliado: "8000067420307 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Fernandez Pellene Ivonne",
    obraSocial: "Swiss Medical",
    afiliado: "8000060471017 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Pagliero Clara",
    obraSocial: "Swiss Medical",
    afiliado: "800061385643 02 1000",
    prestacion:
      "Solicito Programa de rehabilitacion Severa Codigo: 29010630 Prestador:272152",
  },
  {
    paciente: "Chevallier Boutell Delfina",
    obraSocial: "Swiss Medical",
    afiliado: "8000061637804 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Pachilla Pablo",
    obraSocial: "Swiss Medical",
    afiliado: "8000061789326 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Pannucio Nicolas",
    obraSocial: "Swiss Medical",
    afiliado: "8000061806855 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Brandone Agustina",
    obraSocial: "Swiss Medical",
    afiliado: "8000060075168 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Ruffo Bruno",
    obraSocial: "Swiss Medical",
    afiliado: "8000061040351 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Pagliardini Federico",
    obraSocial: "Swiss Medical",
    afiliado: "8000060444835 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Bobbioni Veronica",
    obraSocial: "Swiss Medical",
    afiliado: "8000061666061 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Cattaneo Iliana",
    obraSocial: "Swiss Medical",
    afiliado: "8000061536940 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Donayre Zinovoy Diana",
    obraSocial: "Swiss Medical",
    afiliado: "8000062157990 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Vivona Valentina",
    obraSocial: "Swiss Medical",
    afiliado: "8000060107732 03 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Lopez Cristian",
    obraSocial: "Swiss Medical",
    afiliado: "8000060216163 03 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Almeida Huerta Maria Carolina",
    obraSocial: "Swiss Medical",
    afiliado: "8000062035939 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Guerra Anabel",
    obraSocial: "Swiss Medical",
    afiliado: "8000060533595 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Punzi Carla",
    obraSocial: "Swiss Medical",
    afiliado: "8000060049881 03 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Sanz Lidia",
    obraSocial: "Swiss Medical",
    afiliado: "8000067261504 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Broitman Joel",
    obraSocial: "Swiss Medical",
    afiliado: "8000061923451 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Szejman Berta",
    obraSocial: "Swiss Medical",
    afiliado: "8000060394821 01 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Rial Maria Del Pilar",
    obraSocial: "Swiss Medical",
    afiliado: "8000060771129 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Lejtman Hugo",
    obraSocial: "Swiss Medical",
    afiliado: "800006083551 501 1045",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Landgrebe Elida Susana",
    obraSocial: "Swiss Medical",
    afiliado: "8000060031929 02 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Repun Ernesto",
    obraSocial: "Swiss Medical",
    afiliado: "8000060152930 01 1083",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Nieto Marta Teresa",
    obraSocial: "Swiss Medical",
    afiliado: "8000060557972 00 0077",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Molina Maria De Los Milagros Ramona",
    obraSocial: "Swiss Medical",
    afiliado: "8000066007061 02 0077",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Santana Mirta Elena",
    obraSocial: "Swiss Medical",
    afiliado: "8000060713127 02 0052",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Ordas Mirta",
    obraSocial: "Swiss Medical",
    afiliado: "8000060309047 04 0021",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Solowieczyk Lara Jimena",
    obraSocial: "Swiss Medical",
    afiliado: "8000061967716 01 1018",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Pertile Paloma",
    obraSocial: "Swiss Medical",
    afiliado: "8000060197670 04 0040",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Freile Bain Juan Andres",
    obraSocial: "Swiss Medical",
    afiliado: "8000062144664 03 0007",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Di Liscia Mora",
    obraSocial: "Swiss Medical",
    afiliado: "8000060533595 03 0000",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Rodriguez Ricardo",
    obraSocial: "Swiss Medical",
    afiliado: "8000060837615 02 1049",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Stolar Damian",
    obraSocial: "Swiss Medical",
    afiliado: "8000061212057 01 1016",
    prestacion:
      "Solicito Programa de rehabilitacion Severa Codigo: 29010630 Prestador:272152",
  },
  {
    paciente: "Diaco Karina",
    obraSocial: "Swiss Medical",
    afiliado: "800006 2011075 01 0011",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Conde Ignacio Marcelo",
    obraSocial: "Swiss Medical",
    afiliado: "8000061263210 01 0007",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Defilpo Noemi",
    obraSocial: "Swiss Medical",
    afiliado: "8000063153891 01 0012",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Morer Camila",
    obraSocial: "Swiss Medical",
    afiliado: "8000060925960 02 1001",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Benitez Lorena",
    obraSocial: "Swiss Medical",
    afiliado: "8000061936541 01 1006",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Rodriguez Gaspar",
    obraSocial: "Swiss Medical",
    afiliado: "8000061719696 01 1009",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
  {
    paciente: "Aguirre Julio Cesar",
    obraSocial: "Swiss Medical",
    afiliado: "800006 3270355 01 0070",
    prestacion:
      "Solicito Programa de Rehabilitación Integral (leve) Codigo: 29010628 Prestador:  272152",
  },
];
