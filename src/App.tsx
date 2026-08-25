import { useEffect, useState } from "react";
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
import { fechaHoyIso } from "./lib/fechas";
import { abrirPdfEnPestana } from "./lib/pdfViewer";
import { resumenPrestaciones } from "./lib/prestaciones";
import { generarPdfRecetas, pdfBlobFromDoc } from "./pdf/generarRecetaPdf";
import {
  loadMedicoSeleccionadoId,
  loadMedicos,
  loadPacientes,
  newId,
  saveMedicoSeleccionadoId,
  saveMedicos,
  savePacientes,
} from "./storage";
import type { ConfigMedico, Medico, MedicoFormData, Paciente, PacienteFormData } from "./types";

type Tab = "pacientes" | "medicos";

function toConfigMedico(m: Medico): ConfigMedico {
  return {
    nombre: m.nombre,
    especialidad: m.especialidad,
    matricula: m.matricula,
    firmaDataUrl: m.firmaDataUrl,
  };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("pacientes");
  const [pacientes, setPacientes] = useState<Paciente[]>(() => loadPacientes());
  const [medicos, setMedicos] = useState<Medico[]>(() => loadMedicos());
  const [medicoSeleccionadoId, setMedicoSeleccionadoId] = useState<string | null>(() =>
    loadMedicoSeleccionadoId(loadMedicos()),
  );
  const [fechaOrden, setFechaOrden] = useState(fechaHoyIso);
  const [busquedaPacientes, setBusquedaPacientes] = useState("");
  const [busquedaMedicos, setBusquedaMedicos] = useState("");

  const [pacienteFormOpen, setPacienteFormOpen] = useState(false);
  const [editingPaciente, setEditingPaciente] = useState<Paciente | null>(null);
  const [medicoFormOpen, setMedicoFormOpen] = useState(false);
  const [editingMedico, setEditingMedico] = useState<Medico | null>(null);

  const medicoPorDefecto =
    medicos.find((m) => m.id === medicoSeleccionadoId) ?? medicos[0] ?? null;

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
        [p.paciente, p.obraSocial, p.afiliado, p.prestacion, nombreMedico(p.medicoId)]
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

  useEffect(() => {
    savePacientes(pacientes);
  }, [pacientes]);

  useEffect(() => {
    saveMedicos(medicos);
  }, [medicos]);

  useEffect(() => {
    saveMedicoSeleccionadoId(medicoSeleccionadoId);
  }, [medicoSeleccionadoId]);

  useEffect(() => {
    if (medicoSeleccionadoId && !medicos.some((m) => m.id === medicoSeleccionadoId)) {
      setMedicoSeleccionadoId(medicos[0]?.id ?? null);
    }
  }, [medicos, medicoSeleccionadoId]);

  function handleSavePaciente(data: PacienteFormData, id?: string) {
    if (id) {
      setPacientes((prev) => prev.map((p) => (p.id === id ? { ...data, id } : p)));
    } else {
      setPacientes((prev) => [...prev, { ...data, id: newId() }]);
    }
    setPacienteFormOpen(false);
    setEditingPaciente(null);
  }

  function handleDeletePaciente(id: string) {
    if (!confirm("¿Eliminar este paciente?")) return;
    setPacientes((prev) => prev.filter((p) => p.id !== id));
  }

  function handleSaveMedico(data: MedicoFormData, id?: string) {
    if (id) {
      setMedicos((prev) => prev.map((m) => (m.id === id ? { ...data, id } : m)));
    } else {
      const nuevo = { ...data, id: newId() };
      setMedicos((prev) => [...prev, nuevo]);
      if (!medicoSeleccionadoId) setMedicoSeleccionadoId(nuevo.id);
    }
    setMedicoFormOpen(false);
    setEditingMedico(null);
  }

  function handleDeleteMedico(id: string) {
    if (!confirm("¿Eliminar este médico?")) return;
    setMedicos((prev) => prev.filter((m) => m.id !== id));
    setPacientes((prev) =>
      prev.map((p) => (p.medicoId === id ? { ...p, medicoId: null } : p)),
    );
  }

  function imprimirOrdenes(list: Paciente[]) {
    if (list.length === 0) return;
    if (!fechaOrden) {
      alert("Indicá la fecha de la orden.");
      return;
    }

    let pendientes = list;

    // Un solo paciente sin médico: ofrecer asignar el por defecto
    if (list.length === 1) {
      const p = list[0]!;
      const tieneAsignado = Boolean(p.medicoId && medicos.some((m) => m.id === p.medicoId));
      if (!tieneAsignado) {
        if (!medicoPorDefecto) {
          alert("Seleccioná un médico por defecto o asignale uno al paciente.");
          return;
        }
        const asignar = confirm(
          `"${p.paciente}" no tiene médico asignado.\n\n¿Asignarle a ${medicoPorDefecto.nombre}?`,
        );
        if (asignar) {
          const actualizado = { ...p, medicoId: medicoPorDefecto.id };
          setPacientes((prev) => prev.map((x) => (x.id === p.id ? actualizado : x)));
          pendientes = [actualizado];
        }
      }
    }

    const items: { paciente: Paciente; medico: ConfigMedico }[] = [];
    for (const p of pendientes) {
      const medico = medicoParaPaciente(p);
      if (!medico) {
        alert(
          `No hay médico para "${p.paciente}". Asignale uno en el paciente o elegí un médico por defecto.`,
        );
        return;
      }
      items.push({ paciente: p, medico: toConfigMedico(medico) });
    }

    const doc = generarPdfRecetas(items, fechaOrden);
    abrirPdfEnPestana(pdfBlobFromDoc(doc));
  }

  const puedeImprimir = Boolean(medicoPorDefecto || pacientes.some((p) => p.medicoId));

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
            onClick={() => imprimirOrdenes(pacientes)}
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
            onChange={(e) => setMedicoSeleccionadoId(e.target.value || null)}
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
                    placeholder="Buscar paciente, médico, obra social…"
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
                            <td>
                              <span
                                className="fl-texto-truncado"
                                title={p.prestacion}
                              >
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
                                  onClick={() => imprimirOrdenes([p])}
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
                                  onClick={() => handleDeletePaciente(p.id)}
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
                          className={
                            m.id === medicoSeleccionadoId ? "is-selected-row" : undefined
                          }
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
                            {m.firmaDataUrl ? (
                              <img src={m.firmaDataUrl} alt="Firma" className="firma-preview" />
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
                                onClick={() => handleDeleteMedico(m.id)}
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
        onClose={() => {
          setMedicoFormOpen(false);
          setEditingMedico(null);
        }}
        onSave={handleSaveMedico}
      />
    </div>
  );
}
