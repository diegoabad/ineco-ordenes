import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useAuth } from "../../auth/AuthContext";
import type { GestionProfesionalSection } from "../../lib/appNav";
import { GESTION_PROFESIONAL_SECTIONS } from "../../lib/appNav";
import {
  fetchGestionProfesional,
  saveGestionProfesional,
  snapshotGestion,
  type GestionCatalogo,
  type GestionProfesionalConfig,
} from "../../lib/gestionProfesional";
import { LoadingBlock } from "../InecoMark";
import { CategoriasGestion, DepartamentosGestion } from "./EstructuraGestion";
import { CuadroPrecios } from "./CuadroPrecios";
import { ProfesionalesGestion } from "./ProfesionalesGestion";
import { TratamientosGestion } from "./TratamientosGestion";

type Props = {
  section: GestionProfesionalSection;
  onSectionChange: (section: GestionProfesionalSection) => void;
  onIrABuscaTurno?: () => void;
};

const CATALOGO_VACIO: GestionCatalogo = { profesionales: [], tratamientos: [] };

const SUBTITULOS: Record<GestionProfesionalSection, string> = {
  cuadro: "Precios por categoría. En verde, 1 cuota. En azul, 3 cuotas.",
  profesionales: "Los mismos profesionales de Busca turno. Elegí cuáles aparecen y asignales categoría y departamento.",
  tratamientos: "Prestaciones de Busca turno. Indicá el departamento y el precio de cada categoría.",
  departamentos: "Áreas como Fonoaudiología o Infanto. El código es el que se ve en el cuadro.",
  categorias: "Cada categoría es una columna del cuadro de precios.",
};

export function GestionProfesionalModule({ section, onSectionChange, onIrABuscaTurno }: Props) {
  const { canAccessModule } = useAuth();
  const [config, setConfig] = useState<GestionProfesionalConfig | null>(null);
  const [catalogo, setCatalogo] = useState<GestionCatalogo>(CATALOGO_VACIO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedJson, setSavedJson] = useState("");
  const [edicion, setEdicion] = useState<{ codigo: string; nonce: number } | null>(null);
  const req = useRef(0);
  const configRef = useRef<GestionProfesionalConfig | null>(null);
  const savedJsonRef = useRef("");

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    savedJsonRef.current = savedJson;
  }, [savedJson]);

  const dirty = config != null && snapshotGestion(config) !== savedJson;

  const persist = useCallback(async (sent: GestionProfesionalConfig) => {
    const id = ++req.current;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await saveGestionProfesional(sent);
      if (id !== req.current) return;
      setSavedJson(snapshotGestion(saved));
      setConfig((prev) => {
        if (!prev || snapshotGestion(prev) === snapshotGestion(sent)) return saved;
        return prev;
      });
    } catch (error) {
      if (id !== req.current) return;
      const message = error instanceof Error ? error.message : "No se pudo guardar";
      setSaveError(message);
      toast.error(message);
    } finally {
      if (id === req.current) setSaving(false);
    }
  }, []);

  const cargar = useCallback(async (modo: "inicial" | "catalogo") => {
    if (modo === "inicial") setLoading(true);
    try {
      const data = await fetchGestionProfesional();
      setCatalogo(data.catalogo);
      const local = configRef.current;
      const pendiente = local != null && snapshotGestion(local) !== savedJsonRef.current;
      if (modo === "catalogo" && pendiente) {
        toast.success("Catálogo actualizado. Los cambios de esta pantalla siguen acá.");
        return;
      }
      setConfig(data.config);
      setSavedJson(snapshotGestion(data.config));
      setSaveError("");
      if (modo === "catalogo") toast.success("Catálogo actualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar Gestión profesional");
    } finally {
      if (modo === "inicial") setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar("inicial");
  }, [cargar]);

  useEffect(() => {
    if (!config || loading) return;
    if (snapshotGestion(config) === savedJson) return;
    const timer = window.setTimeout(() => {
      void persist(config);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [config, loading, persist, savedJson]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const onBefore = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty, saving]);

  const sectionLabel =
    GESTION_PROFESIONAL_SECTIONS.find((item) => item.id === section)?.label ?? "Gestión profesional";
  const catalogoVacio = catalogo.profesionales.length === 0 && catalogo.tratamientos.length === 0;

  function editarTratamiento(codigo: string) {
    setEdicion({ codigo, nonce: Date.now() });
    onSectionChange("tratamientos");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>{sectionLabel}</h1>
            <p>{SUBTITULOS[section]}</p>
          </div>
        </div>
        <div className="app-header__actions">
          <span className={`gp-save${saveError ? " is-error" : dirty ? " is-dirty" : ""}`}>
            {!config
              ? ""
              : saving
                ? "Guardando…"
                : saveError
                  ? "No se pudo guardar"
                  : dirty
                    ? "Cambios sin guardar"
                    : "Guardado"}
          </span>
          {saveError && config ? (
            <button type="button" className="btn btn-secondary" onClick={() => void persist(config)}>
              Reintentar
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void cargar("catalogo")}
            disabled={loading || saving}
          >
            Actualizar catálogo
          </button>
        </div>
      </header>

      {loading || !config ? (
        <div className="fl-table-empty">
          <LoadingBlock label="Cargando gestión profesional…" />
        </div>
      ) : (
        <>
          {catalogoVacio ? (
            <div className="gp-banner">
              <p>
                Busca turno todavía no tiene un catálogo guardado. Sin eso no aparecen profesionales
                ni tratamientos.
              </p>
              {canAccessModule("busca-turno") && onIrABuscaTurno ? (
                <button type="button" className="btn btn-secondary" onClick={onIrABuscaTurno}>
                  Ir a Busca turno
                </button>
              ) : null}
            </div>
          ) : null}

          {section === "cuadro" ? (
            <CuadroPrecios config={config} catalogo={catalogo} onEditar={editarTratamiento} />
          ) : null}
          {section === "profesionales" ? (
            <ProfesionalesGestion config={config} catalogo={catalogo} onChange={setConfig} />
          ) : null}
          {section === "tratamientos" ? (
            <TratamientosGestion
              config={config}
              catalogo={catalogo}
              onChange={setConfig}
              edicion={edicion}
            />
          ) : null}
          {section === "departamentos" ? (
            <DepartamentosGestion config={config} onChange={setConfig} />
          ) : null}
          {section === "categorias" ? (
            <CategoriasGestion config={config} onChange={setConfig} />
          ) : null}
        </>
      )}
    </div>
  );
}
