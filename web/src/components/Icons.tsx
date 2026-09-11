type IconProps = { size?: number; className?: string };

function base({ size = 20, className }: IconProps) {
  return {
    width: size,
    height: size,
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function IconPlus(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconPencil(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function IconTrash(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function IconPrinter(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

export function IconX(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconChevronUp(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

export function IconChevronDown(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function IconChevronRight(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function IconGrip(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconUpload(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function IconFile(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function IconPdf(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export function IconMinus(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconCalendar(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function IconSearch(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function IconDownload(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function IconStar(p: IconProps & { filled?: boolean }) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s} fill={p.filled ? "currentColor" : "none"}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function IconRefresh(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function IconAlert(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function IconLink(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function IconEye(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconMail(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

/** Cambiar estado / etiqueta. */
export function IconTag(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

/** Reactivar (deshacer desactivación). */
export function IconActivate(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </svg>
  );
}

/** Módulo órdenes (documento clínico). */
export function IconOrders(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

/** Módulo presupuestos. */
export function IconPresupuesto(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  );
}

/** Módulo PAMI. */
export function IconPami(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

/** Módulo usuarios — una sola persona. */
export function IconUsers(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Pedidos / checklist. */
export function IconPedidos(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

/** Logo WhatsApp (mismo estilo gris que el resto del menú). */
export function IconWhatsapp(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s} fill="currentColor" stroke="none">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/** Inicio / home. */
export function IconHome(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

/** Reloj. */
export function IconClock(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

/** Chincheta / pin. */
export function IconPin(p: IconProps & { filled?: boolean }) {
  const s = base(p);
  if (p.filled) {
    return (
      <svg viewBox="0 0 24 24" {...s} fill="currentColor" stroke="none">
        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      <path d="M12 17v5" />
    </svg>
  );
}

/** Paleta de colores. */
export function IconPalette(p: IconProps) {
  const s = base(p);
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 3a9 9 0 1 0 0 18c.8 0 1.4-.6 1.4-1.4 0-.4-.1-.7-.4-1-.2-.2-.3-.5-.3-.8a1.4 1.4 0 0 1 1.4-1.4H16a5 5 0 0 0 0-10H12z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="11" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

