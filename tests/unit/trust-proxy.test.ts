import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { cloudflareNetworks, trustProxySetting } from "../../apps/server/src/lib/trust-proxy.ts";

// The visitor's address as the server sees it, for a request that reached it from `remoteAddress`
// with the X-Forwarded-For built along the way.
async function seenAddress(trust: false | string[], remoteAddress: string, forwardedFor: string): Promise<string> {
  const app = Fastify({ trustProxy: trust });
  app.get("/ip", async (request) => request.ip);
  const response = await app.inject({ url: "/ip", remoteAddress, headers: { "x-forwarded-for": forwardedFor } });
  await app.close();
  return response.body;
}

test("by default a visitor cannot choose the address the server sees", async () => {
  const { trust } = trustProxySetting(true, "");
  // The visitor forged 6.6.6.6; the web container appended the real address.
  assert.equal(await seenAddress(trust, "172.18.0.5", "6.6.6.6, 203.0.113.7"), "203.0.113.7");
  // Through a reverse proxy on the LAN as well.
  assert.equal(await seenAddress(trust, "172.18.0.5", "6.6.6.6, 203.0.113.7, 192.168.1.10"), "203.0.113.7");
  // What trusting every hop did: the forged address.
  assert.equal(await seenAddress(true as unknown as string[], "172.18.0.5", "6.6.6.6, 203.0.113.7"), "6.6.6.6");
});

test("cloudflare adds its published ranges, and private networks stay trusted", async () => {
  const { trust, summary } = trustProxySetting(true, "cloudflare");
  assert.ok(Array.isArray(trust));
  for (const range of cloudflareNetworks) assert.ok(trust.includes(range));
  assert.ok(trust.includes("uniquelocal"));
  assert.match(summary, /cloudflare/);
  // Cloudflare edge (104.16.x) → router → web container: the visitor is the address Cloudflare saw.
  assert.equal(await seenAddress(trust, "172.18.0.5", "6.6.6.6, 198.51.100.4, 104.16.1.1, 192.168.1.10"), "198.51.100.4");
  // Without the preset the edge is the farthest trusted address left.
  assert.equal(await seenAddress(trustProxySetting(true, "").trust, "172.18.0.5", "6.6.6.6, 198.51.100.4, 104.16.1.1, 192.168.1.10"), "104.16.1.1");
});

test("addresses and ranges are added as they are, unknown names are refused, and false turns it off", async () => {
  const { trust } = trustProxySetting(true, " 203.0.113.9 , 2001:db8::/32,private ");
  assert.deepEqual(trust, ["loopback", "linklocal", "uniquelocal", "203.0.113.9", "2001:db8::/32"]);
  assert.throws(() => trustProxySetting(true, "cloudflare,akamai"), /unknown name akamai/);
  const off = trustProxySetting(false, "cloudflare");
  assert.equal(off.trust, false);
  assert.equal(await seenAddress(off.trust, "172.18.0.5", "6.6.6.6"), "172.18.0.5");
});
