import { useEffect, useRef, useState } from "react";
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
  const [medico, setMedico] = useState<MedicoFirmaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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

  async function guardar() {
    if (!medicoId || !padRef.current || padRef.current.isEmpty()) {
      toast.warning("Dibujá tu firma antes de guardar.");
      return;
    }

    setSaving(true);
    setError("");

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
    <div className="firmar-page">
      <div className="firmar-card">
        <header className="firmar-card__header">
          <span className="app-logo">INECO</span>
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

        <div className="signature-pad-wrap">
          <SignatureCanvas
            ref={padRef}
            penColor="#111827"
            canvasProps={{
              className: "signature-pad",
              "aria-label": "Área para dibujar la firma",
            }}
          />
        </div>

        <div className="firmar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => padRef.current?.clear()}
            disabled={saving}
          >
            Borrar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>
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
