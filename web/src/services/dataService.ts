import { apiFetch } from "../config/api";
import type { EmailConfig } from "../types/email";
import type { PresupuestoEmailConfig } from "../types/presupuestoEmail";
import type { PresupuestoPlantillaConfig } from "../types/presupuestoPlantilla";
import type {
  EmailEnvio,
  Medico,
  MedicoFormData,
  Paciente,
  PacienteFormData,
  PedidoSistema,
  PedidoSistemaCreateInput,
  PedidoSistemaEstado,
  PedidoSistemaPrioridad,
  Prestacion,
  PrestacionFormData,
  Presupuesto,
  PresupuestoFormData,
  PresupuestosConfig,
} from "../types";
import type { PamiAnalisisGuardado, PamiAnalisisResumen } from "../types/pami";
import type { PamiAnalisisResult } from "../lib/pami";

type AppDb = {
  version: number;
  medicoSeleccionadoId: string | null;
  medicos: Medico[];
  pacientes: Paciente[];
};

export async function fetchDb(): Promise<AppDb> {
  const res = await apiFetch<{ ok: boolean; data: AppDb }>("/api/db");
  return res.data;
}

export async function saveMedicoSeleccionadoId(medicoSeleccionadoId: string | null): Promise<void> {
  await apiFetch("/api/config/medico-seleccionado", {
    method: "PUT",
    body: JSON.stringify({ medicoSeleccionadoId }),
  });
}

export async function fetchEmailConfig(): Promise<{
  data: EmailConfig;
  variables: string[];
}> {
  const res = await apiFetch<{ ok: boolean; data: EmailConfig; variables: string[] }>(
    "/api/config/email",
  );
  return { data: res.data, variables: res.variables };
}

export async function saveEmailConfig(data: EmailConfig): Promise<EmailConfig> {
  const res = await apiFetch<{ ok: boolean; data: EmailConfig }>("/api/config/email", {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchPresupuestoEmailConfig(): Promise<{
  data: PresupuestoEmailConfig;
  variables: string[];
}> {
  const res = await apiFetch<{
    ok: boolean;
    data: PresupuestoEmailConfig;
    variables: string[];
  }>("/api/config/presupuesto-email");
  return { data: res.data, variables: res.variables };
}

export async function savePresupuestoEmailConfig(
  data: PresupuestoEmailConfig,
): Promise<PresupuestoEmailConfig> {
  const res = await apiFetch<{ ok: boolean; data: PresupuestoEmailConfig }>(
    "/api/config/presupuesto-email",
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
  return res.data;
}

export async function fetchPresupuestoPlantillaConfig(): Promise<{
  data: PresupuestoPlantillaConfig;
  variables: string[];
}> {
  const res = await apiFetch<{
    ok: boolean;
    data: PresupuestoPlantillaConfig;
    variables: string[];
  }>("/api/presupuestos/plantilla");
  return { data: res.data, variables: res.variables };
}

export async function savePresupuestoPlantillaConfig(
  data: PresupuestoPlantillaConfig,
): Promise<PresupuestoPlantillaConfig> {
  const res = await apiFetch<{ ok: boolean; data: PresupuestoPlantillaConfig }>(
    "/api/presupuestos/plantilla",
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
  return res.data;
}

export async function enviarOrdenEmail(input: {
  pacienteId: string;
  pdfBase64: string;
  filename?: string;
  fecha?: string;
  medicoNombre?: string;
  subject?: string;
  body?: string;
}): Promise<{ to: string; envioId: string }> {
  const res = await apiFetch<{ ok: boolean; data: { to: string; envioId: string } }>(
    `/api/pacientes/${input.pacienteId}/enviar-orden`,
    {
      method: "POST",
      body: JSON.stringify({
        pdfBase64: input.pdfBase64,
        filename: input.filename,
        fecha: input.fecha,
        medicoNombre: input.medicoNombre,
        subject: input.subject,
        body: input.body,
      }),
    },
  );
  return res.data;
}

export type FetchEmailEnviosParams = {
  page?: number;
  pageSize?: number;
  /** YYYY-MM o vacío = todos */
  mes?: string;
  q?: string;
};

export type FetchEmailEnviosResult = {
  data: EmailEnvio[];
  total: number;
  page: number;
  pageSize: number;
};

export async function fetchEmailEnvios(
  params: FetchEmailEnviosParams = {},
): Promise<FetchEmailEnviosResult> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.mes) qs.set("mes", params.mes);
  if (params.q?.trim()) qs.set("q", params.q.trim());
  const query = qs.toString();
  const res = await apiFetch<{ ok: boolean } & FetchEmailEnviosResult>(
    `/api/email-envios${query ? `?${query}` : ""}`,
  );
  return {
    data: res.data,
    total: res.total,
    page: res.page,
    pageSize: res.pageSize,
  };
}

export async function deleteEmailEnvio(id: string): Promise<void> {
  await apiFetch(`/api/email-envios/${id}`, { method: "DELETE" });
}

export async function createPaciente(data: PacienteFormData): Promise<Paciente> {
  const res = await apiFetch<{ ok: boolean; data: Paciente }>("/api/pacientes", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updatePaciente(id: string, data: PacienteFormData): Promise<Paciente> {
  const res = await apiFetch<{ ok: boolean; data: Paciente }>(`/api/pacientes/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function setPacienteActivo(id: string, activo: boolean): Promise<Paciente> {
  const res = await apiFetch<{ ok: boolean; data: Paciente }>(`/api/pacientes/${id}/activo`, {
    method: "PATCH",
    body: JSON.stringify({ activo }),
  });
  return res.data;
}

export async function createMedico(data: MedicoFormData): Promise<Medico> {
  const res = await apiFetch<{ ok: boolean; data: Medico }>("/api/medicos", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateMedico(id: string, data: MedicoFormData): Promise<Medico> {
  const res = await apiFetch<{ ok: boolean; data: Medico }>(`/api/medicos/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function setMedicoActivo(
  id: string,
  activo: boolean,
): Promise<{ medico: Medico; pacientesReasignados: number }> {
  const res = await apiFetch<{
    ok: boolean;
    data: Medico;
    meta?: { pacientesReasignados?: number };
  }>(`/api/medicos/${id}/activo`, {
    method: "PATCH",
    body: JSON.stringify({ activo }),
  });
  return {
    medico: res.data,
    pacientesReasignados: res.meta?.pacientesReasignados ?? 0,
  };
}

export async function uploadFirmaMedico(id: string, file: File): Promise<Medico> {
  const form = new FormData();
  form.append("firma", file);
  const res = await apiFetch<{ ok: boolean; data: Medico }>(`/api/medicos/${id}/firma`, {
    method: "POST",
    body: form,
  });
  return res.data;
}

export async function deleteFirmaMedico(id: string): Promise<Medico> {
  const res = await apiFetch<{ ok: boolean; data: Medico }>(`/api/medicos/${id}/firma`, {
    method: "DELETE",
  });
  return res.data;
}

export async function fetchPrestaciones(): Promise<Prestacion[]> {
  const res = await apiFetch<{ ok: boolean; data: Prestacion[] }>("/api/prestaciones");
  return res.data;
}

export async function createPrestacion(data: PrestacionFormData): Promise<Prestacion> {
  const res = await apiFetch<{ ok: boolean; data: Prestacion }>("/api/prestaciones", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updatePrestacion(id: string, data: PrestacionFormData): Promise<Prestacion> {
  const res = await apiFetch<{ ok: boolean; data: Prestacion }>(`/api/prestaciones/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function deletePrestacion(id: string): Promise<void> {
  await apiFetch(`/api/prestaciones/${id}`, { method: "DELETE" });
}

export async function fetchPresupuestosConfig(): Promise<PresupuestosConfig> {
  const res = await apiFetch<{ ok: boolean; data: PresupuestosConfig }>("/api/presupuestos/config");
  return res.data;
}

export async function savePresupuestosConfig(data: PresupuestosConfig): Promise<PresupuestosConfig> {
  const res = await apiFetch<{ ok: boolean; data: PresupuestosConfig }>("/api/presupuestos/config", {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchPresupuestos(): Promise<Presupuesto[]> {
  const res = await apiFetch<{ ok: boolean; data: Presupuesto[] }>("/api/presupuestos");
  return res.data;
}

export async function createPresupuesto(
  data: PresupuestoFormData & { pdfBase64?: string; enviar?: boolean },
): Promise<Presupuesto> {
  const res = await apiFetch<{ ok: boolean; data: Presupuesto }>("/api/presupuestos", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function enviarPresupuesto(
  id: string,
  overrides?: { subject?: string; body?: string },
): Promise<Presupuesto> {
  const res = await apiFetch<{ ok: boolean; data: Presupuesto }>(`/api/presupuestos/${id}/enviar`, {
    method: "POST",
    body: JSON.stringify(overrides ?? {}),
  });
  return res.data;
}

export async function updatePresupuesto(
  id: string,
  data: PresupuestoFormData & { pdfBase64?: string; enviar?: boolean },
): Promise<Presupuesto> {
  const res = await apiFetch<{ ok: boolean; data: Presupuesto }>(`/api/presupuestos/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updatePresupuestoEstado(
  id: string,
  estado: Presupuesto["estado"],
): Promise<Presupuesto> {
  const res = await apiFetch<{ ok: boolean; data: Presupuesto }>(`/api/presupuestos/${id}/estado`, {
    method: "PATCH",
    body: JSON.stringify({ estado }),
  });
  return res.data;
}

export async function deletePresupuesto(id: string): Promise<void> {
  await apiFetch(`/api/presupuestos/${id}`, { method: "DELETE" });
}

export async function listPamiAnalisis(): Promise<PamiAnalisisGuardado[]> {
  const res = await apiFetch<{ ok: boolean; data: PamiAnalisisGuardado[] }>("/api/pami");
  return res.data;
}

export async function getPamiAnalisis(id: string): Promise<PamiAnalisisGuardado> {
  const res = await apiFetch<{ ok: boolean; data: PamiAnalisisGuardado }>(`/api/pami/${id}`);
  return res.data;
}

export async function savePamiAnalisis(input: {
  mes: string;
  presentacionFileName: string;
  debitosFileName: string;
  presentacionBase64: string;
  debitosBase64: string;
  pdfBase64: string;
  resumen: PamiAnalisisResumen;
  resultado: PamiAnalisisResult;
}): Promise<PamiAnalisisGuardado> {
  const res = await apiFetch<{ ok: boolean; data: PamiAnalisisGuardado }>("/api/pami", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function deletePamiAnalisis(id: string): Promise<void> {
  await apiFetch(`/api/pami/${id}`, { method: "DELETE" });
}

export async function fetchPedidosSistema(): Promise<PedidoSistema[]> {
  const res = await apiFetch<{ ok: boolean; data: PedidoSistema[] }>("/api/pedidos-sistema");
  return res.data;
}

export async function createPedidoSistema(
  data: PedidoSistemaCreateInput,
): Promise<PedidoSistema> {
  const res = await apiFetch<{ ok: boolean; data: PedidoSistema }>("/api/pedidos-sistema", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updatePedidoSistema(
  id: string,
  data: {
    estado?: PedidoSistemaEstado;
    prioridad?: PedidoSistemaPrioridad;
    titulo?: string;
    detalle?: string;
    cuando?: string;
  },
): Promise<PedidoSistema> {
  const res = await apiFetch<{ ok: boolean; data: PedidoSistema }>(
    `/api/pedidos-sistema/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
  return res.data;
}

export async function deletePedidoSistema(id: string): Promise<void> {
  await apiFetch(`/api/pedidos-sistema/${id}`, { method: "DELETE" });
}

