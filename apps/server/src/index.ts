import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { applySecurityHeaders, requireTrustedOrigin } from "./lib/security.js";
import { agentRoutes } from "./routes/agent.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";

const app = Fastify({
  logger: true,
  bodyLimit: 1024 * 1024 * 25,
  trustProxy: env.TRUST_PROXY
});

await app.register(cors, {
  origin: env.WEB_ORIGIN.split(",").map((origin) => origin.trim()),
  credentials: true
});
await app.register(cookie);
await app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 10
  }
});

app.addHook("onRequest", applySecurityHeaders);
app.addHook("preHandler", requireTrustedOrigin);

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ message: "Invalid request", issues: error.issues });
  }

  const errorLike = error as { statusCode?: unknown; message?: unknown };
  const statusCode = typeof errorLike.statusCode === "number" ? errorLike.statusCode : 500;
  if (statusCode >= 500) {
    app.log.error(error);
    return reply.code(500).send({ message: "Internal server error" });
  }

  return reply.code(statusCode).send({ message: typeof errorLike.message === "string" ? errorLike.message : "Request failed" });
});

app.get("/api/health", async () => ({ ok: true }));
await app.register(authRoutes);
await app.register(agentRoutes);
await app.register(catalogRoutes);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });
