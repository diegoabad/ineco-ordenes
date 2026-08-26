import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "react-toastify";
import { apiFetch } from "../config/api";
import { notificarFirmaActualizada } from "../lib/firmaSync";
import type { Medico } from "../types";

type MedicoFirmaInfo = {
  id: string;
  nombre: string;
  especialidad: string;
  tieneFirma: boolean;
};

export default function FirmarPage() {
  const { medicoId } = useParams<{ medicoId: string }>();
  const padRef = useRef<SignatureCanvas>(null);
  const padWrapRef = useRef<HTMLDivElement>(null);
  const padSizeRef = useRef({ w: 0, h: 0 });
  const [medico, setMedico] = useState<MedicoFirmaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [firmaVaciaError, setFirmaVaciaError] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!medicoId) {
      setError("Link inválido");
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<{ ok: boolean; data: MedicoFirmaInfo }>(
          `/api/medicos/${encodeURIComponent(medicoId)}/firma-info`,
        );
        if (cancelled) return;
        setMedico(res.data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "No se encontró el médico");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [medicoId]);

  const resizePad = useCallback(() => {
    const pad = padRef.current;
    const wrap = padWrapRef.current;
    if (!pad || !wrap) return;

    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width < 1 || height < 1) return;
    if (padSizeRef.current.w === width && padSizeRef.current.h === height) return;
    padSizeRef.current = { w: width, h: height };

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const canvas = pad.getCanvas();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
    }

    pad.clear();
  }, []);

  useEffect(() => {
    if (!medico || loading || ok) return;

    const run = () => requestAnimationFrame(() => resizePad());
    run();

    const wrap = padWrapRef.current;
    const ro = new ResizeObserver(run);
    if (wrap) ro.observe(wrap);

    window.addEventListener("resize", run);
    window.addEventListener("orientationchange", run);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", run);
      window.removeEventListener("orientationchange", run);
    };
  }, [medico, loading, ok, resizePad]);

  async function guardar() {
    if (!medicoId || !padRef.current || padRef.current.isEmpty()) {
      setFirmaVaciaError(true);
      toast.warning("No se puede guardar una firma vacía. Dibujá tu firma en el recuadro.");
      return;
    }

    setSaving(true);
    setError("");
    setFirmaVaciaError(false);

    try {
      const canvas = padRef.current.getCanvas();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("No se pudo generar la imagen");

      const form = new FormData();
      form.append("firma", blob, "firma.png");

      const res = await apiFetch<{ ok: boolean; data: Medico }>(
        `/api/medicos/${encodeURIComponent(medicoId)}/firma`,
        {
          method: "POST",
          body: form,
        },
      );

      notificarFirmaActualizada(res.data);
      setOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la firma");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="firmar-page">
        <p>Cargando…</p>
      </div>
    );
  }

  if (error && !medico) {
    return (
      <div className="firmar-page">
        <div className="firmar-card">
          <h1>No se pudo abrir</h1>
          <p className="text-muted">{error}</p>
          <Link to="/" className="btn btn-secondary">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  if (ok) {
    return (
      <div className="firmar-page">
        <div className="firmar-card firmar-card--success">
          <h1>Firma guardada</h1>
          <p>Gracias, {medico?.nombre}. Tu firma quedó registrada correctamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="firmar-page firmar-page--sign">
      <div className="firmar-card firmar-card--sign">
        <header className="firmar-card__header">
          <div>
            <h1>Firma digital</h1>
            <p className="text-muted">
              {medico?.nombre}
              {medico?.especialidad ? ` · ${medico.especialidad}` : ""}
            </p>
          </div>
        </header>

        {medico?.tieneFirma ? (
          <p className="firmar-hint">
            Ya hay una firma cargada. Si guardás de nuevo, se reemplaza.
          </p>
        ) : null}

        <div
          className={`signature-pad-wrap${firmaVaciaError ? " signature-pad-wrap--error" : ""}`}
          ref={padWrapRef}
        >
          <SignatureCanvas
            ref={padRef}
            penColor="#111827"
            minWidth={1.2}
            maxWidth={2.8}
            velocityFilterWeight={0.7}
            onBegin={() => setFirmaVaciaError(false)}
            canvasProps={{
              className: "signature-pad",
              "aria-label": "Área para dibujar la firma",
              "aria-invalid": firmaVaciaError,
            }}
          />
        </div>

        {firmaVaciaError ? (
          <p className="firmar-error firmar-error--inline" role="alert">
            No se puede guardar una firma vacía. Dibujá tu firma en el recuadro de arriba.
          </p>
        ) : null}

        <div className="firmar-actions">
          <button
            type="button"
            className="btn btn-secondary btn-firmar"
            onClick={() => {
              padRef.current?.clear();
              setFirmaVaciaError(false);
            }}
            disabled={saving}
          >
            Borrar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-firmar"
            onClick={() => void guardar()}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Guardar firma"}
          </button>
        </div>

        {error ? <p className="firmar-error">{error}</p> : null}

        <p className="firmar-footnote text-muted">
          Usá el mouse, el dedo o un lápiz sobre la pantalla táctil.
        </p>
      </div>
    </div>
  );
}
