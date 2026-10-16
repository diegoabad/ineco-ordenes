/** Logger mínimo compatible con Baileys (sin pino). */
type LogFn = (..._args: unknown[]) => void;

function noop(): void {
  /* silent */
}

export const baileysLogger = {
  level: "silent" as const,
  child() {
    return baileysLogger;
  },
  trace: noop as LogFn,
  debug: noop as LogFn,
  info: noop as LogFn,
  warn: (...args: unknown[]) => {
    console.warn("[whatsapp]", ...args);
  },
  error: (...args: unknown[]) => {
    console.error("[whatsapp]", ...args);
  },
  fatal: (...args: unknown[]) => {
    console.error("[whatsapp]", ...args);
  },
};
