export type PresupuestoPlantillaConfig = {
  body: string;
};

export const DEFAULT_PRESUPUESTO_PLANTILLA_BODY =
  `<div>Estimado/a {{nombrePaciente}},</div>` +
  `<br>` +
  `<div>Por medio de la presente se describe el módulo de evaluación según indicación de {{nombreProfesional}}.</div>` +
  `<br>` +
  `<div>El esquema del tratamiento podrá ser modificado de acuerdo a la evolución y a los objetivos planteados en cada etapa. Todas las evaluaciones que se detallan a continuación se realizan en <b>{{lugarEvaluacion}}</b>.</div>` +
  `<br>` +
  `<div>{{listaPrestaciones}}</div>` +
  `<br>` +
  `<div class="rich-align-center rich-size-lg"><b>COSTO TOTAL</b></div>` +
  `<br>` +
  `<div><b>{{total3Cuotas}}</b> (Mercado Pago en hasta 3 cuotas sin interés)</div>` +
  `<br>` +
  `<div><b>{{totalEfectivo}}</b> (Efectivo o transferencia bancaria)</div>` +
  `<br>` +
  `<div class="rich-align-center rich-size-lg"><b>MEDIOS DE PAGO</b></div>` +
  `<br>` +
  `<div><b>• Mercado Pago:</b> Se puede abonar en una sola cuota o en 3 cuotas sin interés. Para utilizar esta última opción, deberá solicitarnos un link de pago.</div>` +
  `<br>` +
  `<div><b>• Efectivo o transferencia bancaria:</b> el pago puede realizarse en efectivo en nuestra institución o mediante transferencia bancaria.</div>` +
  `<br>` +
  `<div>En este último caso, deberá enviarse el comprobante correspondiente con los siguientes datos:</div>` +
  `<br>` +
  `<div><b>Razón Social:</b> Centro de Psicología Médica San Martín de Tours SRL<br>` +
  `<b>CUIT:</b> 33-70934088-9<br>` +
  `<b>Banco:</b> Galicia<br>` +
  `<b>Cuenta corriente en pesos N°:</b> 0004041-7 680-7<br>` +
  `<b>CBU:</b> 0070680920000004041779</div>` +
  `<br>` +
  `<div class="rich-size-sm"><ul>` +
  `<li>Validez del Presupuesto: <b>15 días</b> a partir de la fecha de recepción.</li>` +
  `<li>El pago se deberá efectuar previo al comienzo del Módulo de Evaluación.</li>` +
  `<li>El presupuesto podrá sufrir variaciones si fueran necesarias consultas o evaluaciones inicialmente no planificadas al momento de la admisión.</li>` +
  `<li>El paciente o familia se compromete a efectuar los pagos según los términos acordados por los servicios prestados.</li>` +
  `<li>La cancelación de los turnos previamente asignados debe realizarse con 48 hs de anticipación, para facilitar la reasignación del horario a otros pacientes. En caso contrario, para la reprogramación del turno se deberá abonar un importe adicional correspondiente al 20% de la Evaluación cancelada.</li>` +
  `</ul></div>`;

export const DEFAULT_PRESUPUESTO_PLANTILLA_CONFIG: PresupuestoPlantillaConfig = {
  body: DEFAULT_PRESUPUESTO_PLANTILLA_BODY,
};

export const PRESUPUESTO_PLANTILLA_VARS = [
  "nombrePaciente",
  "email",
  "nombreProfesional",
  "modalidadTitulo",
  "lugarEvaluacion",
  "fechaPresupuesto",
  "totalEfectivo",
  "total3Cuotas",
  "cantidadPrestaciones",
  "listaPrestaciones",
] as const;

export type PresupuestoPlantillaVar = (typeof PRESUPUESTO_PLANTILLA_VARS)[number];

const TEMPLATE_VAR_ALIASES: Record<string, PresupuestoPlantillaVar> = {
  nombre: "nombrePaciente",
  fecha: "fechaPresupuesto",
  profesional: "nombreProfesional",
  modalidad: "modalidadTitulo",
  lugar: "lugarEvaluacion",
  modalidadTexto: "lugarEvaluacion",
};

export function applyPresupuestoPlantilla(
  template: string,
  vars: Partial<Record<PresupuestoPlantillaVar, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = (TEMPLATE_VAR_ALIASES[key] ?? key) as PresupuestoPlantillaVar;
    const value = vars[resolved];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

const LEGACY_DIRECCION_FIJA = "INECO - Marcelo T. de Alvear 1632, CABA";

function migratePlantillaBodyLugar(body: string): string {
  if (!body.includes(LEGACY_DIRECCION_FIJA)) return body;
  if (body.includes("{{lugarEvaluacion}}") || body.includes("{{lugar}}")) return body;
  return body
    .replace(
      /<b>\s*INECO\s*-\s*Marcelo T\.\s*de Alvear 1632,\s*CABA\.?\s*<\/b>/gi,
      "<b>{{lugarEvaluacion}}</b>",
    )
    .replace(
      /INECO\s*-\s*Marcelo T\.\s*de Alvear 1632,\s*CABA\.?/gi,
      "{{lugarEvaluacion}}",
    );
}

export function presupuestoPlantillaConfigWithDefaults(
  stored: Partial<PresupuestoPlantillaConfig> | null,
): PresupuestoPlantillaConfig {
  const storedBody = stored?.body?.trim() || "";
  return {
    body: migratePlantillaBodyLugar(storedBody || DEFAULT_PRESUPUESTO_PLANTILLA_CONFIG.body),
  };
}
