import { WHATSAPP_SECTIONS, type WhatsappSection } from "../lib/appNav";

type Props = {
  section: WhatsappSection;
};

export function WhatsAppModule({ section }: Props) {
  const label =
    WHATSAPP_SECTIONS.find((item) => item.id === section)?.label ?? "WhatsApp";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>WhatsApp</h1>
            <p>{label}</p>
          </div>
        </div>
      </header>
      <div className="fl-table-empty fl-table-empty--fill">
        <p className="fl-table-empty__title">Próximamente</p>
        <p className="fl-table-empty__hint">
          Esta sección todavía no está integrada.
        </p>
      </div>
    </div>
  );
}
