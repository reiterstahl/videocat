const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

function apiUrl(path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${normalizedBase}${normalizedPath.slice(4)}`;
  }
  return `${normalizedBase}${normalizedPath}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? "GET").toUpperCase();
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // A browser retry must not repeat a destructive request. The same key travels
  // with the request; callers that implement their own retry can pass one too.
  if (!headers.has("Idempotency-Key") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("Idempotency-Key", `videocat:${method}:${crypto.randomUUID()}`);
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function thumbnailSrc(path?: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return path;
}
