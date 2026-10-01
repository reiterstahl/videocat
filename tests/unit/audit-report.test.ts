import assert from "node:assert/strict";
import test from "node:test";

import { csvCell, groupAuditErrors, toCsv } from "../../apps/server/src/lib/audit-report.ts";

const base = { diskName: "WD", category: "metadata", phase: "ffprobe", code: "E1", message: "Invalid data", relativePath: "a.mp4" };

test("groups repeated errors keeping count, first and last occurrence", () => {
  const groups = groupAuditErrors([
    { ...base, id: "1", createdAt: new Date("2026-09-01T10:00:00Z") },
    { ...base, id: "2", relativePath: "b.mp4", createdAt: new Date("2026-09-03T10:00:00Z") },
    { ...base, id: "3", createdAt: new Date("2026-08-30T10:00:00Z") },
    { ...base, id: "4", message: "Other", createdAt: new Date("2026-09-02T10:00:00Z") }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].firstAt.toISOString(), "2026-08-30T10:00:00.000Z");
  assert.equal(groups[0].lastAt.toISOString(), "2026-09-03T10:00:00.000Z");
  assert.equal(groups[0].samplePath, "b.mp4");
  assert.equal(groups[1].message, "Other");
});

test("csv cells are quoted and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell("plain"), "\"plain\"");
  assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1"), "\"'+1\"");
  assert.equal(csvCell("-2"), "\"'-2\"");
  assert.equal(csvCell("@cmd"), "\"'@cmd\"");
  assert.equal(csvCell(null), "\"\"");
  assert.equal(csvCell(new Date("2026-09-01T00:00:00Z")), "\"2026-09-01T00:00:00.000Z\"");
});

test("toCsv writes a header and CRLF rows", () => {
  assert.equal(toCsv(["a", "b"], [[1, "x"]]), "\"a\",\"b\"\r\n\"1\",\"x\"\r\n");
});
