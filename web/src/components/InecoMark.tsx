type InecoMarkProps = {
  size?: number;
  animated?: boolean;
  /** Fondo blanco redondeado (favicon / marca estática). En carga suele ir sin fondo. */
  withBackground?: boolean;
  className?: string;
  title?: string;
};

/** Marca “O” de INECO (misma del favicon). */
export function InecoMark({
  size = 56,
  animated = false,
  withBackground = true,
  className = "",
  title = "INECO",
}: InecoMarkProps) {
  return (
    <svg
      className={`ineco-mark${animated ? " ineco-mark--spin" : ""}${
        withBackground ? "" : " ineco-mark--bare"
      }${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
    >
      {withBackground ? (
        <rect width="64" height="64" rx="14" ry="14" fill="#FFFFFF" />
      ) : null}
      <g fill="none" strokeLinecap="butt" strokeLinejoin="round">
        <path
          className="ineco-mark__gray"
          stroke="#4A4A4A"
          strokeWidth="10"
          d="M44.9 17.1 A19.5 19.5 0 1 1 19.1 17.1"
        />
        <path
          className="ineco-mark__bordo"
          stroke="#A61948"
          strokeWidth="10"
          d="M21.5 15.85 A19.5 19.5 0 0 1 42.5 15.85"
        />
      </g>
    </svg>
  );
}

type LoadingBlockProps = {
  label?: string;
  size?: number;
  className?: string;
};

/** Bloque de carga: O girando + barra bordó. */
export function LoadingBlock({
  label = "Cargando…",
  size = 72,
  className = "",
}: LoadingBlockProps) {
  return (
    <div className={`ineco-loading${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <InecoMark size={size} animated withBackground={false} />
      <div className="ineco-loading__bar" aria-hidden>
        <span className="ineco-loading__bar-fill" />
      </div>
      {label ? <p className="ineco-loading__label">{label}</p> : null}
    </div>
  );
}
