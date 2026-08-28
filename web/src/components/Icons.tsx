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
