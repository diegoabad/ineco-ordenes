import { fetchEmailConfig, fetchPresupuestoEmailConfig } from "../services/dataService";
import { isEmailAddress } from "./emails";

export type RemitenteMail = {
  email: string;
  nombre: string;
};

/** Remitentes fijos que la app usa además de la configuración. */
const REMITENTES_FIJOS: RemitenteMail[] = [
  { email: "recordatorio@ineco.ar", nombre: "Recordatorios" },
  { email: "sistemas@ineco.ar", nombre: "Sistemas" },
];

function sinAcento(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esMailIneco(email: string): boolean {
  const dominio = email.split("@")[1]?.toLowerCase() ?? "";
  return dominio === "ineco.ar" || dominio === "ineco.org.ar";
}

function agrupar(items: RemitenteMail[]): RemitenteMail[] {
  const porEmail = new Map<string, { email: string; nombres: string[] }>();
  for (const item of items) {
    const email = item.email.trim();
    if (!isEmailAddress(email) || !esMailIneco(email)) continue;
    const key = email.toLowerCase();
    const nombre = item.nombre.trim();
    const previo = porEmail.get(key);
    if (!previo) {
      porEmail.set(key, { email, nombres: nombre ? [nombre] : [] });
      continue;
    }
    if (nombre && !previo.nombres.some((n) => sinAcento(n) === sinAcento(nombre))) {
      previo.nombres.push(nombre);
    }
  }
  return [...porEmail.values()].map((item) => ({
    email: item.email,
    nombre: item.nombres.join(" · "),
  }));
}

function coincide(item: RemitenteMail, consulta: string): boolean {
  const local = sinAcento(item.email.split("@")[0] ?? "");
  const nombre = sinAcento(item.nombre);
  const palabras = nombre.split(/[^a-z0-9]+/).filter(Boolean);
  if (local.startsWith(consulta) || local.includes(consulta)) return true;
  if (palabras.some((palabra) => palabra.startsWith(consulta))) return true;
  if (consulta.length >= 4 && nombre.includes(consulta)) return true;
  if (consulta.includes("@") && sinAcento(item.email).startsWith(consulta)) return true;
  return false;
}

export function filtrarRemitentes(
  consulta: string,
  remitentes: RemitenteMail[],
  yaElegidos: string[],
): RemitenteMail[] {
  const q = sinAcento(consulta);
  if (q.length < 2) return [];
  const usados = new Set(yaElegidos.map((email) => email.toLowerCase()));
  return remitentes
    .filter((item) => !usados.has(item.email.toLowerCase()) && coincide(item, q))
    .slice(0, 8);
}

let carga: Promise<RemitenteMail[]> | null = null;

/** Remitentes configurados (órdenes y presupuestos) más los fijos de INECO. */
export function cargarRemitentes(): Promise<RemitenteMail[]> {
  if (!carga) {
    carga = Promise.all([
      fetchEmailConfig()
        .then((res) => res.data)
        .catch(() => null),
      fetchPresupuestoEmailConfig()
        .then((res) => res.data)
        .catch(() => null),
    ])
      .then(([orden, presupuesto]) => {
        const todos: RemitenteMail[] = [...REMITENTES_FIJOS];
        if (orden?.fromEmail?.trim()) {
          todos.push({
            email: orden.fromEmail.trim(),
            nombre: orden.fromName?.trim() || "Órdenes",
          });
        }
        if (presupuesto?.fromEmail?.trim()) {
          todos.push({
            email: presupuesto.fromEmail.trim(),
            nombre: presupuesto.fromName?.trim() || "Presupuestos",
          });
        }
        return agrupar(todos);
      })
      .catch((error) => {
        carga = null;
        throw error;
      });
  }
  return carga;
}
