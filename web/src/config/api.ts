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

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message || "Error en la solicitud");
  }

  return data;
}
