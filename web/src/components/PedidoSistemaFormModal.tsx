import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { createPedidoSistema } from "../services/dataService";
import type {
  PedidoSistema,
  PedidoSistemaPrioridad,
  PedidoSistemaSeccion,
} from "../types";
import { PEDIDO_PRIORIDAD_LABEL, PEDIDO_SECCION_LABEL } from "../types";
import { IconFile, IconTrash, IconUpload, IconX } from "./Icons";

type AdjuntoDraft = {
  key: string;
  nombre: string;
  mime: string;
  base64: string;
  previewUrl: string;
  isImage: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (pedido: PedidoSistema) => void;
};

const SECCIONES: PedidoSistemaSeccion[] = [
  "ordenes",
  "presupuestos",
  "pami",
  "busca-turno",
  "whatsapp",
  "nueva",
];

const PRIORIDADES: PedidoSistemaPrioridad[] = ["baja", "media", "alta"];
const MAX_ADJUNTOS = 8;
const MAX_BYTES = 8 * 1024 * 1024;

async function fileToDraft(file: File): Promise<AdjuntoDraft> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("No se pudo leer el archivo"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  const mime = file.type || "application/octet-stream";
  return {
    key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
    nombre: file.name,
    mime,
    base64,
    previewUrl: dataUrl,
    isImage: mime.startsWith("image/"),
  };
}

export function PedidoSistemaFormModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [seccion, setSeccion] = useState<PedidoSistemaSeccion>("ordenes");
  const [titulo, setTitulo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [prioridad, setPrioridad] = useState<PedidoSistemaPrioridad>("media");
  const [adjuntos, setAdjuntos] = useState<AdjuntoDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setSeccion("ordenes");
    setTitulo("");
    setDetalle("");
    setPrioridad("media");
    setAdjuntos([]);
    setSaving(false);
  }, [open]);

  if (!open) return null;

  const canSubmit = Boolean(titulo.trim() && detalle.trim()) && !saving;

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const next: AdjuntoDraft[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          toast.warning(`"${file.name}" supera 8 MB`);
          continue;
        }
        next.push(await fileToDraft(file));
      }
      setAdjuntos((prev) => [...prev, ...next].slice(0, MAX_ADJUNTOS));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los archivos");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const solicitadoPor =
      user?.nombre?.trim() || user?.email?.trim() || "";
    if (!titulo.trim() || !detalle.trim()) {
      toast.warning("Completá título y detalle");
      return;
    }
    if (!solicitadoPor) {
      toast.warning("No se pudo identificar el usuario logueado");
      return;
    }
    setSaving(true);
    try {
      const tituloTrim = titulo.trim();
      const created = await createPedidoSistema({
        seccion,
        seccionNueva: seccion === "nueva" ? tituloTrim : "",
        titulo: tituloTrim,
        detalle: detalle.trim(),
        solicitadoPor,
        prioridad,
        fotos: adjuntos.map((f) => ({
          base64: f.base64,
          nombre: f.nombre,
          mime: f.mime,
        })),
      });
      toast.success("Pedido creado");
      onCreated(created);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el pedido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fl-modal-backdrop" role="presentation">
      <form
        className="fl-modal fl-modal--wide fl-modal--pedidos"
        role="dialog"
        aria-modal="true"
        aria-label="Crear pedido"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="fl-modal__header">
          <h2>Crear pedido</h2>
          <button
            type="button"
            className="fl-icon-btn"
            onClick={onClose}
            aria-label="Cerrar"
            disabled={saving}
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="fl-modal__body pedidos-form">
          <label className="form-group">
            <span>Título</span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Resumen corto del pedido"
              disabled={saving}
              required
            />
          </label>

          <label className="form-group">
            <span>Detalle</span>
            <textarea
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              rows={8}
              placeholder="Explicá qué necesitás o qué falla"
              disabled={saving}
              required
            />
          </label>

          <div className="pedidos-form__row">
            <label className="form-group">
              <span>Sección que afecta</span>
              <select
                value={seccion}
                onChange={(e) => setSeccion(e.target.value as PedidoSistemaSeccion)}
                disabled={saving}
              >
                {SECCIONES.map((id) => (
                  <option key={id} value={id}>
                    {PEDIDO_SECCION_LABEL[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span>Prioridad</span>
              <select
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value as PedidoSistemaPrioridad)}
                disabled={saving}
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {PEDIDO_PRIORIDAD_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="form-group">
            <span>Adjuntos</span>
            <div className="pedidos-fotos">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => void onPickFiles(e.target.files)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || adjuntos.length >= MAX_ADJUNTOS}
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload size={16} />
                Subir imágenes o archivos
              </button>
              {adjuntos.length > 0 ? (
                <ul className="pedidos-fotos__list">
                  {adjuntos.map((f) => (
                    <li key={f.key} className="pedidos-fotos__item">
                      {f.isImage ? (
                        <img src={f.previewUrl} alt={f.nombre} />
                      ) : (
                        <span className="pedidos-fotos__file-icon" aria-hidden>
                          <IconFile size={22} />
                        </span>
                      )}
                      <span title={f.nombre}>{f.nombre}</span>
                      <button
                        type="button"
                        className="fl-icon-btn fl-icon-btn--danger"
                        title="Quitar"
                        disabled={saving}
                        onClick={() =>
                          setAdjuntos((prev) => prev.filter((x) => x.key !== f.key))
                        }
                      >
                        <IconTrash size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </label>
        </div>
        <div className="fl-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {saving ? "Creando…" : "Crear pedido"}
          </button>
        </div>
      </form>
    </div>
  );
}
