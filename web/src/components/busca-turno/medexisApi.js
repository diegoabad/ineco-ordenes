// Cliente Medexis vía proxy de la API (secretos en servidor).
const base = "/api/medexis/api";

export const config = { base };

function medexisErrorMessage(data, status) {
  if (data && typeof data === "object") {
    const msg = data.Detalle || data.Mensaje || data.Message || data.message;
    if (msg) return String(msg);
  }
  return `HTTP ${status}`;
}

export async function apiPost(path, params, body = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${path}?${qs}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "include",
    // Medexis (como en totem) espera POST con JSON; body vacío suele romper.
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(medexisErrorMessage(data, res.status));
  }
  return data;
}

export function formatearFechaMedexis(fecha) {
  if (fecha instanceof Date) return fecha.toISOString().split("T")[0];
  if (typeof fecha === "string") {
    if (fecha.includes("/")) {
      const [dia, mes, año] = fecha.split("/");
      return `${año}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
    }
    return fecha;
  }
  return new Date().toISOString().split("T")[0];
}

export async function getPersona(documento) {
  const data = await apiPost("/Persona", {
    Documento: String(documento).trim(),
  });
  if (data?.Resultado === "ERROR") {
    const detalle = String(data.Detalle || "");
    // Paciente inexistente: devolver null (el modal ofrece alta manual).
    if (/no existe/i.test(detalle)) return null;
    throw new Error(detalle || "Error al buscar el paciente.");
  }
  return data;
}

export async function getTurnos(fecha, prestadorDocumento) {
  const fechaFormateada = formatearFechaMedexis(fecha);
  const prestadorStr = String(prestadorDocumento);
  const data = await apiPost("/Turno", {
    Fecha: fechaFormateada,
    PrestadorDocumento: prestadorStr,
  });
  return {
    success: true,
    data,
    fecha: fechaFormateada,
    prestadorDocumento: prestadorStr,
    timestamp: new Date().toISOString(),
  };
}

export async function createTurno(turnoBody) {
  const url = `${base}/TurnoNuevo`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(turnoBody),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.Detalle || `HTTP ${res.status}`);
  if (data.Resultado === "ERROR") {
    throw new Error(data.Detalle || data.Mensaje || "Error al crear el turno.");
  }
  return data;
}
