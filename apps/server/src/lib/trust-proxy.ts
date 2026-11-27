// Who may tell VideoCAT the visitor's address (X-Forwarded-For): only the proxies in front of it.
// Trusting every hop let a visitor write the address themselves, and the sign-in and PIN limits,
// counted per address, stopped counting. Private networks are always trusted (the web container,
// a reverse proxy on the LAN, a Cloudflare tunnel); TRUST_PROXY_CIDRS adds public proxies.

// proxy-addr names for 127.0.0.0/8 and ::1, 169.254.0.0/16 and fe80::/10, and the private ranges
// (10/8, 172.16/12, 192.168/16, fc00::/7).
export const privateNetworks = ["loopback", "linklocal", "uniquelocal"] as const;

// https://www.cloudflare.com/ips-v4 and /ips-v6, checked on 2026-11-27. For Cloudflare's proxy in
// front of a public address (the orange cloud); a Cloudflare tunnel arrives from a private one.
export const cloudflareNetworks = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32"
] as const;

const presets: Record<string, readonly string[]> = {
  private: privateNetworks,
  cloudflare: cloudflareNetworks
};

export type TrustProxySetting = {
  // What Fastify's trustProxy gets: false, or the addresses and ranges allowed to forward.
  trust: false | string[];
  // One line for the startup log.
  summary: string;
};

export function trustProxySetting(trustProxy: boolean, extra: string): TrustProxySetting {
  if (!trustProxy) {
    return { trust: false, summary: "X-Forwarded-For is ignored (TRUST_PROXY=false): every visitor appears with the proxy's address." };
  }
  const entries = extra.split(",").map((entry) => entry.trim()).filter(Boolean);
  const unknownPresets = entries.filter((entry) => /^[a-z]+$/i.test(entry) && !(entry.toLowerCase() in presets));
  if (unknownPresets.length > 0) {
    throw new Error(`TRUST_PROXY_CIDRS: unknown name ${unknownPresets.join(", ")}. Use addresses, CIDR ranges, "private" or "cloudflare".`);
  }
  const added = entries.flatMap((entry) => presets[entry.toLowerCase()] ?? [entry]);
  const trust = [...new Set<string>([...privateNetworks, ...added])];
  const extras = entries.filter((entry) => entry.toLowerCase() !== "private");
  return {
    trust,
    summary: extras.length > 0
      ? `X-Forwarded-For is trusted from private networks and ${extras.join(", ")} (TRUST_PROXY_CIDRS).`
      : "X-Forwarded-For is trusted from private networks only. Behind a proxy with a public address, add it to TRUST_PROXY_CIDRS (for example cloudflare)."
  };
}
