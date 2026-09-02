import { apiFetch } from "../../config/api";

/** null si aún no hay config en Firebase. */
export async function fetchBuscaTurnoConfig() {
  const res = await apiFetch("/api/busca-turno/config");
  return res.data ?? null;
}

export async function saveBuscaTurnoConfig(payload) {
  const res = await apiFetch("/api/busca-turno/config", {
    method: "PUT",
    body: JSON.stringify({
      version: 2,
      sedesCarga: payload.sedesCarga?.length ? payload.sedesCarga : ["INECO"],
      profesionales: payload.profesionales,
      prestaciones: payload.prestaciones,
    }),
  });
  return res.data;
}
