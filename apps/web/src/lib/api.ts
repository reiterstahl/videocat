const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

function apiUrl(path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${normalizedBase}${normalizedPath.slice(4)}`;
  }
  return `${normalizedBase}${normalizedPath}`;
}

export const accessExpiredMessage = "Tu sesión de acceso a este sitio expiró. Vuelve a iniciar sesión para continuar.";
export const accessExpiredEvent = "videocat:access-expired";

// A proxy in front of VideoCAT (for example Cloudflare Access) answers API calls with a redirect to
// its own sign-in page once its session expires; the browser then reports a bare network error.
// Asking without following redirects tells that apart from a real network problem, without ever
// connecting to the proxy's domain.
async function accessProxyRedirects(): Promise<boolean> {
  try {
    const probe = await fetch(apiUrl("/api/health"), { credentials: "include", redirect: "manual", cache: "no-store" });
    return probe.type === "opaqueredirect" || (probe.status >= 300 && probe.status < 400);
  } catch {
    return false;
  }
}

function announceAccessExpired(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(accessExpiredEvent));
}

// A top-level visit that the app does not intercept: the proxy shows its sign-in, then the server
// sends the person back to the page they were on.
export function accessSignInUrl(): string {
  const back = `${window.location.pathname}${window.location.search}`;
  return apiUrl(`/api/session/return?to=${encodeURIComponent(back)}`);
}

// Server refusals that can come from many places, in Spanish (the page translator turns them
// into English).
const serverMessages: Record<string, string> = {
  "Videos in S3 buckets cannot be downloaded yet": "Los videos de buckets S3 todavía no se pueden descargar a la PC."
};

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

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers
    });
  } catch (error) {
    if (await accessProxyRedirects()) {
      announceAccessExpired();
      throw new Error(accessExpiredMessage);
    }
    throw error;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(serverMessages[error.message] ?? error.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function thumbnailSrc(path?: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return path;
}
