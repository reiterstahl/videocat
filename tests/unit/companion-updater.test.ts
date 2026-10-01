import assert from "node:assert/strict";
import test from "node:test";

import { CompanionUpdater, type UpdateClient } from "../../apps/agent-windows/src/updater.ts";

type Asset = NonNullable<ReturnType<UpdateClient["getUpdatePendingRestart"]>>;

function asset(version: string): Asset {
  return { PackageId: "VideoCAT-Companion", Version: version, Type: "Full", FileName: `v${version}.nupkg`, SHA1: "", SHA256: "", Size: 1, NotesMarkdown: "", NotesHtml: "" };
}

function fakeClient(options: { pending?: string; available?: string; fail?: boolean } = {}) {
  const calls = { check: 0, download: 0, apply: [] as Array<{ version: string; silent?: boolean; restart?: boolean }> };
  const client: UpdateClient = {
    getUpdatePendingRestart: () => (options.pending ? asset(options.pending) : null),
    checkForUpdatesAsync: async () => {
      calls.check += 1;
      if (options.fail) throw new Error("offline");
      return options.available ? { TargetFullRelease: asset(options.available), DeltasToTarget: [], IsDowngrade: false } as never : null;
    },
    downloadUpdateAsync: async () => {
      calls.download += 1;
    },
    waitExitThenApplyUpdate: (update, silent, restart) => {
      calls.apply.push({ version: (update as Asset).Version, silent, restart });
    }
  };
  return { client, calls };
}

test("development and portable copies never check for updates", async () => {
  const updater = new CompanionUpdater(null);
  assert.equal(updater.installed, false);
  assert.equal(await updater.checkAndDownload(), null);
  assert.equal(updater.applyAfterExit(), false);
});

test("a new release is downloaded once and applied silently with a restart", async () => {
  const { client, calls } = fakeClient({ available: "0.2.4" });
  const updater = new CompanionUpdater(client);
  assert.equal(updater.applyAfterExit(), false);
  assert.equal(await updater.checkAndDownload(), "0.2.4");
  assert.equal(await updater.checkAndDownload(), "0.2.4");
  assert.equal(calls.check, 1);
  assert.equal(calls.download, 1);
  assert.equal(updater.readyVersion, "0.2.4");
  assert.equal(updater.applyAfterExit(), true);
  assert.deepEqual(calls.apply, [{ version: "0.2.4", silent: true, restart: true }]);
});

test("an update downloaded in an earlier session is offered without downloading again", async () => {
  const { client, calls } = fakeClient({ pending: "0.2.5", available: "0.2.5" });
  const updater = new CompanionUpdater(client);
  assert.equal(await updater.checkAndDownload(), "0.2.5");
  assert.equal(calls.check, 0);
  assert.equal(calls.download, 0);
});

test("concurrent checks share one request and failures leave nothing ready", async () => {
  const { client, calls } = fakeClient({ fail: true });
  const updater = new CompanionUpdater(client);
  const results = await Promise.allSettled([updater.checkAndDownload(), updater.checkAndDownload()]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(calls.check, 1);
  assert.equal(updater.readyVersion, null);
  await assert.rejects(updater.checkAndDownload());
  assert.equal(calls.check, 2);
});

test("no release newer than the installed one leaves the updater idle", async () => {
  const { client, calls } = fakeClient();
  const updater = new CompanionUpdater(client);
  assert.equal(await updater.checkAndDownload(), null);
  assert.equal(calls.download, 0);
});
