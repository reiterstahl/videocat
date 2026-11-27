import { prisma } from "./prisma.js";

// Sessions closed with Salir stay closed: the token's id is kept until the token would have expired
// anyway. In memory for the check on every request, in the database so a restart does not reopen them.
const revoked = new Map<string, number>();

export function isSessionRevoked(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  const expiresAt = revoked.get(sessionId);
  if (expiresAt == null) return false;
  if (expiresAt <= Date.now()) {
    revoked.delete(sessionId);
    return false;
  }
  return true;
}

export async function revokeSession(sessionId: string, expiresAt: Date): Promise<void> {
  if (expiresAt.getTime() <= Date.now()) return;
  revoked.set(sessionId, expiresAt.getTime());
  await prisma.revokedSession.upsert({
    where: { id: sessionId },
    create: { id: sessionId, expiresAt },
    update: { expiresAt }
  });
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

export async function loadRevokedSessions(): Promise<void> {
  const now = new Date();
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lte: now } } });
  for (const session of await prisma.revokedSession.findMany({ select: { id: true, expiresAt: true } })) {
    revoked.set(session.id, session.expiresAt.getTime());
  }
}
