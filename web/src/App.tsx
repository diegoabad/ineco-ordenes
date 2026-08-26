import { useCallback, useEffect, useState } from "react";
import { DatePicker } from "./components/DatePicker";
import {
  IconFile,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconTrash,
} from "./components/Icons";
import { MedicoFormModal } from "./components/MedicoFormModal";
import { PacienteFormModal } from "./components/PacienteFormModal";
import { firmaSrc, firmaToDataUrl } from "./lib/firma";
import { fechaHoyIso } from "./lib/fechas";
import { abrirPdfEnPestana } from "./lib/pdfViewer";
import { resumenPrestaciones } from "./lib/prestaciones";
import { generarPdfRecetas, pdfBlobFromDoc } from "./pdf/generarRecetaPdf";
import {
  createMedico,
  createPaciente,
  deleteFirmaMedico,
  deleteMedico,
  deletePaciente,
  fetchDb,
  saveMedicoSeleccionadoId,
  updateMedico,
  updatePaciente,
  uploadFirmaMedico,
} from "./services/dataService";
import type {
  ConfigMedico,
  Medico,
  MedicoSavePayload,
  Paciente,
  PacienteFormData,
} from "./types";

type Tab = "pacientes" | "medicos";

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
  const [tab, setTab] = useState<Tab>("pacientes");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [medicoSeleccionadoId, setMedicoSeleccionadoId] = useState<string | null>(null);
  const [fechaOrden, setFechaOrden] = useState(fechaHoyIso);
  const [busquedaPacientes, setBusquedaPacientes] = useState("");
  const [busquedaMedicos, setBusquedaMedicos] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingMedico, setSavingMedico] = useState(false);

  const [pacienteFormOpen, setPacienteFormOpen] = useState(false);
  const [editingPaciente, setEditingPaciente] = useState<Paciente | null>(null);
  const [medicoFormOpen, setMedicoFormOpen] = useState(false);
  const [editingMedico, setEditingMedico] = useState<Medico | null>(null);

  const medicoPorDefecto =
    medicos.find((m) => m.id === medicoSeleccionadoId) ?? medicos[0] ?? null;

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

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  function nombreMedico(medicoId: string | null): string {
    if (!medicoId) return "";
    return medicos.find((m) => m.id === medicoId)?.nombre ?? "";
  }

  function medicoParaPaciente(p: Paciente): Medico | null {
    if (p.medicoId) {
      const asignado = medicos.find((m) => m.id === p.medicoId);
      if (asignado) return asignado;
    }
    return medicoPorDefecto;
  }

  const qPacientes = busquedaPacientes.trim().toLowerCase();
  const pacientesFiltrados = qPacientes
    ? pacientes.filter((p) =>
        [p.paciente, p.obraSocial, p.afiliado, p.prestacion, p.diagnostico, nombreMedico(p.medicoId)]
          .join(" ")
          .toLowerCase()
          .includes(qPacientes),
      )
    : pacientes;

  const qMedicos = busquedaMedicos.trim().toLowerCase();
  const medicosFiltrados = qMedicos
    ? medicos.filter((m) =>
        [m.nombre, m.especialidad, m.matricula].join(" ").toLowerCase().includes(qMedicos),
      )
    : medicos;

  async function handleMedicoSeleccionadoChange(id: string | null) {
    setMedicoSeleccionadoId(id);
    try {
      await saveMedicoSeleccionadoId(id);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo guardar el médico por defecto");
      void cargarDatos();
    }
  }

  async function handleSavePaciente(data: PacienteFormData, id?: string) {
    try {
      if (id) {
        const paciente = await updatePaciente(id, data);
        setPacientes((prev) => prev.map((p) => (p.id === id ? paciente : p)));
      } else {
        const paciente = await createPaciente(data);
        setPacientes((prev) => [...prev, paciente]);
      }
      setPacienteFormOpen(false);
      setEditingPaciente(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo guardar el paciente");
    }
  }

  async function handleDeletePaciente(id: string) {
    if (!confirm("¿Eliminar este paciente?")) return;
    try {
      await deletePaciente(id);
      setPacientes((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo eliminar el paciente");
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

      setMedicos((prev) => {
        const exists = prev.some((m) => m.id === medico.id);
        if (exists) return prev.map((m) => (m.id === medico.id ? medico : m));
        return [...prev, medico];
      });

      if (!medicoSeleccionadoId) {
        setMedicoSeleccionadoId(medico.id);
      }

      setMedicoFormOpen(false);
      setEditingMedico(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo guardar el médico");
    } finally {
      setSavingMedico(false);
    }
  }

  async function handleDeleteMedico(id: string) {
    if (!confirm("¿Eliminar este médico?")) return;
    try {
      await deleteMedico(id);
      setMedicos((prev) => prev.filter((m) => m.id !== id));
      setPacientes((prev) =>
        prev.map((p) => (p.medicoId === id ? { ...p, medicoId: null } : p)),
      );
      if (medicoSeleccionadoId === id) {
        const restante = medicos.find((m) => m.id !== id);
        await handleMedicoSeleccionadoChange(restante?.id ?? null);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo eliminar el médico");
    }
  }

  async function imprimirOrdenes(list: Paciente[]) {
    if (list.length === 0) return;
    if (!fechaOrden) {
      alert("Indicá la fecha de la orden.");
      return;
    }

    const items: { paciente: Paciente; medico: ConfigMedico }[] = [];
    for (const p of list) {
      const medico = medicoParaPaciente(p);
      if (!medico) {
        alert(
          `No hay médico para "${p.paciente}". Asignale uno en el paciente o elegí un médico por defecto.`,
        );
        return;
      }
      const firmaDataUrl = await firmaToDataUrl(medico.firmaUrl);
      items.push({ paciente: p, medico: toConfigMedico(medico, firmaDataUrl) });
    }

    const doc = generarPdfRecetas(items, fechaOrden);
    abrirPdfEnPestana(pdfBlobFromDoc(doc));
  }

  const puedeImprimir = Boolean(medicoPorDefecto || pacientes.some((p) => p.medicoId));

  if (loading) {
    return (
      <div className="app-shell">
        <div className="fl-table-empty fl-table-empty--fill">
          <p className="fl-table-empty__title">Cargando datos…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-shell">
        <div className="fl-table-empty fl-table-empty--fill">
          <p className="fl-table-empty__title">No se pudo conectar con la API</p>
          <p className="fl-table-empty__hint">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => void cargarDatos()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-logo">INECO</span>
          <div>
            <h1>Órdenes Ineco</h1>
            <p>Pacientes y médicos para generar órdenes</p>
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
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditingMedico(null);
                setMedicoFormOpen(true);
              }}
            >
              <IconPlus size={16} />
              Agregar médico
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pacientes.length === 0 || !puedeImprimir || !fechaOrden}
            onClick={() => void imprimirOrdenes(pacientes)}
          >
            <IconPrinter size={16} />
            Imprimir todas
          </button>
        </div>
      </header>

      <section className="card app-controls-row">
        <div className="app-controls-row__medico form-group">
          <label htmlFor="medico-seleccionado">Médico por defecto</label>
          <select
            id="medico-seleccionado"
            value={medicoSeleccionadoId ?? ""}
            onChange={(e) => void handleMedicoSeleccionadoChange(e.target.value || null)}
            disabled={medicos.length === 0}
          >
            {medicos.length === 0 ? (
              <option value="">Sin médicos — cargá uno en la pestaña Médicos</option>
            ) : (
              medicos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                  {m.especialidad ? ` · ${m.especialidad}` : ""}
                  {m.matricula ? ` · MN ${m.matricula}` : ""}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="app-controls-row__fecha form-group">
          <label htmlFor="fecha-orden">Fecha de la orden</label>
          <DatePicker
            id="fecha-orden"
            value={fechaOrden}
            onChange={setFechaOrden}
            compact
            aria-label="Fecha de la orden"
          />
        </div>
      </section>

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
          Médicos
        </button>
      </nav>

      {tab === "pacientes" ? (
        <section className="fl-table-card">
          {pacientes.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <div className="fl-table-empty__art">
                <IconFile size={32} />
              </div>
              <p className="fl-table-empty__title">No hay pacientes todavía</p>
              <p className="fl-table-empty__hint">
                Agregá el primero con el botón Agregar paciente.
              </p>
            </div>
          ) : (
            <>
              <div className="table-toolbar">
                <div className="table-search">
                  <span className="table-search__icon" aria-hidden>
                    <IconSearch size={16} />
                  </span>
                  <input
                    type="search"
                    value={busquedaPacientes}
                    onChange={(e) => setBusquedaPacientes(e.target.value)}
                    placeholder="Buscar paciente, médico, diagnóstico…"
                    aria-label="Buscar pacientes"
                  />
                </div>
              </div>
              {pacientesFiltrados.length === 0 ? (
                <div className="fl-table-empty">
                  <p className="fl-table-empty__title">Sin resultados</p>
                  <p className="fl-table-empty__hint">Proba con otro término de búsqueda.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th className="fl-col-medico">Médico</th>
                        <th>Obra Social</th>
                        <th>Afiliado</th>
                        <th className="fl-col-diagnostico">Diagnóstico</th>
                        <th>Prestación</th>
                        <th className="fl-col-actions">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pacientesFiltrados.map((p) => {
                        const medicoNombre = nombreMedico(p.medicoId);
                        return (
                          <tr key={p.id}>
                            <td>
                              <span className="fl-texto-principal">{p.paciente}</span>
                            </td>
                            <td className="fl-col-medico">
                              {medicoNombre ? (
                                <span className="fl-texto-truncado" title={medicoNombre}>
                                  {medicoNombre}
                                </span>
                              ) : (
                                <span className="text-muted" title="Usa el médico por defecto">
                                  Por defecto
                                </span>
                              )}
                            </td>
                            <td>{p.obraSocial || "—"}</td>
                            <td>{p.afiliado || "—"}</td>
                            <td className="fl-col-diagnostico">
                              <span className="fl-texto-truncado" title={p.diagnostico}>
                                {p.diagnostico || "—"}
                              </span>
                            </td>
                            <td>
                              <span className="fl-texto-truncado" title={p.prestacion}>
                                {resumenPrestaciones(p.prestacion) || "—"}
                              </span>
                            </td>
                            <td className="fl-col-actions">
                              <div className="fl-table-actions">
                                <button
                                  type="button"
                                  className="fl-icon-btn fl-icon-btn--accent"
                                  title="Imprimir orden"
                                  aria-label="Imprimir orden"
                                  disabled={!medicoParaPaciente(p) || !fechaOrden}
                                  onClick={() => void imprimirOrdenes([p])}
                                >
                                  <IconPrinter size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="fl-icon-btn"
                                  title="Editar"
                                  aria-label="Editar"
                                  onClick={() => {
                                    setEditingPaciente(p);
                                    setPacienteFormOpen(true);
                                  }}
                                >
                                  <IconPencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="fl-icon-btn fl-icon-btn--danger"
                                  title="Eliminar"
                                  aria-label="Eliminar"
                                  onClick={() => void handleDeletePaciente(p.id)}
                                >
                                  <IconTrash size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="fl-table-card">
          {medicos.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <div className="fl-table-empty__art">
                <IconFile size={32} />
              </div>
              <p className="fl-table-empty__title">No hay médicos todavía</p>
              <p className="fl-table-empty__hint">
                Agregá el primero con el botón Agregar médico.
              </p>
            </div>
          ) : (
            <>
              <div className="table-toolbar">
                <div className="table-search">
                  <span className="table-search__icon" aria-hidden>
                    <IconSearch size={16} />
                  </span>
                  <input
                    type="search"
                    value={busquedaMedicos}
                    onChange={(e) => setBusquedaMedicos(e.target.value)}
                    placeholder="Buscar médico, especialidad o matrícula…"
                    aria-label="Buscar médicos"
                  />
                </div>
              </div>
              {medicosFiltrados.length === 0 ? (
                <div className="fl-table-empty">
                  <p className="fl-table-empty__title">Sin resultados</p>
                  <p className="fl-table-empty__hint">Proba con otro término de búsqueda.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="fl-col-nombre">Nombre</th>
                        <th className="fl-col-especialidad">Especialidad</th>
                        <th className="fl-col-matricula">Matrícula</th>
                        <th className="fl-col-firma">Firma</th>
                        <th className="fl-col-actions">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medicosFiltrados.map((m) => (
                        <tr
                          key={m.id}
                          className={m.id === medicoSeleccionadoId ? "is-selected-row" : undefined}
                        >
                          <td className="fl-col-nombre">
                            <span className="fl-texto-principal fl-texto-truncado" title={m.nombre}>
                              {m.nombre}
                            </span>
                          </td>
                          <td className="fl-col-especialidad">
                            <span className="fl-texto-truncado" title={m.especialidad}>
                              {m.especialidad || "—"}
                            </span>
                          </td>
                          <td className="fl-col-matricula">{m.matricula || "—"}</td>
                          <td className="fl-col-firma">
                            {firmaSrc(m.firmaUrl) ? (
                              <img src={firmaSrc(m.firmaUrl)!} alt="Firma" className="firma-preview" />
                            ) : (
                              <span className="text-muted">Sin firma</span>
                            )}
                          </td>
                          <td className="fl-col-actions">
                            <div className="fl-table-actions">
                              <button
                                type="button"
                                className="fl-icon-btn"
                                title="Editar"
                                aria-label="Editar"
                                onClick={() => {
                                  setEditingMedico(m);
                                  setMedicoFormOpen(true);
                                }}
                              >
                                <IconPencil size={16} />
                              </button>
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--danger"
                                title="Eliminar"
                                aria-label="Eliminar"
                                onClick={() => void handleDeleteMedico(m.id)}
                              >
                                <IconTrash size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
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

      <MedicoFormModal
        open={medicoFormOpen}
        initial={editingMedico}
        saving={savingMedico}
        onClose={() => {
          setMedicoFormOpen(false);
          setEditingMedico(null);
        }}
        onSave={handleSaveMedico}
      />
    </div>
  );
}
