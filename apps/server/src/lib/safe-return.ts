// Where to go back after signing in again at a proxy in front of VideoCAT (for example Cloudflare
// Access): only a path of this same site, never another origin.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  try {
    const base = "http://videocat.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "/";
    // Server routes are not pages to come back to.
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/thumbnails/")) return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}
