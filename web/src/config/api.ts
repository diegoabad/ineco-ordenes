function resolveApiUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (raw !== undefined && String(raw).trim() !== "") {
    return String(raw).trim().replace(/\/$/, "");
  }
  if (import.meta.env.PROD) {
    return "";
  }
  // En dev Vite proxyea /api y /uploads al mismo origen.
  return "";
}

const API_URL = resolveApiUrl();

export function getApiUrl(): string {
  return API_URL;
}

export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const base = API_URL || window.location.origin;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

type ApiErrorBody = {
  message?: string;
  data?: unknown;
  code?: string;
};

function messageForEmptyResponse(status: number): string {
  if (status === 502 || status === 503 || status === 504 || status === 0) {
    return "La API no está disponible. Esperá un momento y reintentá.";
  }
  if (status >= 400) {
    return `Error del servidor (${status})`;
  }
  return "Respuesta vacía del servidor";
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw Object.assign(new Error("No se pudo conectar con la API. ¿Está levantada?"), {
      status: 0,
    });
  }

  const raw = await response.text();
  let data: (T & ApiErrorBody) | null = null;

  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as T & ApiErrorBody;
    } catch {
      throw Object.assign(
        new Error(
          response.ok
            ? "La API devolvió una respuesta inválida"
            : messageForEmptyResponse(response.status),
        ),
        { status: response.status },
      );
    }
  }

  if (!response.ok) {
    const err = new Error(
      data?.message || messageForEmptyResponse(response.status),
    ) as Error & {
      data?: unknown;
      code?: string;
      status?: number;
    };
    if (data?.data !== undefined) err.data = data.data;
    if (data?.code) err.code = data.code;
    err.status = response.status;
    throw err;
  }

  if (data === null) {
    throw Object.assign(new Error(messageForEmptyResponse(response.status)), {
      status: response.status,
    });
  }

  return data;
}
