import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("packages every generated Companion runtime module and verifies app.asar", () => {
  const packageJson = JSON.parse(fs.readFileSync("apps/agent-windows/package.json", "utf8")) as {
    scripts: Record<string, string>;
    build: { files: Array<string | object> };
  };

  assert.ok(packageJson.build.files.includes("dist/*.js"));
  assert.ok(packageJson.build.files.includes("dist/*.cjs"));
  assert.match(packageJson.scripts["package:tray"], /verify:package/);
  assert.match(packageJson.scripts.build, /npm run clean/);
});
