import assert from "node:assert/strict";
import test from "node:test";
import { DownloadPriority } from "../../apps/agent-windows/src/work-priority.ts";

test("a download waits for the transfer file in progress, then transfers step aside until downloads end", async () => {
  const priority = new DownloadPriority();
  const order: string[] = [];
  let finishCopy!: () => void;
  const copying = priority.runTransferItem(() => new Promise<void>((resolve) => {
    finishCopy = () => {
      order.push("transfer file done");
      resolve();
    };
  }));

  let waited = false;
  const claimed = priority.claim(() => {
    waited = true;
  }).then(() => order.push("downloads start"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(waited, true);
  assert.deepEqual(order, [], "the download does not start in the middle of a copy");
  finishCopy();
  await copying;
  await claimed;
  assert.deepEqual(order, ["transfer file done", "downloads start"]);

  assert.equal(priority.transfersMayRun(), false, "no new transfer file while downloads run");
  assert.equal(priority.release(), true, "transfers resume right after");
  assert.equal(priority.transfersMayRun(), true);
});

test("a pass over several drives is one turn, and an empty pass never stops transfers", async () => {
  const priority = new DownloadPriority();
  priority.hold();
  assert.equal(priority.transfersMayRun(), true, "checking empty queues does not stop transfers");
  await priority.claim();
  assert.equal(priority.transfersMayRun(), false);
  assert.equal(priority.release(), false, "the first drive is done, the pass goes on");
  assert.equal(priority.transfersMayRun(), false);
  assert.equal(priority.release(), true);

  priority.hold();
  assert.equal(priority.release(), false, "nothing to resume when no download ran");
});

test("a download with no transfer running starts at once", async () => {
  const priority = new DownloadPriority();
  let waited = false;
  await priority.claim(() => {
    waited = true;
  });
  assert.equal(waited, false);
  assert.equal(priority.release(), false, "transfers never stepped aside");
});
