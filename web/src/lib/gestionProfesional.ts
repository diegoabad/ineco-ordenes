import { apiFetch } from "../config/api";

export type GestionDepartamento = {
  id: string;
  nombre: string;
  codigo: string;
  orden: number;
};

export type GestionCategoria = {
  id: string;
  nombre: string;
  orden: number;
};

export type GestionProfesionalAsignacion = {
  doc: string;
  visible: boolean;
  categoriaId: string;
  departamentoId: string;
};

export type GestionPrecioCategoria = {
  una: number | null;
  tres: number | null;
};

export type GestionTratamiento = {
  codigo: string;
  departamentoId: string;
  precios: Record<string, GestionPrecioCategoria>;
  valorVenta: number | null;
  precioLista: number | null;
};

export type GestionProfesionalConfig = {
  updatedAt: string;
  updatedBy: string | null;
  departamentos: GestionDepartamento[];
  categorias: GestionCategoria[];
  profesionales: GestionProfesionalAsignacion[];
  tratamientos: GestionTratamiento[];
};

export type GestionCatalogoProfesional = {
  doc: string;
  nombre: string;
  sede: string;
  enabled: boolean;
};

export type GestionCatalogoTratamiento = {
  codigo: string;
  nombre: string;
  duracion: number;
  enabled: boolean;
};

export type GestionCatalogo = {
  profesionales: GestionCatalogoProfesional[];
  tratamientos: GestionCatalogoTratamiento[];
};

export type GestionProfesionalVista = {
  config: GestionProfesionalConfig;
  catalogo: GestionCatalogo;
};

export const AREAS_EJEMPLO: { nombre: string; codigo: string }[] = [
  { nombre: "TO", codigo: "TO" },
  { nombre: "TR", codigo: "TR" },
  { nombre: "Kinesiología", codigo: "KINE" },
  { nombre: "Fonoaudiología", codigo: "FONO" },
  { nombre: "T.B.A.", codigo: "TBA" },
  { nombre: "Psicoterapia", codigo: "PSICO" },
  { nombre: "NPS", codigo: "NPS" },
  { nombre: "Infanto", codigo: "INF" },
];

export const CATEGORIAS_EJEMPLO = ["Jefe", "S. Senior", "Senior", "Staff"];

export function nuevoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizarBusqueda(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function formatPrecio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function snapshotGestion(config: GestionProfesionalConfig): string {
  return JSON.stringify({
    departamentos: config.departamentos,
    categorias: config.categorias,
    profesionales: config.profesionales,
    tratamientos: config.tratamientos,
  });
}

export function asignacionDe(
  config: GestionProfesionalConfig,
  doc: string,
): GestionProfesionalAsignacion {
  return (
    config.profesionales.find((p) => p.doc === doc) ?? {
      doc,
      visible: false,
      categoriaId: "",
      departamentoId: "",
    }
  );
}

export function guardarProfesional(
  config: GestionProfesionalConfig,
  next: GestionProfesionalAsignacion,
): GestionProfesionalConfig {
  const rest = config.profesionales.filter((p) => p.doc !== next.doc);
  if (!next.visible && !next.categoriaId && !next.departamentoId) {
    return { ...config, profesionales: rest };
  }
  return { ...config, profesionales: [...rest, next] };
}

export function tratamientoDe(
  config: GestionProfesionalConfig,
  codigo: string,
): GestionTratamiento {
  return (
    config.tratamientos.find((t) => t.codigo === codigo) ?? {
      codigo,
      departamentoId: "",
      precios: {},
      valorVenta: null,
      precioLista: null,
    }
  );
}

export function guardarTratamiento(
  config: GestionProfesionalConfig,
  next: GestionTratamiento,
): GestionProfesionalConfig {
  const rest = config.tratamientos.filter((t) => t.codigo !== next.codigo);
  const vacio =
    !next.departamentoId &&
    next.valorVenta == null &&
    next.precioLista == null &&
    Object.keys(next.precios).length === 0;
  if (vacio) return { ...config, tratamientos: rest };
  return { ...config, tratamientos: [...rest, next] };
}

export function preciosCargados(tratamiento: GestionTratamiento): number {
  return Object.values(tratamiento.precios).filter(
    (p) => (p.una != null && p.una > 0) || (p.tres != null && p.tres > 0),
  ).length;
}

export async function fetchGestionProfesional(): Promise<GestionProfesionalVista> {
  const res = await apiFetch<{ ok: boolean; data: GestionProfesionalVista }>(
    "/api/gestion-profesional",
  );
  return res.data;
}

export async function saveGestionProfesional(
  config: GestionProfesionalConfig,
): Promise<GestionProfesionalConfig> {
  const res = await apiFetch<{ ok: boolean; data: GestionProfesionalConfig }>(
    "/api/gestion-profesional",
    {
      method: "PUT",
      body: JSON.stringify({
        departamentos: config.departamentos,
        categorias: config.categorias,
        profesionales: config.profesionales,
        tratamientos: config.tratamientos,
      }),
    },
  );
  return res.data;
}
