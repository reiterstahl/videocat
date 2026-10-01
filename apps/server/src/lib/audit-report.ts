export type AuditErrorRow = {
  id: string;
  diskName: string;
  category: string;
  phase: string;
  code: string | null;
  message: string;
  relativePath: string | null;
  createdAt: Date;
};

export type GroupedAuditError = {
  key: string;
  diskName: string;
  category: string;
  phase: string;
  code: string | null;
  message: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  samplePath: string | null;
};

// Repeated errors share disk, category, phase, code and message; paths and dates vary.
export function groupAuditErrors(rows: AuditErrorRow[]): GroupedAuditError[] {
  const groups = new Map<string, GroupedAuditError>();
  for (const row of rows) {
    const key = [row.diskName, row.category, row.phase, row.code ?? "", row.message].join("\u0000");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        diskName: row.diskName,
        category: row.category,
        phase: row.phase,
        code: row.code,
        message: row.message,
        count: 1,
        firstAt: row.createdAt,
        lastAt: row.createdAt,
        samplePath: row.relativePath
      });
      continue;
    }
    existing.count += 1;
    if (row.createdAt < existing.firstAt) existing.firstAt = row.createdAt;
    if (row.createdAt > existing.lastAt) {
      existing.lastAt = row.createdAt;
      existing.samplePath = row.relativePath ?? existing.samplePath;
    }
  }
  return [...groups.values()].sort((left, right) => right.lastAt.getTime() - left.lastAt.getTime());
}

// Prevents spreadsheet formula injection and quotes every field.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "\"\"";
  let text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
