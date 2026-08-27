import { apiFetch } from "../config/api";
import type { EmailConfig } from "../types/email";
import type { EmailEnvio, Medico, MedicoFormData, Paciente, PacienteFormData } from "../types";

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

export async function enviarOrdenEmail(input: {
  pacienteId: string;
  pdfBase64: string;
  filename?: string;
  fecha?: string;
  medicoNombre?: string;
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
