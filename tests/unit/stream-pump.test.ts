import assert from "node:assert/strict";
import test from "node:test";
import { pumpRange } from "../../apps/server/src/lib/stream-pump.ts";

function fakeFile(size: number): Buffer {
  return Buffer.from(Array.from({ length: size }, (_, index) => index % 251));
}

async function collect(generator: AsyncGenerator<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of generator) parts.push(part);
  return Buffer.concat(parts);
}

test("streams a range in order while several chunks are read at once", async () => {
  const file = fakeFile(10_000);
  let inFlight = 0;
  let peak = 0;
  const data = await collect(pumpRange({
    start: 1_000,
    end: 8_999,
    chunkBytes: 700,
    bufferBytes: 5_000,
    maxInFlight: 4,
    read: async (offset, length) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Later chunks answer first: order must still hold.
      await new Promise((resolve) => setTimeout(resolve, 20 - (offset % 7)));
      inFlight -= 1;
      return file.subarray(offset, offset + length);
    }
  }));
  assert.deepEqual(data, file.subarray(1_000, 9_000));
  assert.equal(peak, 4);
});

test("reads ahead no further than the buffer and stops when the consumer leaves", async () => {
  const requested: number[] = [];
  const generator = pumpRange({
    start: 0,
    end: 99_999,
    chunkBytes: 1_000,
    bufferBytes: 3_000,
    maxInFlight: 8,
    read: async (offset, length) => {
      requested.push(offset);
      return Buffer.alloc(length);
    }
  });
  await generator.next();
  await new Promise((resolve) => setTimeout(resolve, 10));
  // One chunk handed over plus three read ahead.
  assert.equal(requested.length, 4);
  await generator.return(undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requested.length, 4);
});

test("a failed chunk ends the stream with its error", async () => {
  const generator = pumpRange({
    start: 0,
    end: 2_999,
    chunkBytes: 1_000,
    bufferBytes: 3_000,
    maxInFlight: 3,
    read: async (offset, length) => {
      if (offset === 1_000) throw new Error("Companion stream error: read_failed");
      return Buffer.alloc(length);
    }
  });
  await assert.rejects(collect(generator), /read_failed/);
});

test("a short answer from the Companion is rejected", async () => {
  const generator = pumpRange({
    start: 0,
    end: 1_999,
    chunkBytes: 1_000,
    bufferBytes: 2_000,
    maxInFlight: 2,
    read: async (_offset, length) => Buffer.alloc(length - 1)
  });
  await assert.rejects(collect(generator), /Unexpected range length/);
});
