import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { AppSidebar, type AppModule } from "./components/AppSidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  IconActivate,
  IconEye,
  IconFile,
  IconLink,
  IconMail,
  IconPdf,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStar,
  IconTrash,
} from "./components/Icons";
import { EmailConfigPanel } from "./components/EmailConfigPanel";
import {
  EnvioResultadoModal,
  type EnvioResultadoItem,
} from "./components/EnvioResultadoModal";
import { creadoAtMs } from "./lib/sortRecientes";
import { FechaOrdenModal } from "./components/FechaOrdenModal";
import { HistorialEnviosPanel } from "./components/HistorialEnviosPanel";
import { MedicoFormModal } from "./components/MedicoFormModal";
import { PacienteFormModal } from "./components/PacienteFormModal";
import { PresupuestosModule } from "./components/PresupuestosModule";
import { ViewDetailModal } from "./components/ViewDetailModal";
import { firmaSrc, firmaToDataUrlForPdf } from "./lib/firma";
import { copiarLinkFirma } from "./lib/firmaLink";
import { subscribeFirmaActualizada } from "./lib/firmaSync";
import { abrirPdfEnPestana } from "./lib/pdfViewer";
import { generarPdfRecetas, pdfBlobFromDoc } from "./pdf/generarRecetaPdf";
import {
  createMedico,
  createPaciente,
  deleteFirmaMedico,
  enviarOrdenEmail,
  fetchDb,
  saveMedicoSeleccionadoId,
  setMedicoActivo,
  setPacienteActivo,
  updateMedico,
  updatePaciente,
  uploadFirmaMedico,
} from "./services/dataService";
import type {
  ConfigMedico,
  FiltroActivo,
  Medico,
  MedicoSavePayload,
  Paciente,
  PacienteFormData,
} from "./types";

type Tab = "pacientes" | "medicos" | "historial" | "config";

type FechaPending =
  | { kind: "imprimir"; list: Paciente[] }
  | { kind: "enviar"; list: Paciente[] };

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function toConfigMedico(m: Medico, firmaDataUrl?: string | null): ConfigMedico {
  return {
    nombre: m.nombre,
    especialidad: m.especialidad,
    matricula: m.matricula,
    firmaUrl: m.firmaUrl,
    firmaDataUrl: firmaDataUrl ?? null,
  };
}

export default function App() {
  const [module, setModule] = useState<AppModule>("ordenes");
  const [tab, setTab] = useState<Tab>("pacientes");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [medicoSeleccionadoId, setMedicoSeleccionadoId] = useState<string | null>(null);
  const [busquedaPacientes, setBusquedaPacientes] = useState("");
  const [busquedaMedicos, setBusquedaMedicos] = useState("");
  const [filtroPacientes, setFiltroPacientes] = useState<FiltroActivo>("activos");
  const [filtroMedicos, setFiltroMedicos] = useState<FiltroActivo>("activos");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingMedico, setSavingMedico] = useState(false);
  const [fechaPending, setFechaPending] = useState<FechaPending | null>(null);

  const [pacienteFormOpen, setPacienteFormOpen] = useState(false);
  const [editingPaciente, setEditingPaciente] = useState<Paciente | null>(null);
  const [viewingPaciente, setViewingPaciente] = useState<Paciente | null>(null);
  const [medicoFormOpen, setMedicoFormOpen] = useState(false);
  const [editingMedico, setEditingMedico] = useState<Medico | null>(null);
  const [viewingMedico, setViewingMedico] = useState<Medico | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [firmaCacheBust, setFirmaCacheBust] = useState<Record<string, number>>({});
  const [enviandoTodas, setEnviandoTodas] = useState(false);
  const [historialRefresh, setHistorialRefresh] = useState(0);
  const [envioResultado, setEnvioResultado] = useState<{
    items: EnvioResultadoItem[];
    omitidosSinEmail: number;
  } | null>(null);

  const medicoPorDefecto =
    medicos.find((m) => m.id === medicoSeleccionadoId && m.activo) ??
    medicos.find((m) => m.activo) ??
    null;

  const pacientesActivos = pacientes.filter((p) => p.activo);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const db = await fetchDb();
      setPacientes(db.pacientes);
      setMedicos(db.medicos);
      setMedicoSeleccionadoId(db.medicoSeleccionadoId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }, []);

  const refrescarMedicos = useCallback(async () => {
    try {
      const db = await fetchDb();
      setMedicos(db.medicos);
      setEditingMedico((prev) => {
        if (!prev) return prev;
        return db.medicos.find((m) => m.id === prev.id) ?? prev;
      });
    } catch {
      // silencioso: el usuario puede seguir trabajando con datos en memoria
    }
  }, []);

  const aplicarMedicoActualizado = useCallback((medico: Medico) => {
    setMedicos((prev) => {
      const exists = prev.some((m) => m.id === medico.id);
      if (exists) return prev.map((m) => (m.id === medico.id ? medico : m));
      return [medico, ...prev];
    });
    setEditingMedico((prev) => (prev?.id === medico.id ? medico : prev));
    if (medico.firmaUrl) {
      setFirmaCacheBust((prev) => ({ ...prev, [medico.id]: Date.now() }));
    }
  }, []);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  useEffect(() => {
    const unsubscribe = subscribeFirmaActualizada(aplicarMedicoActualizado);

    function onVisible() {
      if (document.visibilityState === "visible") {
        void refrescarMedicos();
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refrescarMedicos, aplicarMedicoActualizado]);

  function nombreMedico(medicoId: string | null): string {
    if (!medicoId) return "";
    return medicos.find((m) => m.id === medicoId)?.nombre ?? "";
  }

  function medicoParaPaciente(p: Paciente): Medico | null {
    if (p.medicoId) {
      const asignado = medicos.find((m) => m.id === p.medicoId && m.activo);
      if (asignado) return asignado;
    }
    return medicoPorDefecto;
  }

  const qPacientes = busquedaPacientes.trim().toLowerCase();
  const pacientesFiltrados = pacientes.filter((p) => {
    if (filtroPacientes === "activos" && !p.activo) return false;
    if (filtroPacientes === "inactivos" && p.activo) return false;
    if (!qPacientes) return true;
    return [p.paciente, p.email, p.diagnostico, nombreMedico(p.medicoId)]
      .join(" ")
      .toLowerCase()
      .includes(qPacientes);
  });

  async function handleMedicoSeleccionadoChange(
    id: string | null,
    opts?: { silent?: boolean },
  ) {
    setMedicoSeleccionadoId(id);
    try {
      await saveMedicoSeleccionadoId(id);
      if (id && !opts?.silent) toast.success("Profesional por defecto actualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el profesional por defecto");
      void cargarDatos();
    }
  }

  const qMedicos = busquedaMedicos.trim().toLowerCase();
  const medicosFiltrados = medicos
    .filter((m) => {
      if (filtroMedicos === "activos" && !m.activo) return false;
      if (filtroMedicos === "inactivos" && m.activo) return false;
      if (!qMedicos) return true;
      return [m.nombre, m.especialidad, m.matricula].join(" ").toLowerCase().includes(qMedicos);
    })
    .slice()
    .sort((a, b) => {
      if (a.id === medicoSeleccionadoId) return -1;
      if (b.id === medicoSeleccionadoId) return 1;
      const diff = creadoAtMs(b.creadoAt) - creadoAtMs(a.creadoAt);
      if (diff !== 0) return diff;
      return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
    });

  async function handleSavePaciente(data: PacienteFormData, id?: string) {
    try {
      if (id) {
        const paciente = await updatePaciente(id, data);
        setPacientes((prev) => prev.map((p) => (p.id === id ? paciente : p)));
        toast.success("Paciente actualizado");
      } else {
        const paciente = await createPaciente(data);
        setPacientes((prev) => [paciente, ...prev]);
        toast.success("Paciente creado");
      }
      setPacienteFormOpen(false);
      setEditingPaciente(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el paciente");
    }
  }

  function handleDesactivarPaciente(id: string) {
    const paciente = pacientes.find((p) => p.id === id);
    setConfirmDialog({
      title: "Desactivar paciente",
      message: paciente
        ? `¿Desactivar a ${paciente.paciente}? Va a salir de la lista de activos, pero el historial se conserva.`
        : "¿Desactivar este paciente?",
      confirmLabel: "Desactivar",
      onConfirm: async () => {
        try {
          const actualizado = await setPacienteActivo(id, false);
          setPacientes((prev) => prev.map((p) => (p.id === id ? actualizado : p)));
          toast.success("Paciente desactivado");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "No se pudo desactivar");
        }
      },
    });
  }

  async function handleActivarPaciente(id: string) {
    try {
      const actualizado = await setPacienteActivo(id, true);
      setPacientes((prev) => prev.map((p) => (p.id === id ? actualizado : p)));
      toast.success("Paciente activado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo activar");
    }
  }

  async function handleSaveMedico({ data, id, firmaFile, removeFirma }: MedicoSavePayload) {
    setSavingMedico(true);
    try {
      let medico = id ? await updateMedico(id, data) : await createMedico(data);

      if (removeFirma && medico.firmaUrl) {
        medico = await deleteFirmaMedico(medico.id);
      }

      if (firmaFile) {
        medico = await uploadFirmaMedico(medico.id, firmaFile);
      }

      aplicarMedicoActualizado(medico);

      if (!medicoSeleccionadoId) {
        setMedicoSeleccionadoId(medico.id);
      }

      setMedicoFormOpen(false);
      setEditingMedico(null);
      toast.success(id ? "Profesional actualizado" : "Profesional creado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el profesional");
    } finally {
      setSavingMedico(false);
    }
  }

  function handleDesactivarMedico(id: string) {
    const medico = medicos.find((m) => m.id === id);
    if (!medico) return;

    if (medicoSeleccionadoId === id) {
      toast.warning(
        "No se puede desactivar el profesional por defecto. Primero elegí otro profesional por defecto (estrella).",
      );
      return;
    }

    const afectados = pacientes.filter((p) => p.medicoId === id);
    const avisoPacientes =
      afectados.length === 0
        ? "Ningún paciente lo tiene asignado."
        : afectados.length === 1
          ? `El paciente ${afectados[0]!.paciente} pasará a usar el profesional por defecto.`
          : `${afectados.length} pacientes que lo tienen asignado pasarán a usar el profesional por defecto.`;

    setConfirmDialog({
      title: "Desactivar profesional",
      message: `¿Desactivar a ${medico.nombre}? ${avisoPacientes}`,
      confirmLabel: "Desactivar",
      onConfirm: async () => {
        try {
          const { medico: actualizado, pacientesReasignados } = await setMedicoActivo(id, false);
          setMedicos((prev) => prev.map((m) => (m.id === id ? actualizado : m)));
          if (pacientesReasignados > 0) {
            setPacientes((prev) =>
              prev.map((p) => (p.medicoId === id ? { ...p, medicoId: null } : p)),
            );
          }
          toast.success(
            pacientesReasignados > 0
              ? `Profesional desactivado. ${pacientesReasignados} paciente${pacientesReasignados === 1 ? "" : "s"} pasó${pacientesReasignados === 1 ? "" : "ron"} al por defecto.`
              : "Profesional desactivado",
          );
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "No se pudo desactivar");
        }
      },
    });
  }

  async function handleActivarMedico(id: string) {
    try {
      const { medico: actualizado } = await setMedicoActivo(id, true);
      setMedicos((prev) => prev.map((m) => (m.id === id ? actualizado : m)));
      toast.success("Profesional activado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo activar");
    }
  }

  async function imprimirOrdenes(list: Paciente[], fecha: string) {
    if (list.length === 0) return;
    if (!fecha) {
      toast.warning("Indicá la fecha de la orden.");
      return;
    }

    const items: { paciente: Paciente; medico: ConfigMedico }[] = [];
    const firmasFaltantes: string[] = [];
    for (const p of list) {
      const medico = medicoParaPaciente(p);
      if (!medico) {
        toast.warning(
          `No hay profesional para "${p.paciente}". Asignale uno en el paciente o elegí un profesional por defecto.`,
        );
        return;
      }
      const firmaDataUrl = await firmaToDataUrlForPdf(medico.firmaUrl);
      if (medico.firmaUrl && !firmaDataUrl) {
        firmasFaltantes.push(medico.nombre);
      }
      items.push({ paciente: p, medico: toConfigMedico(medico, firmaDataUrl) });
    }

    if (firmasFaltantes.length > 0) {
      const unicos = [...new Set(firmasFaltantes)];
      toast.warning(
        `No se encontró la firma en el servidor para: ${unicos.join(", ")}. El PDF se generará sin firma.`,
      );
    }

    const doc = generarPdfRecetas(items, fecha);
    abrirPdfEnPestana(pdfBlobFromDoc(doc));
  }

  async function generarYEnviarOrden(paciente: Paciente, fecha: string): Promise<string> {
    if (!paciente.email?.trim()) {
      throw new Error("Este paciente no tiene email cargado");
    }
    if (!fecha) {
      throw new Error("Indicá la fecha de la orden.");
    }

    const medico = medicoParaPaciente(paciente);
    if (!medico) {
      throw new Error(
        `No hay profesional para "${paciente.paciente}". Asignale uno o elegí un profesional por defecto.`,
      );
    }

    const firmaDataUrl = await firmaToDataUrlForPdf(medico.firmaUrl);
    if (medico.firmaUrl && !firmaDataUrl) {
      toast.warning(
        `No se encontró la firma de ${medico.nombre}. El PDF se enviará sin firma.`,
      );
    }

    const doc = generarPdfRecetas(
      [{ paciente, medico: toConfigMedico(medico, firmaDataUrl) }],
      fecha,
    );
    const blob = pdfBlobFromDoc(doc);
    const pdfBase64 = await blobToBase64(blob);
    const filename = `orden-${paciente.paciente.replace(/\s+/g, "-") || "paciente"}-${fecha}.pdf`;

    const result = await enviarOrdenEmail({
      pacienteId: paciente.id,
      pdfBase64,
      filename,
      fecha,
      medicoNombre: medico.nombre,
    });
    return result.to;
  }

  function solicitarImprimir(list: Paciente[]) {
    if (list.length === 0) return;
    setFechaPending({ kind: "imprimir", list });
  }

  function solicitarEnviar(list: Paciente[]) {
    if (enviandoTodas) {
      toast.info("Ya hay un envío en curso. Esperá a que termine.");
      return;
    }
    const conEmail = list.filter((p) => p.email?.trim());
    if (conEmail.length === 0) {
      toast.warning(
        list.length === 1
          ? "Este paciente no tiene email. Cargalo antes de enviar."
          : "Ningún paciente tiene email cargado.",
      );
      return;
    }
    setFechaPending({ kind: "enviar", list: conEmail });
  }

  async function enviarOrdenPorMail(paciente: Paciente, fecha: string) {
    const toastId = toast.loading("Enviando mail…");
    try {
      const to = await generarYEnviarOrden(paciente, fecha);
      toast.update(toastId, {
        render: `El mail se envió correctamente a ${to}`,
        type: "success",
        isLoading: false,
        autoClose: 4000,
      });
      setHistorialRefresh((n) => n + 1);
    } catch {
      toast.update(toastId, {
        render: "No se pudo enviar el mail. Revisá el historial para ver el detalle.",
        type: "error",
        isLoading: false,
        autoClose: 6000,
      });
      setHistorialRefresh((n) => n + 1);
    }
  }

  async function enviarTodasPorMail(list: Paciente[], fecha: string) {
    const conEmail = list.filter((p) => p.email?.trim());
    const sinEmail = list.length - conEmail.length;

    if (conEmail.length === 0) {
      toast.warning("Ningún paciente tiene email cargado.");
      return;
    }

    setEnviandoTodas(true);
    const total = conEmail.length;
    const toastId = toast.loading(`Enviando mails… (0/${total}) · OK 0 · Falló 0`);
    const resultados: EnvioResultadoItem[] = [];

    try {
      for (let i = 0; i < conEmail.length; i += 1) {
        const paciente = conEmail[i]!;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });

        try {
          await generarYEnviarOrden(paciente, fecha);
          resultados.push({
            pacienteNombre: paciente.paciente,
            email: paciente.email.trim(),
            ok: true,
          });
        } catch (error) {
          resultados.push({
            pacienteNombre: paciente.paciente,
            email: paciente.email.trim(),
            ok: false,
            errorMessage:
              error instanceof Error ? error.message : "No se pudo enviar el mail",
          });
        }

        const enviados = resultados.filter((r) => r.ok).length;
        const fallidos = resultados.length - enviados;
        toast.update(toastId, {
          render: `Enviando mails… (${resultados.length}/${total}) · OK ${enviados} · Falló ${fallidos}`,
          isLoading: true,
        });
      }

      const enviados = resultados.filter((r) => r.ok).length;
      const fallidos = resultados.length - enviados;

      if (enviados > 0 && fallidos === 0) {
        toast.update(toastId, {
          render:
            `Se enviaron correctamente los ${enviados} mail${enviados === 1 ? "" : "s"}` +
            (sinEmail > 0 ? ` (${sinEmail} sin email, omitidos)` : ""),
          type: "success",
          isLoading: false,
          autoClose: 4000,
        });
      } else if (enviados > 0) {
        toast.update(toastId, {
          render: `Listo: ${enviados} enviados, ${fallidos} fallaron. Mirá el detalle.`,
          type: "warning",
          isLoading: false,
          autoClose: 5000,
        });
      } else {
        toast.update(toastId, {
          render: `No se pudo enviar ningún mail (${fallidos} fallaron). Mirá el detalle.`,
          type: "error",
          isLoading: false,
          autoClose: 5000,
        });
      }

      setEnvioResultado({ items: resultados, omitidosSinEmail: sinEmail });
    } catch {
      toast.update(toastId, {
        render: "No se pudieron enviar los mails. Revisá el historial para ver el detalle.",
        type: "error",
        isLoading: false,
        autoClose: 7000,
      });
    } finally {
      setEnviandoTodas(false);
      setHistorialRefresh((n) => n + 1);
    }
  }

  async function handleFechaConfirm(fecha: string) {
    const pending = fechaPending;
    setFechaPending(null);
    if (!pending) return;

    if (pending.kind === "imprimir") {
      await imprimirOrdenes(pending.list, fecha);
      return;
    }

    // El envío corre en segundo plano para no bloquear la pantalla.
    if (pending.list.length === 1) {
      void enviarOrdenPorMail(pending.list[0]!, fecha);
      return;
    }

    void enviarTodasPorMail(pending.list, fecha);
  }

  const puedeImprimir = Boolean(
    medicoPorDefecto || pacientesActivos.some((p) => p.medicoId),
  );
  const pacientesConEmail = pacientesActivos.filter((p) => p.email?.trim()).length;
  const puedeEnviarTodas = pacientesConEmail > 0 && puedeImprimir && !enviandoTodas;

  if (loading) {
    return (
      <div className="app-layout">
        <AppSidebar module={module} onModuleChange={setModule} />
        <div className="app-main">
          <div className="app-shell">
            <div className="fl-table-empty">
              <p className="fl-table-empty__title">Cargando datos…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-layout">
        <AppSidebar module={module} onModuleChange={setModule} />
        <div className="app-main">
          <div className="app-shell">
            <div className="fl-table-empty">
              <p className="fl-table-empty__title">No se pudo conectar con la API</p>
              <p className="fl-table-empty__hint">{loadError}</p>
              <button type="button" className="btn btn-primary" onClick={() => void cargarDatos()}>
                Reintentar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <AppSidebar module={module} onModuleChange={setModule} />
      <div className="app-main">
        {module === "presupuestos" ? (
          <PresupuestosModule />
        ) : (
          <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>Órdenes</h1>
            <p>Pacientes y profesionales para generar órdenes</p>
          </div>
        </div>

        <div className="app-header__actions">
          {tab === "pacientes" ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditingPaciente(null);
                setPacienteFormOpen(true);
              }}
            >
              <IconPlus size={16} />
              Agregar paciente
            </button>
          ) : null}
          {tab === "medicos" ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditingMedico(null);
                setMedicoFormOpen(true);
              }}
            >
              <IconPlus size={16} />
              Agregar profesional
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-print"
            disabled={pacientesActivos.length === 0 || !puedeImprimir}
            onClick={() => solicitarImprimir(pacientesActivos)}
          >
            <IconPdf size={16} />
            Generar PDFs
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!puedeEnviarTodas}
            title={
              pacientesConEmail === 0
                ? "Ningún paciente tiene email"
                : enviandoTodas
                  ? "Enviando…"
                  : `Enviar órdenes por mail (${pacientesConEmail})`
            }
            onClick={() => solicitarEnviar(pacientesActivos)}
          >
            <IconMail size={16} />
            {enviandoTodas ? "Enviando…" : "Enviar todas"}
          </button>
        </div>
      </header>

      <nav className="app-tabs app-tabs--full" aria-label="Secciones">
        <button
          type="button"
          className={`app-tabs__btn${tab === "pacientes" ? " is-active" : ""}`}
          onClick={() => setTab("pacientes")}
        >
          Pacientes
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "medicos" ? " is-active" : ""}`}
          onClick={() => setTab("medicos")}
        >
          Profesionales
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "historial" ? " is-active" : ""}`}
          onClick={() => setTab("historial")}
        >
          Historial
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "config" ? " is-active" : ""}`}
          onClick={() => setTab("config")}
        >
          Plantilla email
        </button>
      </nav>

      {tab === "pacientes" ? (
        <section className="fl-table-card">
          <div className="table-toolbar table-toolbar--filters">
            <div className="table-search">
              <span className="table-search__icon" aria-hidden>
                <IconSearch size={16} />
              </span>
              <input
                type="search"
                value={busquedaPacientes}
                onChange={(e) => setBusquedaPacientes(e.target.value)}
                placeholder="Buscar paciente, profesional, email, diagnóstico…"
                aria-label="Buscar pacientes"
              />
            </div>
            <div className="table-toolbar__month form-group">
              <label htmlFor="filtro-pacientes">Estado</label>
              <select
                id="filtro-pacientes"
                value={filtroPacientes}
                onChange={(e) => setFiltroPacientes(e.target.value as FiltroActivo)}
                aria-label="Filtrar pacientes por estado"
              >
                <option value="activos">Activos</option>
                <option value="inactivos">No activos</option>
                <option value="todos">Todos</option>
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <colgroup>
                <col className="col-nombre" />
                <col className="col-email" />
                <col className="col-medico" />
                <col className="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Profesional</th>
                  <th className="fl-col-actions">Acciones</th>
                </tr>
              </thead>
              {pacientesFiltrados.length > 0 ? (
                <tbody>
                  {pacientesFiltrados.map((p) => {
                    const medicoNombre = nombreMedico(p.medicoId);
                    return (
                      <tr key={p.id} className={p.activo ? undefined : "is-inactive"}>
                        <td>
                          <span className="fl-texto-principal">{p.paciente}</span>
                          {!p.activo ? (
                            <span className="chip chip--muted" style={{ marginLeft: "0.4rem" }}>
                              Inactivo
                            </span>
                          ) : null}
                        </td>
                        <td className="fl-col-email">
                          {p.email?.trim() ? (
                            <span className="fl-texto-truncado" title={p.email}>
                              {p.email}
                            </span>
                          ) : (
                            <span className="chip chip--muted">No tiene</span>
                          )}
                        </td>
                        <td className="fl-col-medico">
                          {medicoNombre ? (
                            <span className="fl-texto-truncado" title={medicoNombre}>
                              {medicoNombre}
                            </span>
                          ) : (
                            <span
                              className="chip chip--default"
                              title={
                                medicoPorDefecto?.nombre
                                  ? `Profesional por defecto: ${medicoPorDefecto.nombre}`
                                  : "Sin profesional por defecto"
                              }
                            >
                              Por defecto
                            </span>
                          )}
                        </td>
                        <td className="fl-col-actions">
                          <div className="fl-table-actions">
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--mail"
                              title={
                                !p.activo
                                  ? "Paciente inactivo"
                                  : p.email?.trim()
                                    ? "Enviar orden por email"
                                    : "Sin email — cargalo en el paciente"
                              }
                              aria-label="Enviar orden por email"
                              disabled={
                                !p.activo ||
                                enviandoTodas ||
                                !p.email?.trim() ||
                                !medicoParaPaciente(p)
                              }
                              onClick={() => solicitarEnviar([p])}
                            >
                              <IconMail size={16} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--print"
                              title={p.activo ? "Generar PDF" : "Paciente inactivo"}
                              aria-label="Generar PDF"
                              disabled={!p.activo || !medicoParaPaciente(p)}
                              onClick={() => solicitarImprimir([p])}
                            >
                              <IconPdf size={16} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--view"
                              title="Ver"
                              aria-label="Ver"
                              onClick={() => setViewingPaciente(p)}
                            >
                              <IconEye size={16} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--edit"
                              title="Editar"
                              aria-label="Editar"
                              onClick={() => {
                                setEditingPaciente(p);
                                setPacienteFormOpen(true);
                              }}
                            >
                              <IconPencil size={16} />
                            </button>
                            {p.activo ? (
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--danger"
                                title="Desactivar"
                                aria-label="Desactivar paciente"
                                onClick={() => handleDesactivarPaciente(p.id)}
                              >
                                <IconTrash size={16} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--success"
                                title="Activar"
                                aria-label="Activar paciente"
                                onClick={() => void handleActivarPaciente(p.id)}
                              >
                                <IconActivate size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ) : null}
            </table>
            {pacientesFiltrados.length === 0 ? (
              <div className="fl-table-empty fl-table-empty--fill">
                {pacientes.length === 0 ? (
                  <>
                    <div className="fl-table-empty__art">
                      <IconFile size={32} />
                    </div>
                    <p className="fl-table-empty__title">No hay pacientes todavía</p>
                    <p className="fl-table-empty__hint">
                      Agregá el primero con el botón Agregar paciente.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="fl-table-empty__title">Sin resultados</p>
                    <p className="fl-table-empty__hint">
                      Proba con otra búsqueda o cambiá el filtro de estado.
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : tab === "historial" ? (
        <HistorialEnviosPanel
          pacientes={pacientes}
          refreshKey={historialRefresh}
          onRetry={(paciente) => {
            if (!paciente.activo) {
              toast.warning("Este paciente está desactivado. Activalo para reintentar el envío.");
              return;
            }
            solicitarEnviar([paciente]);
          }}
        />
      ) : tab === "config" ? (
        <EmailConfigPanel />
      ) : (
        <section className="fl-table-card">
          <div className="table-toolbar table-toolbar--filters">
            <div className="table-search">
              <span className="table-search__icon" aria-hidden>
                <IconSearch size={16} />
              </span>
              <input
                type="search"
                value={busquedaMedicos}
                onChange={(e) => setBusquedaMedicos(e.target.value)}
                placeholder="Buscar profesional, especialidad o matrícula…"
                aria-label="Buscar profesionales"
              />
            </div>
            <div className="table-toolbar__month form-group">
              <label htmlFor="filtro-medicos">Estado</label>
              <select
                id="filtro-medicos"
                value={filtroMedicos}
                onChange={(e) => setFiltroMedicos(e.target.value as FiltroActivo)}
                aria-label="Filtrar profesionales por estado"
              >
                <option value="activos">Activos</option>
                <option value="inactivos">No activos</option>
                <option value="todos">Todos</option>
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <colgroup>
                <col className="col-nombre" />
                <col className="col-especialidad" />
                <col className="col-matricula" />
                <col className="col-firma" />
                <col className="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Especialidad</th>
                  <th>Matrícula</th>
                  <th>Firma</th>
                  <th className="fl-col-actions">Acciones</th>
                </tr>
              </thead>
              {medicosFiltrados.length > 0 ? (
                <tbody>
                  {medicosFiltrados.map((m) => {
                    const esPorDefecto = m.id === medicoSeleccionadoId;
                    return (
                      <tr
                        key={m.id}
                        className={[
                          esPorDefecto ? "is-default-medico" : "",
                          m.activo ? "" : "is-inactive",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined}
                      >
                        <td>
                          <span
                            className={`medico-nombre${esPorDefecto ? " medico-nombre--default" : ""}`}
                            title={m.nombre}
                          >
                            <span className="fl-texto-truncado">{m.nombre}</span>
                            {esPorDefecto ? (
                              <span
                                className="medico-default-icon"
                                title="Profesional por defecto"
                                aria-label="Profesional por defecto"
                              >
                                <IconStar size={14} filled />
                              </span>
                            ) : null}
                            {!m.activo ? (
                              <span className="chip chip--muted">Inactivo</span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <span className="fl-texto-truncado" title={m.especialidad}>
                            {m.especialidad || "—"}
                          </span>
                        </td>
                        <td>{m.matricula || "—"}</td>
                        <td className="fl-col-firma">
                          {firmaSrc(m.firmaUrl, firmaCacheBust[m.id]) ? (
                            <img
                              src={firmaSrc(m.firmaUrl, firmaCacheBust[m.id])!}
                              alt="Firma"
                              className="firma-preview"
                            />
                          ) : (
                            <span className="text-muted">Sin firma</span>
                          )}
                        </td>
                        <td className="fl-col-actions">
                          <div className="fl-table-actions">
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--default"
                              title={
                                !m.activo
                                  ? "Profesional inactivo"
                                  : esPorDefecto
                                    ? "Ya es el profesional por defecto"
                                    : "Poner por defecto"
                              }
                              aria-label={
                                esPorDefecto
                                  ? "Ya es el profesional por defecto"
                                  : "Poner por defecto"
                              }
                              disabled={!m.activo || esPorDefecto}
                              onClick={() => void handleMedicoSeleccionadoChange(m.id)}
                            >
                              <IconStar size={16} filled={esPorDefecto} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--link"
                              title="Copiar link para firmar"
                              aria-label="Copiar link para firmar"
                              onClick={() => void copiarLinkFirma(m.id)}
                            >
                              <IconLink size={16} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--view"
                              title="Ver"
                              aria-label="Ver"
                              onClick={() => setViewingMedico(m)}
                            >
                              <IconEye size={16} />
                            </button>
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--edit"
                              title="Editar"
                              aria-label="Editar"
                              onClick={() => {
                                setEditingMedico(m);
                                setMedicoFormOpen(true);
                              }}
                            >
                              <IconPencil size={16} />
                            </button>
                            {m.activo ? (
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--danger"
                                title={
                                  esPorDefecto
                                    ? "No se puede desactivar el profesional por defecto"
                                    : "Desactivar"
                                }
                                aria-label="Desactivar profesional"
                                disabled={esPorDefecto}
                                onClick={() => handleDesactivarMedico(m.id)}
                              >
                                <IconTrash size={16} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--success"
                                title="Activar"
                                aria-label="Activar profesional"
                                onClick={() => void handleActivarMedico(m.id)}
                              >
                                <IconActivate size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ) : null}
            </table>
            {medicosFiltrados.length === 0 ? (
              <div className="fl-table-empty fl-table-empty--fill">
                {medicos.length === 0 ? (
                  <>
                    <div className="fl-table-empty__art">
                      <IconFile size={32} />
                    </div>
                    <p className="fl-table-empty__title">No hay profesionales todavía</p>
                    <p className="fl-table-empty__hint">
                      Agregá el primero con el botón Agregar profesional.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="fl-table-empty__title">Sin resultados</p>
                    <p className="fl-table-empty__hint">
                      Proba con otra búsqueda o cambiá el filtro de estado.
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </section>
      )}

      <PacienteFormModal
        open={pacienteFormOpen}
        initial={editingPaciente}
        medicos={medicos}
        medicoPorDefectoId={medicoSeleccionadoId}
        onClose={() => {
          setPacienteFormOpen(false);
          setEditingPaciente(null);
        }}
        onSave={handleSavePaciente}
      />

      <ViewDetailModal
        open={viewingPaciente !== null}
        title="Detalle del paciente"
        onClose={() => setViewingPaciente(null)}
        fields={
          viewingPaciente
            ? [
                { label: "Nombre", value: viewingPaciente.paciente },
                {
                  label: "Email",
                  value: viewingPaciente.email?.trim() ? (
                    viewingPaciente.email
                  ) : (
                    <span className="chip chip--muted">No tiene</span>
                  ),
                },
                {
                  label: "Profesional",
                  value: nombreMedico(viewingPaciente.medicoId) || (
                    <span
                      className="chip chip--default"
                      title={
                        medicoPorDefecto?.nombre
                          ? `Profesional por defecto: ${medicoPorDefecto.nombre}`
                          : "Sin profesional por defecto"
                      }
                    >
                      Por defecto
                    </span>
                  ),
                },
                { label: "Obra Social", value: viewingPaciente.obraSocial },
                { label: "Afiliado", value: viewingPaciente.afiliado },
                {
                  label: "Prestaciones",
                  value: viewingPaciente.prestacion?.trim() ? (
                    <span className="detail-list__multiline">{viewingPaciente.prestacion}</span>
                  ) : undefined,
                },
                { label: "Diagnóstico", value: viewingPaciente.diagnostico },
              ]
            : []
        }
      />

      <MedicoFormModal
        open={medicoFormOpen}
        initial={editingMedico}
        firmaCacheBust={editingMedico ? firmaCacheBust[editingMedico.id] : undefined}
        saving={savingMedico}
        onClose={() => {
          setMedicoFormOpen(false);
          setEditingMedico(null);
        }}
        onSave={handleSaveMedico}
      />

      <ViewDetailModal
        open={viewingMedico !== null}
        title="Detalle del profesional"
        onClose={() => setViewingMedico(null)}
        fields={
          viewingMedico
            ? [
                { label: "Nombre", value: viewingMedico.nombre },
                { label: "Especialidad", value: viewingMedico.especialidad },
                { label: "Matrícula", value: viewingMedico.matricula },
                {
                  label: "Firma",
                  value: firmaSrc(viewingMedico.firmaUrl, firmaCacheBust[viewingMedico.id]) ? (
                    <img
                      src={firmaSrc(viewingMedico.firmaUrl, firmaCacheBust[viewingMedico.id])!}
                      alt="Firma"
                      className="firma-preview firma-preview--modal"
                    />
                  ) : (
                    <span className="text-muted">Sin firma</span>
                  ),
                },
              ]
            : []
        }
      />

      <FechaOrdenModal
        open={fechaPending !== null}
        title="Fecha de la orden"
        confirmLabel={
          fechaPending?.kind === "enviar" ? "Continuar y enviar" : "Continuar y generar"
        }
        onClose={() => setFechaPending(null)}
        onConfirm={(fecha) => void handleFechaConfirm(fecha)}
      />

      <EnvioResultadoModal
        open={envioResultado !== null}
        items={envioResultado?.items ?? []}
        omitidosSinEmail={envioResultado?.omitidosSinEmail ?? 0}
        onClose={() => setEnvioResultado(null)}
        onVerHistorial={() => setTab("historial")}
      />

      <ConfirmDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        confirmLabel={confirmDialog?.confirmLabel}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const action = confirmDialog?.onConfirm;
          setConfirmDialog(null);
          void action?.();
        }}
      />
          </div>
        )}
      </div>
    </div>
  );
}
