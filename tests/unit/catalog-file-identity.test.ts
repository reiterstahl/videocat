import assert from "node:assert/strict";
import test from "node:test";

import { catalogFileIdentityChanged } from "../../apps/server/src/lib/catalog-file-identity.ts";

test("recognizes the same cataloged file identity", () => {
  assert.equal(catalogFileIdentityChanged(
    { sizeBytes: 2048n, modifiedAt: new Date("2026-09-15T12:00:00.000Z") },
    { sizeBytes: 2048, modifiedAt: new Date("2026-09-15T12:00:00.000Z") }
  ), false);
});

test("recognizes a replacement at the same path", () => {
  assert.equal(catalogFileIdentityChanged(
    { sizeBytes: 2048n, modifiedAt: new Date("2026-09-15T12:00:00.000Z") },
    { sizeBytes: 4096, modifiedAt: new Date("2026-09-15T12:00:00.000Z") }
  ), true);
  assert.equal(catalogFileIdentityChanged(
    { sizeBytes: 2048n, modifiedAt: new Date("2026-09-15T12:00:00.000Z") },
    { sizeBytes: 2048, modifiedAt: new Date("2026-09-15T12:01:00.000Z") }
  ), true);
});
