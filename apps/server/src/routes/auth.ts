import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clearLoginRateLimit,
  clearProtectedFolderCookie,
  clearProtectedPinRateLimit,
  clearSessionCookie,
  enforceLoginRateLimit,
  enforceProtectedPinRateLimit,
  isProtectedFolderUnlocked,
  isValidAdminLogin,
  requireWebAuth,
  setProtectedFolderCookie,
  setSessionCookie,
  signProtectedFolderUnlock,
  signSession
} from "../lib/auth.js";
import {
  isValidProtectedFolderPin,
  normalizeProtectedPatterns,
  protectedSecurityProfile,
  updateProtectedSecurityProfile
} from "../lib/protected-settings.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const protectedFolderUnlockSchema = z.object({
  pin: z.string().regex(/^\d{4}$/)
});

const profileSecuritySchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
  newPin: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
  protectedFolderPatterns: z.array(z.string().trim().min(1).max(80)).max(50)
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", { preHandler: enforceLoginRateLimit }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    if (!isValidAdminLogin(body.username, body.password)) {
      return reply.code(401).send({ message: "Invalid username or password" });
    }

    clearLoginRateLimit(request);
    setSessionCookie(reply, signSession(body.username));
    return { user: { username: body.username } };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireWebAuth }, async () => {
    return { user: { username: "admin" } };
  });

  app.get("/api/protected-folder/status", { preHandler: requireWebAuth }, async (request) => {
    return { unlocked: isProtectedFolderUnlocked(request) };
  });

  app.post("/api/protected-folder/unlock", { preHandler: [requireWebAuth, enforceProtectedPinRateLimit] }, async (request, reply) => {
    const body = protectedFolderUnlockSchema.parse(request.body);
    if (!(await isValidProtectedFolderPin(body.pin))) {
      clearProtectedFolderCookie(reply);
      return reply.code(401).send({ message: "Invalid PIN" });
    }

    clearProtectedPinRateLimit(request);
    setProtectedFolderCookie(reply, signProtectedFolderUnlock());
    return { ok: true, unlocked: true };
  });

  app.get("/api/profile/security", { preHandler: requireWebAuth }, async () => {
    return protectedSecurityProfile();
  });

  app.patch("/api/profile/security", { preHandler: requireWebAuth }, async (request) => {
    const body = profileSecuritySchema.parse(request.body);
    return updateProtectedSecurityProfile({
      currentPin: body.currentPin || undefined,
      newPin: body.newPin || undefined,
      protectedFolderPatterns: normalizeProtectedPatterns(body.protectedFolderPatterns)
    });
  });
}
