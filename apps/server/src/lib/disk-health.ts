import type { Prisma } from "@prisma/client";
import { evaluateSmartReport, type CompactSmartReport, type DiskHealthCounters, type DiskHealthEvaluation } from "@videocat/shared";
import { prisma } from "./prisma.js";

// A drive's SMART check: evaluated against the previous one (damaged sectors that keep growing
// mean a probable failure) and stored as its current health.

// Identifies the state an alert was dismissed for: the same failure keeps it hidden, more damaged
// sectors bring it back.
export function alertKey(evaluation: Pick<DiskHealthEvaluation, "status" | "counters">): string {
  const counters = Object.entries(evaluation.counters).sort(([left], [right]) => left.localeCompare(right));
  return `${evaluation.status}:${JSON.stringify(counters)}`;
}

const unavailable: DiskHealthEvaluation = { status: "unavailable", model: null, serial: null, temperature: null, powerOnHours: null, items: [], counters: {} };

export async function saveDiskHealth(diskId: string, checkedAt: Date, report: CompactSmartReport | null): Promise<DiskHealthEvaluation> {
  const previous = await prisma.diskHealth.findUnique({ where: { diskId }, select: { evaluation: true, checkedAt: true } });
  // A late upload of an older check never replaces a newer one.
  if (previous && previous.checkedAt > checkedAt) return previous.evaluation as unknown as DiskHealthEvaluation;
  const previousCounters = (previous?.evaluation as { counters?: DiskHealthCounters } | undefined)?.counters ?? null;
  const evaluation = report ? evaluateSmartReport(report, previousCounters) : unavailable;
  const data = {
    status: evaluation.status,
    checkedAt,
    report: (report ?? undefined) as Prisma.InputJsonValue | undefined,
    evaluation: evaluation as unknown as Prisma.InputJsonValue
  };
  await prisma.diskHealth.upsert({ where: { diskId }, create: { diskId, ...data }, update: data });
  return evaluation;
}

export type DiskHealthSummary = {
  status: string;
  checkedAt: Date;
  model: string | null;
  serial: string | null;
  temperature: number | null;
  powerOnHours: number | null;
  items: DiskHealthEvaluation["items"];
};

export function healthSummary(row: { status: string; checkedAt: Date; evaluation: Prisma.JsonValue }): DiskHealthSummary {
  const evaluation = row.evaluation as unknown as DiskHealthEvaluation;
  return {
    status: row.status,
    checkedAt: row.checkedAt,
    model: evaluation.model ?? null,
    serial: evaluation.serial ?? null,
    temperature: evaluation.temperature ?? null,
    powerOnHours: evaluation.powerOnHours ?? null,
    items: evaluation.items ?? []
  };
}
