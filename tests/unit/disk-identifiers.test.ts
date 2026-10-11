import assert from "node:assert/strict";
import test from "node:test";

import { agentDiskIdentifierSchema, disksByAgentIdentifiers, isUuid } from "../../apps/server/src/lib/disk-identifiers.ts";

test("agent disk identifiers accept marker UUIDs and legacy folder ids only", () => {
  for (const valid of ["3a2c123e-d328-4567-a69f-1b443347c026", "target-mg3k2x1a-4f8ab2", "nas.videos:01", "WD_6TB"]) {
    assert.equal(agentDiskIdentifierSchema.safeParse(valid).success, true, valid);
  }
  for (const invalid of ["", "-leading-dash", "with space", "../escape", "x".repeat(200), "a\nb"]) {
    assert.equal(agentDiskIdentifierSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test("only UUIDs are compared with the UUID primary key", () => {
  assert.equal(isUuid("3A2C123E-D328-4567-A69F-1B443347C026"), true);
  assert.equal(isUuid("target-mg3k2x1a"), false);
  assert.deepEqual(disksByAgentIdentifiers(["target-a"]), { OR: [{ volumeId: { in: ["target-a"] } }] });
  const uuid = "3a2c123e-d328-4567-a69f-1b443347c026";
  assert.deepEqual(disksByAgentIdentifiers([uuid, "target-a"]), {
    OR: [{ id: { in: [uuid] } }, { volumeId: { in: [uuid, "target-a"] } }]
  });
});
