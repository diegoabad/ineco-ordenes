/** Mensajes amigables para errores de login (Firebase / API / red). */

const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/popup-closed-by-user": "Cerraste la ventana de inicio de sesión. Podés intentar de nuevo.",
  "auth/cancelled-popup-request": "Inicio de sesión cancelado. Podés intentar de nuevo.",
  "auth/popup-blocked":
    "El navegador bloqueó la ventana emergente. Permití popups para este sitio e intentá otra vez.",
  "auth/account-exists-with-different-credential":
    "Ese email ya está vinculado a otro método. Probá con el otro botón (Google o Microsoft).",
  "auth/network-request-failed":
    "No hay conexión con el servicio de acceso. Revisá tu internet e intentá de nuevo.",
  "auth/too-many-requests":
    "Hubo demasiados intentos. Esperá unos minutos e intentá otra vez.",
  "auth/user-disabled": "Esta cuenta está deshabilitada. Contactá al administrador.",
  "auth/unauthorized-domain":
    "La URL de este sitio no está autorizada en Firebase. En Firebase Console → Authentication → Settings → Authorized domains, agregá el dominio de producción (sin https://).",
  "auth/operation-not-allowed":
    "Este método de acceso no está habilitado. Pedile a sistemas que active Google o Microsoft.",
  "auth/internal-error":
    "Hubo un problema al iniciar sesión. Probá de nuevo en unos segundos.",
  "auth/invalid-api-key":
    "La configuración de acceso no es válida. Pedile a sistemas que la revise.",
  "auth/configuration-not-found":
    "Falta configurar el acceso en el servidor. Pedile a sistemas que lo revise.",
  "auth/admin-restricted-operation":
    "No se pudo completar el acceso. Contactá al administrador.",
  "auth/invalid-credential":
    "No se pudo validar la cuenta. Probá de nuevo o usá el otro método (Google / Microsoft).",
};
const API_FRIENDLY: Array<{ test: RegExp; message: string }> = [
  {
    test: /AADSTS50194|multi-tenant|\/common endpoint|not configured as a multi-tenant/i,
    message:
      "Microsoft está configurado como single-tenant. Hay que poner el Tenant ID de Entra ID en AUTH_MICROSOFT_TENANT_ID (o hacer la app multi-tenant en Azure).",
  },
  {
    test: /INVALID_IDP_RESPONSE|microsoft\.com response/i,
    message:
      "Microsoft rechazó el login. Revisá la app en Azure (tenant / redirect) y reintentá.",
  },
  {
    test: /dominio de email no está autorizado|email no pertenece a un dominio/i,
    message:
      "Tu email no está en un dominio permitido. Un admin tiene que agregarlo en Usuarios → Dominios (ej. ineco.ar).",
  },
  {
    test: /dominio.*no está autorizado|no está autorizado/i,
    message:
      "Dominio no autorizado. Si el mensaje es de Firebase, falta agregar la URL del sitio en Authorized domains; si es del email, falta el dominio en Usuarios → Dominios.",
  },
  {
    test: /email válido|sin un email/i,
    message: "La cuenta no tiene un email válido. Probá con otra cuenta.",
  },
  {
    test: /verificá tu email|email_verified/i,
    message: "Verificá tu email en Google o Microsoft y volvé a intentar.",
  },
  {
    test: /FIREBASE_TOKEN_INVALID|No se pudo validar el acceso con Google/i,
    message:
      "No se pudo validar el acceso con Google/Microsoft. Revisá providers y Authorized domains en Firebase.",
  },
  {
    test: /sesión expirada|sesión inválida|jwt expired|token expired|jws signature|jwt claim/i,
    message: "La sesión de acceso expiró o no es válida. Intentá ingresar de nuevo.",
  },
  {
    test: /permission|permiso|firestore|Missing or insufficient/i,
    message: "No se pudo guardar tu solicitud de acceso. Pedile a sistemas que revise la configuración.",
  },
  {
    test: /API no está disponible|no se pudo conectar|Failed to fetch|NetworkError|ECONNREFUSED/i,
    message: "No se pudo conectar con el servidor. Esperá un momento e intentá de nuevo.",
  },
  {
    test: /respuesta inválida|Respuesta vacía|Unexpected end of JSON/i,
    message: "El servidor no respondió correctamente. Esperá un momento e intentá de nuevo.",
  },
];

function looksTechnical(message: string): boolean {
  return (
    /firebase|auth\/|stack|exception|at Object|http:\/\/|https:\/\/|ECONN|ENOENT|TypeError|FirebaseError|jose|JWTClaim/i.test(
      message,
    ) || message.length > 180
  );
}

export function friendlyLoginError(err: unknown): {
  code?: string;
  message: string;
} {
  const e = err as Error & { code?: string; status?: number };
  const code = e.code;

  if (code === "PENDING") {
    return {
      code,
      message:
        "Si todavía no tenés acceso, tu solicitud queda en espera de aprobación.",
    };
  }
  if (code === "REJECTED") {
    return {
      code,
      message:
        "Tu solicitud de acceso fue rechazada. Si creés que es un error, contactá al administrador.",
    };
  }

  if (code && FIREBASE_MESSAGES[code]) {
    return { code, message: FIREBASE_MESSAGES[code]! };
  }

  const raw = (e.message || "").trim();
  for (const rule of API_FRIENDLY) {
    if (rule.test.test(raw)) {
      return { code, message: rule.message };
    }
  }

  if (!raw || looksTechnical(raw)) {
    return {
      code,
      message: "No se pudo iniciar sesión. Intentá de nuevo en unos segundos.",
    };
  }

  return { code, message: raw };
}
