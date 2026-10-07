import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import { fetchWaCoberturas, updateWaContact } from "../services/whatsappCrmService";
import type {
  WaCobertura,
  WaContact,
  WaContactConsultaPara,
  WaContactGrupoEtario,
} from "../types/whatsappCrm";

const RELACION_FAMILIAR_OPTIONS = [
  "Padre",
  "Madre",
  "Abuelo",
  "Abuela",
  "Hijo",
  "Hija",
  "Tío",
  "Tía",
  "Sobrino",
  "Sobrina",
  "Tutor",
  "Otro",
] as const;

const SIN_COBERTURA = "SIN COBERTURA";

function editableContactNames(contact: WaContact | null | undefined): {
  firstName: string;
  lastName: string;
} {
  if (!contact) return { firstName: "", lastName: "" };
  const first = contact.firstName?.trim() || "";
  const last = contact.lastName?.trim() || "";
  if (first || last) return { firstName: first, lastName: last };
  const full =
    contact.displayName?.trim() ||
    contact.whatsappName?.trim() ||
    "";
  if (!full) return { firstName: "", lastName: "" };
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

type Props = {
  formId: string;
  contact: WaContact | null | undefined;
  phoneNumber?: string | null;
  /** Reinicia el formulario cuando cambia (p. ej. al abrir modal / tab). */
  active: boolean;
  onSaved?: (contact: WaContact) => void;
  onSavingChange?: (saving: boolean) => void;
  onCanSubmitChange?: (canSubmit: boolean) => void;
};

export function WhatsAppContactDatosForm({
  formId,
  contact,
  phoneNumber,
  active,
  onSaved,
  onSavingChange,
  onCanSubmitChange,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [agendaNombre, setAgendaNombre] = useState("");
  const [agendaApellido, setAgendaApellido] = useState("");
  const [agendaCobertura, setAgendaCobertura] = useState("");
  const [agendaEmail, setAgendaEmail] = useState("");
  const [agendaGrupoEtario, setAgendaGrupoEtario] = useState<WaContactGrupoEtario | "">("");
  const [agendaConsultaPara, setAgendaConsultaPara] = useState<WaContactConsultaPara | "">("");
  const [agendaRelacionFamiliar, setAgendaRelacionFamiliar] = useState("");
  const [agendaContactoNombre, setAgendaContactoNombre] = useState("");
  const [agendaContactoApellido, setAgendaContactoApellido] = useState("");
  const [agendaDni, setAgendaDni] = useState("");
  const [agendaEsPaciente, setAgendaEsPaciente] = useState<"" | "si" | "no">("");
  const [coberturas, setCoberturas] = useState<WaCobertura[]>([]);

  const contactId = contact?.id?.trim() || "";
  const agendaTelefono =
    contact?.phoneNumber?.trim() || phoneNumber?.trim() || "";

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchWaCoberturas();
        if (!cancelled) setCoberturas(data);
      } catch {
        if (!cancelled) setCoberturas([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const names = editableContactNames(contact);
    setAgendaNombre(names.firstName);
    setAgendaApellido(names.lastName);
    setAgendaCobertura(() => {
      const raw = contact?.cobertura?.trim() || "";
      if (!raw) return "";
      return raw.toUpperCase() === SIN_COBERTURA ? SIN_COBERTURA : raw;
    });
    setAgendaEmail(contact?.email?.trim() || "");
    setAgendaGrupoEtario(contact?.grupoEtario ?? "");
    setAgendaConsultaPara(contact?.consultaPara ?? "");
    setAgendaRelacionFamiliar(contact?.relacionFamiliar?.trim() || "");
    setAgendaContactoNombre(contact?.contactoNombre?.trim() || "");
    setAgendaContactoApellido(contact?.contactoApellido?.trim() || "");
    setAgendaDni(contact?.dni?.trim() || "");
    setAgendaEsPaciente(
      contact?.esPaciente === true ? "si" : contact?.esPaciente === false ? "no" : "",
    );
  }, [active, contact?.id]);

  const coberturasDisponibles = useMemo(() => {
    if (agendaGrupoEtario !== "infanto" && agendaGrupoEtario !== "adulto") {
      return [] as WaCobertura[];
    }
    return coberturas.filter(
      (item) =>
        item.gruposEtarios.includes(agendaGrupoEtario) &&
        item.nombre.trim().toUpperCase() !== SIN_COBERTURA,
    );
  }, [coberturas, agendaGrupoEtario]);

  useEffect(() => {
    if (!agendaCobertura || !agendaGrupoEtario) return;
    if (coberturas.length === 0) return;
    if (agendaCobertura.trim().toUpperCase() === SIN_COBERTURA) return;
    const stillValid = coberturasDisponibles.some(
      (item) => item.nombre === agendaCobertura,
    );
    if (!stillValid) setAgendaCobertura("");
  }, [agendaGrupoEtario, coberturas, coberturasDisponibles, agendaCobertura]);

  const canSubmit = (() => {
    if (!contactId || saving) return false;
    if (!agendaNombre.trim()) return false;
    if (agendaConsultaPara === "tercero") {
      if (!agendaRelacionFamiliar.trim() || !agendaContactoNombre.trim()) return false;
    }
    return true;
  })();

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    onCanSubmitChange?.(canSubmit);
  }, [canSubmit, onCanSubmitChange]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!contactId || saving) return;
    const firstName = agendaNombre.trim();
    const lastName = agendaApellido.trim();
    const cobertura = agendaCobertura.trim();
    const email = agendaEmail.trim();
    if (!firstName) {
      toast.error("Escribí el nombre del paciente");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("El email no es válido");
      return;
    }
    if (agendaConsultaPara === "tercero") {
      if (!agendaRelacionFamiliar.trim()) {
        toast.error("Indicá la relación familiar con el paciente");
        return;
      }
      if (!agendaContactoNombre.trim()) {
        toast.error("Indicá el nombre de quien escribe (el contacto)");
        return;
      }
    }
    setSaving(true);
    try {
      const updated = await updateWaContact(contactId, {
        firstName,
        lastName,
        cobertura,
        email,
        grupoEtario: agendaGrupoEtario || null,
        consultaPara: agendaConsultaPara || null,
        relacionFamiliar:
          agendaConsultaPara === "tercero" ? agendaRelacionFamiliar.trim() : "",
        contactoNombre:
          agendaConsultaPara === "tercero" ? agendaContactoNombre.trim() : "",
        contactoApellido:
          agendaConsultaPara === "tercero" ? agendaContactoApellido.trim() : "",
        dni: agendaDni.trim(),
        esPaciente:
          agendaEsPaciente === "si" ? true : agendaEsPaciente === "no" ? false : null,
      });
      toast.success("Contacto guardado");
      onSaved?.(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el contacto");
    } finally {
      setSaving(false);
    }
  }

  if (!contactId) {
    return <p className="wa-followup__hint">No hay contacto asociado.</p>;
  }

  const idPrefix = formId;

  return (
    <form id={formId} className="form-grid" onSubmit={(e) => void onSubmit(e)}>
      <div className="form-group form-group--full">
        <label htmlFor={`${idPrefix}-para`}>¿La consulta es para…?</label>
        <select
          id={`${idPrefix}-para`}
          className="ui-select"
          value={agendaConsultaPara}
          onChange={(e) => {
            const next = (e.target.value || "") as WaContactConsultaPara | "";
            setAgendaConsultaPara(next);
            if (next !== "tercero") {
              setAgendaRelacionFamiliar("");
              setAgendaContactoNombre("");
              setAgendaContactoApellido("");
            }
          }}
        >
          <option value="">Sin indicar</option>
          <option value="propio">El mismo contacto (es el paciente)</option>
          <option value="tercero">Otra persona (hijo, padre, etc.)</option>
        </select>
      </div>
      {agendaConsultaPara === "tercero" ? (
        <>
          <div className="form-group--full wa-followup__divider" role="presentation">
            <span>Datos de quien escribe por WhatsApp</span>
          </div>
          <div className="form-group form-group--full">
            <label htmlFor={`${idPrefix}-relacion`}>Relación con el paciente</label>
            <select
              id={`${idPrefix}-relacion`}
              className="ui-select"
              value={agendaRelacionFamiliar}
              onChange={(e) => setAgendaRelacionFamiliar(e.target.value)}
              required
            >
              <option value="">Elegir…</option>
              {RELACION_FAMILIAR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {agendaRelacionFamiliar &&
              !(RELACION_FAMILIAR_OPTIONS as readonly string[]).includes(
                agendaRelacionFamiliar,
              ) ? (
                <option value={agendaRelacionFamiliar}>{agendaRelacionFamiliar}</option>
              ) : null}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-contacto-nombre`}>Nombre</label>
            <input
              id={`${idPrefix}-contacto-nombre`}
              value={agendaContactoNombre}
              onChange={(e) => setAgendaContactoNombre(e.target.value)}
              placeholder="Nombre del contacto"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-contacto-apellido`}>Apellido</label>
            <input
              id={`${idPrefix}-contacto-apellido`}
              value={agendaContactoApellido}
              onChange={(e) => setAgendaContactoApellido(e.target.value)}
              placeholder="Apellido del contacto"
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-email`}>Email</label>
            <input
              id={`${idPrefix}-email`}
              type="email"
              value={agendaEmail}
              onChange={(e) => setAgendaEmail(e.target.value)}
              placeholder="email@ejemplo.com"
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-telefono`}>Teléfono</label>
            <input
              id={`${idPrefix}-telefono`}
              type="tel"
              className="is-readonly"
              value={agendaTelefono}
              readOnly
              disabled
              tabIndex={-1}
              title="Número de la conversación de WhatsApp (no editable)"
              placeholder={agendaTelefono ? undefined : "Sin número"}
            />
          </div>
        </>
      ) : null}
      <div className="form-group--full wa-followup__divider" role="presentation">
        <span>Datos del paciente</span>
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-nombre`}>Nombre</label>
        <input
          id={`${idPrefix}-nombre`}
          value={agendaNombre}
          onChange={(e) => setAgendaNombre(e.target.value)}
          placeholder="Nombre del paciente"
          required
          autoFocus={agendaConsultaPara !== "tercero"}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-apellido`}>Apellido</label>
        <input
          id={`${idPrefix}-apellido`}
          value={agendaApellido}
          onChange={(e) => setAgendaApellido(e.target.value)}
          placeholder="Apellido del paciente"
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-dni`}>DNI</label>
        <input
          id={`${idPrefix}-dni`}
          value={agendaDni}
          onChange={(e) => setAgendaDni(e.target.value.replace(/\D/g, ""))}
          placeholder="Solo números"
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-paciente`}>¿Es paciente?</label>
        <select
          id={`${idPrefix}-paciente`}
          className="ui-select"
          value={agendaEsPaciente}
          onChange={(e) => setAgendaEsPaciente((e.target.value || "") as "" | "si" | "no")}
        >
          <option value="">Sin indicar</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-grupo`}>Infanto / Adulto</label>
        <select
          id={`${idPrefix}-grupo`}
          className="ui-select"
          value={agendaGrupoEtario}
          onChange={(e) =>
            setAgendaGrupoEtario((e.target.value || "") as WaContactGrupoEtario | "")
          }
        >
          <option value="">Sin indicar</option>
          <option value="infanto">Infanto</option>
          <option value="adulto">Adulto</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-cobertura`}>Cobertura</label>
        <select
          id={`${idPrefix}-cobertura`}
          className="ui-select"
          value={agendaCobertura}
          onChange={(e) => setAgendaCobertura(e.target.value)}
          disabled={!agendaGrupoEtario}
        >
          <option value="">
            {!agendaGrupoEtario ? "Primero elegí Infanto / Adulto" : "Elegir…"}
          </option>
          {agendaGrupoEtario ? (
            <option value={SIN_COBERTURA}>{SIN_COBERTURA}</option>
          ) : null}
          {coberturasDisponibles.map((item) => (
            <option key={item.id} value={item.nombre}>
              {item.nombre}
            </option>
          ))}
          {agendaCobertura &&
          agendaCobertura.trim().toUpperCase() !== SIN_COBERTURA &&
          !coberturasDisponibles.some((item) => item.nombre === agendaCobertura) ? (
            <option value={agendaCobertura}>{agendaCobertura}</option>
          ) : null}
        </select>
      </div>
      {agendaConsultaPara !== "tercero" ? (
        <>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-email`}>Email</label>
            <input
              id={`${idPrefix}-email`}
              type="email"
              value={agendaEmail}
              onChange={(e) => setAgendaEmail(e.target.value)}
              placeholder="email@ejemplo.com"
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-telefono`}>Teléfono</label>
            <input
              id={`${idPrefix}-telefono`}
              type="tel"
              className="is-readonly"
              value={agendaTelefono}
              readOnly
              disabled
              tabIndex={-1}
              title="Número de la conversación de WhatsApp (no editable)"
              placeholder={agendaTelefono ? undefined : "Sin número"}
            />
          </div>
        </>
      ) : null}
    </form>
  );
}
