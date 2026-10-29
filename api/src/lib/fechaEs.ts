/** Nombres fijos. El contenedor de la nube solo trae inglés, así que Intl no sirve. */

const DIAS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;
const DIAS_CORTOS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;
const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** 0 = domingo. Algoritmo de Sakamoto, sin usar el locale del sistema. */
function indiceDiaSemana(anio: number, mes: number, dia: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = anio;
  if (mes < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[mes - 1]! + dia) % 7;
}

export function nombreDiaSemana(anio: number, mes: number, dia: number): string {
  if (!anio || mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
  return DIAS_ES[indiceDiaSemana(anio, mes, dia)] ?? "";
}

export function nombreDiaSemanaCorto(anio: number, mes: number, dia: number): string {
  if (!anio || mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
  return DIAS_CORTOS_ES[indiceDiaSemana(anio, mes, dia)] ?? "";
}

export function nombreMes(mes: number): string {
  return MESES_ES[mes - 1] ?? "";
}

export function partesBuenosAires(fecha: Date): {
  anio: number;
  mes: number;
  dia: number;
  hora: string;
  minuto: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    parts.find((parte) => parte.type === tipo)?.value ?? "";
  let hora = valor("hour");
  if (hora === "24") hora = "00";
  return {
    anio: Number(valor("year")),
    mes: Number(valor("month")),
    dia: Number(valor("day")),
    hora: hora.padStart(2, "0"),
    minuto: valor("minute").padStart(2, "0"),
  };
}
