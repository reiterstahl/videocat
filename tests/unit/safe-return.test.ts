import assert from "node:assert/strict";
import test from "node:test";

import { safeReturnPath } from "../../apps/server/src/lib/safe-return.ts";

test("coming back after an access proxy sign-in stays on this site", () => {
  assert.equal(safeReturnPath("/catalogo"), "/catalogo");
  assert.equal(safeReturnPath("/uso-por-carpeta?x=1"), "/uso-por-carpeta?x=1");
  for (const unsafe of ["https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "catalogo", "", null, 42, "/api/files", "/thumbnails/a.jpg", `/${"a".repeat(2001)}`]) {
    assert.equal(safeReturnPath(unsafe), "/", String(unsafe));
  }
});
