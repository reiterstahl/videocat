import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { env } from "./lib/env.js";
import { applySecurityHeaders, requireTrustedOrigin } from "./lib/security.js";
import { agentRoutes } from "./routes/agent.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024 * 25,
    connectionTimeout: 10_000,
    requestTimeout: 120_000,
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

  return app;
}
