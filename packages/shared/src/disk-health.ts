import { z } from "zod";

// Drive health from SMART, read by smartctl (smartmontools) on the Companion's PC. The Companion
// sends a compact extract of smartctl's JSON (compactSmartReport) and the server evaluates it
// (evaluateSmartReport), so the rules can change without a new Companion.

export type DiskHealthStatus = "good" | "attention" | "failing" | "unavailable";
export type DiskHealthSeverity = "info" | "attention" | "failing";
export type DiskHealthItem = { key: string; severity: DiskHealthSeverity; label: string; value: string };

// Counters whose growth means the drive keeps getting worse.
export type DiskHealthCounters = {
  reallocated?: number;
  pending?: number;
  uncorrectable?: number;
  reportedUncorrect?: number;
  mediaErrors?: number;
};

export type DiskHealthEvaluation = {
  status: DiskHealthStatus;
  model: string | null;
  serial: string | null;
  temperature: number | null;
  powerOnHours: number | null;
  items: DiskHealthItem[];
  counters: DiskHealthCounters;
};

const attributeSchema = z.object({ id: z.number(), name: z.string().max(80).optional(), raw: z.number().nullable() });

export const compactSmartReportSchema = z.object({
  smartPassed: z.boolean().nullable(),
  model: z.string().max(200).nullable(),
  serial: z.string().max(200).nullable(),
  protocol: z.string().max(40).nullable(),
  temperature: z.number().nullable(),
  powerOnHours: z.number().nullable(),
  attributes: z.array(attributeSchema).max(64),
  nvme: z.object({
    criticalWarning: z.number().nullable(),
    availableSpare: z.number().nullable(),
    availableSpareThreshold: z.number().nullable(),
    percentageUsed: z.number().nullable(),
    mediaErrors: z.number().nullable()
  }).nullable(),
  messages: z.array(z.string().max(300)).max(8)
});

export type CompactSmartReport = z.infer<typeof compactSmartReportSchema>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

// The parts of `smartctl -x -j` that the evaluation uses, small enough to send on every check.
export function compactSmartReport(raw: unknown): CompactSmartReport {
  const report = record(raw) ?? {};
  const table = record(report.ata_smart_attributes)?.table;
  const nvmeLog = record(report.nvme_smart_health_information_log);
  const messages = record(report.smartctl)?.messages;
  return {
    smartPassed: typeof record(report.smart_status)?.passed === "boolean" ? record(report.smart_status)!.passed as boolean : null,
    model: stringOrNull(report.model_name) ?? stringOrNull(report.model_family),
    serial: stringOrNull(report.serial_number),
    protocol: stringOrNull(record(report.device)?.protocol),
    temperature: numberOrNull(record(report.temperature)?.current),
    powerOnHours: numberOrNull(record(report.power_on_time)?.hours),
    attributes: Array.isArray(table)
      ? table.slice(0, 64).flatMap((entry) => {
          const attribute = record(entry);
          const id = numberOrNull(attribute?.id);
          if (!attribute || id == null) return [];
          return [{ id, name: stringOrNull(attribute.name)?.slice(0, 80), raw: numberOrNull(record(attribute.raw)?.value) }];
        })
      : [],
    nvme: nvmeLog
      ? {
          criticalWarning: numberOrNull(nvmeLog.critical_warning),
          availableSpare: numberOrNull(nvmeLog.available_spare),
          availableSpareThreshold: numberOrNull(nvmeLog.available_spare_threshold),
          percentageUsed: numberOrNull(nvmeLog.percentage_used),
          mediaErrors: numberOrNull(nvmeLog.media_errors)
        }
      : null,
    messages: Array.isArray(messages)
      ? messages.slice(0, 8).flatMap((message) => {
          const text = stringOrNull(record(message)?.string);
          return text ? [text.slice(0, 300)] : [];
        })
      : []
  };
}

// ATA attributes that count damaged sectors or failed reads; any of them above zero is a known
// sign of a drive on its way out (Backblaze's drive stats), some more than others.
const ataRules: Array<{ id: number; key: keyof DiskHealthCounters | "spinRetry" | "crc" | "reallocatedEvents"; label: string; severity: DiskHealthSeverity }> = [
  { id: 5, key: "reallocated", label: "Sectores reasignados", severity: "attention" },
  { id: 196, key: "reallocatedEvents", label: "Reasignaciones de sectores", severity: "attention" },
  { id: 197, key: "pending", label: "Sectores pendientes (ilegibles por ahora)", severity: "attention" },
  { id: 198, key: "uncorrectable", label: "Sectores incorregibles", severity: "failing" },
  { id: 187, key: "reportedUncorrect", label: "Errores de lectura incorregibles", severity: "failing" },
  { id: 10, key: "spinRetry", label: "Reintentos al arrancar el motor", severity: "attention" },
  { id: 199, key: "crc", label: "Errores de transmisión (cable o adaptador USB)", severity: "attention" }
];

export const hotDiskCelsius = 55;
export const wornNvmePercent = 90;

const severityRank: Record<DiskHealthSeverity, number> = { info: 0, attention: 1, failing: 2 };

export function evaluateSmartReport(report: CompactSmartReport, previous: DiskHealthCounters | null = null): DiskHealthEvaluation {
  const items: DiskHealthItem[] = [];
  const counters: DiskHealthCounters = {};
  const hasData = report.smartPassed != null || report.attributes.length > 0 || report.nvme != null;

  if (report.smartPassed === false) items.push({ key: "smart", severity: "failing", label: "SMART dice que el disco está fallando", value: "FAILED" });

  for (const rule of ataRules) {
    const raw = report.attributes.find((attribute) => attribute.id === rule.id)?.raw;
    if (raw == null) continue;
    if (rule.key === "reallocated" || rule.key === "pending" || rule.key === "uncorrectable" || rule.key === "reportedUncorrect") counters[rule.key] = raw;
    if (raw > 0) items.push({ key: rule.key, severity: rule.severity, label: rule.label, value: raw.toLocaleString("es") });
  }

  const nvme = report.nvme;
  if (nvme) {
    if (nvme.criticalWarning) items.push({ key: "nvmeCritical", severity: "failing", label: "Aviso crítico del disco NVMe", value: `0x${nvme.criticalWarning.toString(16)}` });
    if (nvme.availableSpare != null && nvme.availableSpareThreshold != null && nvme.availableSpare < nvme.availableSpareThreshold) {
      items.push({ key: "nvmeSpare", severity: "failing", label: "Reserva de bloques bajo el mínimo", value: `${nvme.availableSpare} %` });
    }
    if (nvme.mediaErrors != null) {
      counters.mediaErrors = nvme.mediaErrors;
      if (nvme.mediaErrors > 0) items.push({ key: "mediaErrors", severity: "attention", label: "Errores de lectura del medio", value: nvme.mediaErrors.toLocaleString("es") });
    }
    if (nvme.percentageUsed != null && nvme.percentageUsed >= wornNvmePercent) {
      items.push({ key: "nvmeWear", severity: "attention", label: "Desgaste", value: `${nvme.percentageUsed} %` });
    }
  }

  if (report.temperature != null && report.temperature >= hotDiskCelsius) {
    items.push({ key: "temperature", severity: "attention", label: "Temperatura alta", value: `${report.temperature} °C` });
  }

  // Damaged sectors that keep appearing: the drive is getting worse between checks.
  for (const key of ["reallocated", "pending", "uncorrectable", "reportedUncorrect", "mediaErrors"] as const) {
    const before = previous?.[key];
    const now = counters[key];
    if (before != null && now != null && now > before) {
      items.push({ key: `${key}Growing`, severity: "failing", label: "Aumentaron desde la revisión anterior", value: `${before.toLocaleString("es")} → ${now.toLocaleString("es")}` });
    }
  }

  const worst = items.reduce((rank, item) => Math.max(rank, severityRank[item.severity]), 0);
  return {
    status: !hasData ? "unavailable" : worst === 2 ? "failing" : worst === 1 ? "attention" : "good",
    model: report.model,
    serial: report.serial,
    temperature: report.temperature,
    powerOnHours: report.powerOnHours,
    items,
    counters
  };
}

// One drive's check as the Companion sends it: the VideoCAT drive it belongs to and smartctl's
// compact report (null when smartctl got nothing through, e.g. a USB adapter that blocks SMART).
export const diskHealthUploadSchema = z.object({
  disks: z.array(z.object({
    diskId: z.string().min(1).max(200),
    checkedAt: z.string().datetime(),
    report: compactSmartReportSchema.nullable()
  })).max(64)
});

export type DiskHealthUpload = z.infer<typeof diskHealthUploadSchema>;
