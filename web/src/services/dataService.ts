import { apiFetch } from "../config/api";
import type { Medico, MedicoFormData, Paciente, PacienteFormData } from "../types";

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

export async function deletePaciente(id: string): Promise<void> {
  await apiFetch(`/api/pacientes/${id}`, { method: "DELETE" });
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

export async function deleteMedico(id: string): Promise<void> {
  await apiFetch(`/api/medicos/${id}`, { method: "DELETE" });
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
