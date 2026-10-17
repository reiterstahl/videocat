import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

// "Detener traslados" from the web header. The order travels to the Companion in its heartbeat; the
// Companion finishes the file in progress, stops starting new ones (downloads go on) and reports what
// it is doing. The stop lives only in the running Companion: a restart goes back to normal transfers,
// so a forgotten stop never leaves files waiting.

export type TransfersMode = "running" | "stopping" | "stopped";

const stopKey = "transfers_stop_requested_at";
const resumeKey = "transfers_resume_requested_at";

// An order the Companion has not confirmed yet is shown as pending for this long, then dropped
// (an older Companion that does not know the order, or one that went away).
export const transferOrderPendingMs = 2 * 60 * 1000;

async function metric(key: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ valueBigInt: bigint }>>(Prisma.sql`
    SELECT "valueBigInt" FROM "AppMetric" WHERE "key" = ${key} LIMIT 1
  `);
  return Number(rows[0]?.valueBigInt ?? 0n);
}

async function setMetric(key: string, value: number): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppMetric" ("key", "valueBigInt", "updatedAt")
    VALUES (${key}, ${BigInt(value)}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET "valueBigInt" = EXCLUDED."valueBigInt", "updatedAt" = CURRENT_TIMESTAMP
  `);
}

export async function requestTransfers(order: "stop" | "resume", now = Date.now()): Promise<number> {
  await setMetric(order === "stop" ? stopKey : resumeKey, now);
  return now;
}

export async function transferOrders(): Promise<{ stopRequestedAt: number; resumeRequestedAt: number }> {
  const [stopRequestedAt, resumeRequestedAt] = await Promise.all([metric(stopKey), metric(resumeKey)]);
  return { stopRequestedAt, resumeRequestedAt };
}

// The latest order the Companion has not acted on yet, from what it reports.
export function pendingTransferOrder(
  orders: { stopRequestedAt: number; resumeRequestedAt: number },
  mode: TransfersMode,
  now = Date.now()
): "stop" | "resume" | null {
  const stop = orders.stopRequestedAt >= orders.resumeRequestedAt;
  const latest = Math.max(orders.stopRequestedAt, orders.resumeRequestedAt);
  if (!latest || now - latest > transferOrderPendingMs) return null;
  if (stop && mode === "running") return "stop";
  if (!stop && mode !== "running") return "resume";
  return null;
}
