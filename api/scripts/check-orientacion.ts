import {
  noSabeTratamiento,
  sinPreferenciaProfesional,
  eligeBuscarOrientacion,
  eligeDerivacionOrientacion,
  TEXTO_ORIENTACION_TURNO,
  preguntaDeResultado,
} from "../src/whatsapp/acciones.js";
import { datoPedidoDePregunta, datoTieneForma } from "../src/whatsapp/bot-turn.js";

const checks: [string, boolean][] = [
  ["noSabe tratamiento claro", noSabeTratamiento("No sé qué tratamiento me corresponde")],
  ["noSabe bien", noSabeTratamiento("No sé bien qué tratamiento necesito")],
  ["sinPref cualquiera", sinPreferenciaProfesional("No, cualquiera está bien")],
  ["sinPref no conozco", sinPreferenciaProfesional("no conozco ninguno")],
  ["elige 2", eligeDerivacionOrientacion("2")],
  ["elige equipo", eligeDerivacionOrientacion("hablar con alguien del equipo")],
  ["elige 1", eligeBuscarOrientacion("1")],
  ["elige buscar", eligeBuscarOrientacion("seguir buscando")],
  ["datoTiene orientacion 1", datoTieneForma("orientacionTurno", "1")],
  ["datoTiene orientacion 2", datoTieneForma("orientacionTurno", "2")],
  [
    "dato orientacion",
    datoPedidoDePregunta(preguntaDeResultado(TEXTO_ORIENTACION_TURNO), TEXTO_ORIENTACION_TURNO) ===
      "orientacionTurno",
  ],
  [
    "preg orientacion",
    /prefer/i.test(preguntaDeResultado(TEXTO_ORIENTACION_TURNO)),
  ],
  ["para vos pregunta → consultaPara", datoPedidoDePregunta("¿La consulta es para vos o para otra persona?") === "consultaPara"],
  ["edad pregunta → grupoEtario", datoPedidoDePregunta("¿Qué edad tiene? (si es niño o adulto también sirve)") === "grupoEtario"],
];

let fails = 0;
for (const [name, ok] of checks) {
  console.log(ok ? "OK" : "FAIL", name);
  if (!ok) fails += 1;
}
console.log("---");
console.log("pregunta:", preguntaDeResultado(TEXTO_ORIENTACION_TURNO));
console.log(
  "dato:",
  datoPedidoDePregunta(preguntaDeResultado(TEXTO_ORIENTACION_TURNO), TEXTO_ORIENTACION_TURNO),
);
process.exit(fails ? 1 : 0);
