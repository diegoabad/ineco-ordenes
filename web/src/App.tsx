import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useAuth, type AppModuleId } from "./auth/AuthContext";
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
import { loadLastModule, saveLastModule } from "./lib/lastModuleStorage";
import { FechaOrdenModal } from "./components/FechaOrdenModal";
import { HistorialEnviosPanel } from "./components/HistorialEnviosPanel";
import { LoginPage } from "./components/LoginPage";
import { MedicoFormModal } from "./components/MedicoFormModal";
import {
  OrdenEmailPreviewModal,
  type OrdenEmailDraft,
} from "./components/OrdenEmailPreviewModal";
import { PacienteFormModal } from "./components/PacienteFormModal";
import { PresupuestosModule } from "./components/PresupuestosModule";
import { PamiModule } from "./components/PamiModule";
import { BuscaTurnoModule } from "./components/BuscaTurnoModule";
import { UsuariosPanel } from "./components/UsuariosPanel";
import { PedidosSistemaPanel } from "./components/PedidosSistemaPanel";
import { ScrollableAppTabs } from "./components/ScrollableAppTabs";
import { ViewDetailModal } from "./components/ViewDetailModal";
import { firmaSrc, firmaToDataUrlForPdf } from "./lib/firma";
import { copiarLinkFirma } from "./lib/firmaLink";
import { formatNombrePersona } from "./lib/nombrePersona";
import { subscribeFirmaActualizada } from "./lib/firmaSync";
import { abrirPdfEnPestana } from "./lib/pdfViewer";
import { generarPdfRecetas, pdfBlobFromDoc } from "./pdf/generarRecetaPdf";
import {
  createMedico,
  createPaciente,
  deleteFirmaMedico,
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
    nombre: formatNombrePersona(m.nombre),
    especialidad: m.especialidad,
    matricula: m.matricula,
    firmaUrl: m.firmaUrl,
    firmaDataUrl: firmaDataUrl ?? null,
  };
}

function firstAllowedModule(
  canAccess: (m: AppModuleId) => boolean,
): AppModule {
  const order: AppModule[] = [
    "ordenes",
    "presupuestos",
    "pami",
    "busca-turno",
    "pedidos-sistema",
    "usuarios",
  ];
  return order.find((m) => canAccess(m)) ?? "ordenes";
}

export default function App() {
  const { user, loading: authLoading, logout, canAccessModule } = useAuth();
  const allowedModules = useMemo(() => {
    const all: AppModule[] = [
      "ordenes",
      "presupuestos",
      "pami",
      "busca-turno",
      "pedidos-sistema",
      "usuarios",
    ];
    return all.filter((m) => canAccessModule(m));
  }, [canAccessModule]);

  const [module, setModule] = useState<AppModule>("ordenes");
  const skipModulePersist = useRef(false);
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
  const [ordenEmailSession, setOrdenEmailSession] = useState<{
    list: Paciente[];
    fecha: string;
    index: number;
    draft: OrdenEmailDraft | null;
    results: EnvioResultadoItem[];
    omitidosSinEmail: number;
    preparing: boolean;
  } | null>(null);

  // Restaurar última sección usada por este usuario
  useEffect(() => {
    if (!user) return;
    const saved = loadLastModule(user.id);
    const next: AppModule =
      saved && canAccessModule(saved)
        ? saved
        : canAccessModule(module)
          ? module
          : firstAllowedModule(canAccessModule);
    skipModulePersist.current = true;
    setModule(next);
    saveLastModule(user.id, next);
    // Solo al cambiar de usuario (login / refresh de sesión)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Guardar sección actual por usuario
  useEffect(() => {
    if (!user) return;
    if (skipModulePersist.current) {
      skipModulePersist.current = false;
      return;
    }
    if (!canAccessModule(module)) return;
    saveLastModule(user.id, module);
  }, [user, module, canAccessModule]);

  useEffect(() => {
    if (!user) return;
    if (!canAccessModule(module)) {
      setModule(firstAllowedModule(canAccessModule));
    }
  }, [user, module, canAccessModule]);

  const medicoPorDefecto =
    medicos.find((m) => m.id === medicoSeleccionadoId && m.activo) ??
    medicos.find((m) => m.activo) ??
    null;

  const pacientesActivos = pacientes.filter((p) => p.activo);

  const cargarDatos = useCallback(async () => {
    if (!canAccessModule("ordenes")) {
      setLoading(false);
      setLoadError("");
      return;
    }
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
  }, [canAccessModule]);

  useEffect(() => {
    if (!user) return;
    void cargarDatos();
  }, [user, cargarDatos]);

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
    return formatNombrePersona(medicos.find((m) => m.id === medicoId)?.nombre ?? "");
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
        ? `¿Desactivar a ${formatNombrePersona(paciente.paciente)}? Va a salir de la lista de activos, pero el historial se conserva.`
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
          ? `El paciente ${formatNombrePersona(afectados[0]!.paciente)} pasará a usar el profesional por defecto.`
          : `${afectados.length} pacientes que lo tienen asignado pasarán a usar el profesional por defecto.`;

    setConfirmDialog({
      title: "Desactivar profesional",
      message: `¿Desactivar a ${formatNombrePersona(medico.nombre)}? ${avisoPacientes}`,
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
          `No hay profesional para "${formatNombrePersona(p.paciente)}". Asignale uno en el paciente o elegí un profesional por defecto.`,
        );
        return;
      }
      const firmaDataUrl = await firmaToDataUrlForPdf(medico.firmaUrl);
      if (medico.firmaUrl && !firmaDataUrl) {
        firmasFaltantes.push(formatNombrePersona(medico.nombre));
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

  async function prepararOrdenEmailDraft(
    paciente: Paciente,
    fecha: string,
  ): Promise<OrdenEmailDraft> {
    if (!paciente.email?.trim()) {
      throw new Error("Este paciente no tiene email cargado");
    }
    if (!fecha) {
      throw new Error("Indicá la fecha de la orden.");
    }

    const medico = medicoParaPaciente(paciente);
    if (!medico) {
      throw new Error(
        `No hay profesional para "${formatNombrePersona(paciente.paciente)}". Asignale uno o elegí un profesional por defecto.`,
      );
    }

    const firmaDataUrl = await firmaToDataUrlForPdf(medico.firmaUrl);
    if (medico.firmaUrl && !firmaDataUrl) {
      toast.warning(
        `No se encontró la firma de ${formatNombrePersona(medico.nombre)}. El PDF se enviará sin firma.`,
      );
    }

    const doc = generarPdfRecetas(
      [{ paciente, medico: toConfigMedico(medico, firmaDataUrl) }],
      fecha,
    );
    const blob = pdfBlobFromDoc(doc);
    const pdfBase64 = await blobToBase64(blob);
    const filename = `orden-${paciente.paciente.replace(/\s+/g, "-") || "paciente"}-${fecha}.pdf`;

    return {
      paciente,
      medicoNombre: formatNombrePersona(medico.nombre),
      especialidad: medico.especialidad,
      matricula: medico.matricula,
      fecha,
      pdfBase64,
      filename,
    };
  }

  function finalizarOrdenEmailSession(
    results: EnvioResultadoItem[],
    omitidosSinEmail: number,
  ) {
    setOrdenEmailSession(null);
    setEnviandoTodas(false);
    setHistorialRefresh((n) => n + 1);

    const enviados = results.filter((r) => r.ok).length;
    const fallidos = results.length - enviados;

    if (results.length === 0) {
      return;
    }

    if (results.length === 1) {
      const item = results[0]!;
      if (item.ok) {
        toast.success(`El mail se envió correctamente a ${item.email}`);
      } else {
        toast.error(item.errorMessage || "No se pudo enviar el mail.");
      }
      return;
    }

    if (enviados > 0 && fallidos === 0) {
      toast.success(
        `Se enviaron correctamente los ${enviados} mail${enviados === 1 ? "" : "s"}` +
          (omitidosSinEmail > 0 ? ` (${omitidosSinEmail} sin email, omitidos)` : ""),
      );
    } else if (enviados > 0) {
      toast.warning(`Listo: ${enviados} enviados, ${fallidos} fallaron. Mirá el detalle.`);
    } else {
      toast.error(`No se pudo enviar ningún mail (${fallidos} fallaron). Mirá el detalle.`);
    }

    setEnvioResultado({ items: results, omitidosSinEmail });
  }

  async function cargarDraftOrdenEmail(
    list: Paciente[],
    fecha: string,
    index: number,
    results: EnvioResultadoItem[],
    omitidosSinEmail: number,
  ) {
    const paciente = list[index];
    if (!paciente) {
      finalizarOrdenEmailSession(results, omitidosSinEmail);
      return;
    }

    setOrdenEmailSession({
      list,
      fecha,
      index,
      draft: null,
      results,
      omitidosSinEmail,
      preparing: true,
    });
    setEnviandoTodas(true);

    const toastId = toast.loading(
      list.length > 1
        ? `Preparando email… (${index + 1}/${list.length})`
        : "Preparando email…",
    );

    try {
      const draft = await prepararOrdenEmailDraft(paciente, fecha);
      toast.dismiss(toastId);
      setOrdenEmailSession({
        list,
        fecha,
        index,
        draft,
        results,
        omitidosSinEmail,
        preparing: false,
      });
    } catch (error) {
      toast.dismiss(toastId);
      const nextResults: EnvioResultadoItem[] = [
        ...results,
        {
          pacienteNombre: formatNombrePersona(paciente.paciente),
          email: paciente.email.trim(),
          ok: false,
          errorMessage:
            error instanceof Error ? error.message : "No se pudo preparar el envío",
        },
      ];
      if (index + 1 < list.length) {
        await cargarDraftOrdenEmail(list, fecha, index + 1, nextResults, omitidosSinEmail);
      } else {
        finalizarOrdenEmailSession(nextResults, omitidosSinEmail);
      }
    }
  }

  function solicitarImprimir(list: Paciente[]) {
    if (list.length === 0) return;
    setFechaPending({ kind: "imprimir", list });
  }

  function solicitarEnviar(list: Paciente[]) {
    if (enviandoTodas || ordenEmailSession) {
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

  async function handleFechaConfirm(fecha: string) {
    const pending = fechaPending;
    setFechaPending(null);
    if (!pending) return;

    if (pending.kind === "imprimir") {
      await imprimirOrdenes(pending.list, fecha);
      return;
    }

    const conEmail = pending.list.filter((p) => p.email?.trim());
    const omitidosSinEmail = pending.list.length - conEmail.length;
    if (conEmail.length === 0) {
      toast.warning("Ningún paciente tiene email cargado.");
      return;
    }

    await cargarDraftOrdenEmail(conEmail, fecha, 0, [], omitidosSinEmail);
  }

  function handleOrdenEmailSent(result: { to: string }) {
    const session = ordenEmailSession;
    if (!session) return;

    const paciente = session.list[session.index];
    const nextResults: EnvioResultadoItem[] = [
      ...session.results,
      {
        pacienteNombre: formatNombrePersona(paciente?.paciente ?? "") || "Paciente",
        email: result.to,
        ok: true,
      },
    ];

    if (session.index + 1 < session.list.length) {
      void cargarDraftOrdenEmail(
        session.list,
        session.fecha,
        session.index + 1,
        nextResults,
        session.omitidosSinEmail,
      );
      return;
    }

    finalizarOrdenEmailSession(nextResults, session.omitidosSinEmail);
  }

  function handleOrdenEmailFailed(errorMessage: string) {
    const session = ordenEmailSession;
    if (!session) return;

    const paciente = session.list[session.index];
    const nextResults: EnvioResultadoItem[] = [
      ...session.results,
      {
        pacienteNombre: formatNombrePersona(paciente?.paciente ?? "") || "Paciente",
        email: paciente?.email.trim() ?? "",
        ok: false,
        errorMessage,
      },
    ];

    if (session.index + 1 < session.list.length) {
      toast.warning(
        `No se pudo enviar a ${formatNombrePersona(paciente?.paciente ?? "") || "paciente"}: ${errorMessage}`,
      );
      void cargarDraftOrdenEmail(
        session.list,
        session.fecha,
        session.index + 1,
        nextResults,
        session.omitidosSinEmail,
      );
      return;
    }

    finalizarOrdenEmailSession(nextResults, session.omitidosSinEmail);
  }

  function handleOrdenEmailCancel() {
    const session = ordenEmailSession;
    if (!session) return;
    finalizarOrdenEmailSession(session.results, session.omitidosSinEmail);
  }

  const puedeImprimir = Boolean(
    medicoPorDefecto || pacientesActivos.some((p) => p.medicoId),
  );
  const emailFlowActive = enviandoTodas || ordenEmailSession !== null;
  const pacientesConEmail = pacientesActivos.filter((p) => p.email?.trim()).length;
  const puedeEnviarTodas = pacientesConEmail > 0 && puedeImprimir && !emailFlowActive;

  const sidebar = (
    <AppSidebar
      module={module}
      onModuleChange={setModule}
      allowedModules={allowedModules}
      userName={user?.nombre}
      onLogout={() => void logout()}
    />
  );

  if (authLoading) {
    return (
      <div className="auth-page">
        <p className="auth-page__loading">Cargando sesión…</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (loading && module === "ordenes") {
    return (
      <div className="app-layout">
        {sidebar}
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

  if (loadError && module === "ordenes") {
    return (
      <div className="app-layout">
        {sidebar}
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
      {sidebar}
      <div className="app-main">
        {module === "presupuestos" ? (
          <PresupuestosModule />
        ) : module === "pami" ? (
          <PamiModule />
        ) : module === "busca-turno" ? (
          <BuscaTurnoModule />
        ) : module === "pedidos-sistema" ? (
          <PedidosSistemaPanel />
        ) : module === "usuarios" ? (
          <UsuariosPanel />
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
                : emailFlowActive
                  ? ordenEmailSession?.preparing
                    ? "Preparando email…"
                    : "Revisá el email antes de enviar"
                  : `Enviar órdenes por mail (${pacientesConEmail})`
            }
            onClick={() => solicitarEnviar(pacientesActivos)}
          >
            <IconMail size={16} />
            {emailFlowActive
              ? ordenEmailSession?.preparing
                ? "Preparando…"
                : "Revisando email…"
              : "Enviar todas"}
          </button>
        </div>
      </header>

      <ScrollableAppTabs aria-label="Secciones">
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
      </ScrollableAppTabs>

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
                          <span className="fl-texto-principal">{formatNombrePersona(p.paciente)}</span>
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
                                emailFlowActive ||
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
                            title={formatNombrePersona(m.nombre)}
                          >
                            <span className="fl-texto-truncado">{formatNombrePersona(m.nombre)}</span>
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
                { label: "Nombre", value: formatNombrePersona(viewingPaciente.paciente) },
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
                { label: "Nombre", value: formatNombrePersona(viewingMedico.nombre) },
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
          fechaPending?.kind === "enviar" ? "Continuar y revisar email" : "Continuar y generar"
        }
        onClose={() => setFechaPending(null)}
        onConfirm={(fecha) => void handleFechaConfirm(fecha)}
      />

      <OrdenEmailPreviewModal
        open={ordenEmailSession?.draft != null && !ordenEmailSession.preparing}
        draft={ordenEmailSession?.draft ?? null}
        queueLabel={
          ordenEmailSession && ordenEmailSession.list.length > 1
            ? `${ordenEmailSession.index + 1} de ${ordenEmailSession.list.length}`
            : null
        }
        onClose={handleOrdenEmailCancel}
        onSent={handleOrdenEmailSent}
        onFailed={handleOrdenEmailFailed}
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
