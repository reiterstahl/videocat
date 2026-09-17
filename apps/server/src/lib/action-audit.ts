import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

type AuditInput = {
  action: string;
  actorType: "web" | "companion" | "system";
  actorId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  diskId?: string | null;
  videoFileId?: string | null;
  target?: string | null;
  metadata?: Prisma.InputJsonValue;
};

const safeText = (value: string | null | undefined, limit = 2000) => value?.replace(/[\r\n]+/g, " ").slice(0, limit) ?? null;

export function requestIdempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  return /^[a-zA-Z0-9._:-]{12,160}$/.test(key) ? key : undefined;
}

export async function recordAction(input: AuditInput & {
  status?: "started" | "succeeded" | "failed";
  result?: Prisma.InputJsonValue;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await prisma.actionAudit.create({
    data: {
      ...input,
      status: input.status ?? "succeeded",
      result: input.result,
      errorCode: safeText(input.errorCode, 120),
      errorMessage: safeText(input.errorMessage, 2000),
      completedAt: input.status === "started" ? null : new Date()
    }
  });
}

export async function runIdempotentAction<T extends Prisma.InputJsonValue>(
  input: AuditInput,
  operation: () => Promise<T>
): Promise<{ value: T; replayed: boolean }> {
  if (!input.idempotencyKey) {
    const value = await operation();
    await recordAction({ ...input, status: "succeeded", result: value });
    return { value, replayed: false };
  }

  const existing = await prisma.actionAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing?.status === "succeeded" && existing.result != null) {
    return { value: existing.result as T, replayed: true };
  }
  if (existing) {
    throw Object.assign(new Error("An identical action is already being processed"), { statusCode: 409 });
  }

  try {
    await recordAction({ ...input, status: "started" });
    const value = await operation();
    await prisma.actionAudit.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: { status: "succeeded", result: value, completedAt: new Date() }
    });
    return { value, replayed: false };
  } catch (error) {
    await prisma.actionAudit.updateMany({
      where: { idempotencyKey: input.idempotencyKey, status: "started" },
      data: { status: "failed", errorMessage: safeText(error instanceof Error ? error.message : "Action failed"), completedAt: new Date() }
    });
    throw error;
  }
}
