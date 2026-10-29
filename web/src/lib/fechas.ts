/** Utilidades de fechas en formato YYYY-MM-DD (sin zona horaria). */

export function toYmd(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) {
    return null;
  }
  return date;
}

export function compareYmd(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function diasEnMes(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function fechaHoyIso(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .split("T")[0]!;
}

const DIAS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

/** 0 = domingo. Misma cuenta que el servidor: no usa el idioma del navegador. */
function indiceDiaSemana(anio: number, mes: number, dia: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = anio;
  if (mes < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[mes - 1]! + dia) % 7;
}

export function indiceDiaSemanaYmd(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (!anio || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return indiceDiaSemana(anio, mes, dia);
}

export function nombreDiaSemana(ymd: string): string {
  const indice = indiceDiaSemanaYmd(ymd);
  if (indice == null) return "";
  return DIAS_ES[indice] ?? "";
}

export function formatFechaYmd(ymd: string): string {
  // Acepta YYYY-MM-DD o ISO con hora; siempre muestra dd/mm/aaaa.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return ymd;
  const day = m[3]!;
  const month = m[2]!;
  const year = m[1]!;
  return `${day}/${month}/${year}`;
}

/** Día de la semana en español más dd/mm/aaaa. */
export function formatFechaConDia(ymd: string): string {
  const fecha = formatFechaYmd(ymd);
  const dia = nombreDiaSemana(ymd);
  return dia ? `${dia} ${fecha}` : fecha;
}

/** Formatea un ISO datetime a dd/mm/yyyy hh:mm (hora local). */
export function formatFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

export interface CeldaCalendario {
  iso: string | null;
  day: number | null;
  fueraMes: boolean;
}

export function celdasMesCalendario(year: number, monthIndex: number): CeldaCalendario[] {
  const primerDia = new Date(year, monthIndex, 1);
  const inicioSemana = (primerDia.getDay() + 6) % 7;
  const totalDias = diasEnMes(year, monthIndex);
  const celdas: CeldaCalendario[] = [];

  const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
  const prevYear = monthIndex === 0 ? year - 1 : year;
  const diasMesAnterior = diasEnMes(prevYear, prevMonth);

  for (let i = inicioSemana - 1; i >= 0; i--) {
    const day = diasMesAnterior - i;
    celdas.push({
      iso: toYmd(prevYear, prevMonth, day),
      day,
      fueraMes: true,
    });
  }

  for (let day = 1; day <= totalDias; day++) {
    celdas.push({
      iso: toYmd(year, monthIndex, day),
      day,
      fueraMes: false,
    });
  }

  const nextMonth = monthIndex === 11 ? 0 : monthIndex + 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  let day = 1;
  while (celdas.length % 7 !== 0) {
    celdas.push({
      iso: toYmd(nextYear, nextMonth, day),
      day,
      fueraMes: true,
    });
    day++;
  }

  return celdas;
}

export function formatFechaInputLive(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseFechaDdMmAaaa(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || year < 1000 || year > 9999) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return toYmd(year, month - 1, day);
}

export function rangoAniosCalendario(
  min?: string,
  max?: string,
): { minYear: number; maxYear: number } {
  const yHoy = new Date().getFullYear();
  let minYear = 1950;
  let maxYear = yHoy + 10;
  if (min) {
    const p = parseYmd(min);
    if (p) minYear = p.getFullYear();
  }
  if (max) {
    const p = parseYmd(max);
    if (p) maxYear = p.getFullYear();
  }
  if (!min) minYear = Math.min(minYear, 1950);
  if (!max) maxYear = Math.max(maxYear, yHoy);
  if (minYear > maxYear) return { minYear: maxYear, maxYear: minYear };
  return { minYear, maxYear };
}
