import assert from "node:assert/strict";
import test from "node:test";
import { compareStableVersions, latestStableVersion } from "../../apps/server/src/lib/version-check.js";

test("selects the newest stable Docker image tag", () => {
  assert.equal(latestStableVersion(["latest", "0.1.9", "v0.1.18", "0.2.0-beta", "0.1.12"]), "0.1.18");
  assert.equal(latestStableVersion(["latest", "edge"]), null);
});

test("compares stable semantic versions numerically", () => {
  assert.equal(compareStableVersions("0.1.19", "0.1.18") > 0, true);
  assert.equal(compareStableVersions("0.2.0", "0.10.0") < 0, true);
  assert.equal(compareStableVersions("1.0.0", "1.0.0"), 0);
});
