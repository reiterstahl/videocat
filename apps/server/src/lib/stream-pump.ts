export type RangeReader = (offset: number, length: number) => Promise<Buffer>;

export type RangePumpOptions = {
  start: number;
  end: number;
  chunkBytes: number;
  // Bytes read ahead of what the client consumed: in flight plus already arrived.
  bufferBytes: number;
  maxInFlight: number;
  read: RangeReader;
  onChunk?: (bytes: number) => void;
};

type Entry = { length: number; settled: boolean; promise: Promise<Buffer> };

// Yields the bytes start..end in order while keeping the next chunks requested ahead of time,
// so a slow round trip per chunk does not limit playback. Stops asking as soon as the consumer leaves.
export async function* pumpRange(options: RangePumpOptions): AsyncGenerator<Buffer> {
  const chunkBytes = Math.max(1, options.chunkBytes);
  const bufferBytes = Math.max(chunkBytes, options.bufferBytes);
  const maxInFlight = Math.max(1, options.maxInFlight);
  const queue: Entry[] = [];
  let next = options.start;
  let queuedBytes = 0;
  let stopped = false;

  function fill(): void {
    while (!stopped && next <= options.end) {
      const inFlight = queue.reduce((count, entry) => count + (entry.settled ? 0 : 1), 0);
      if (inFlight >= maxInFlight) return;
      const length = Math.min(chunkBytes, options.end - next + 1);
      if (queue.length > 0 && queuedBytes + length > bufferBytes) return;
      const offset = next;
      next += length;
      queuedBytes += length;
      const entry: Entry = { length, settled: false, promise: Promise.resolve(Buffer.alloc(0)) };
      entry.promise = options.read(offset, length).then(
        (data) => {
          entry.settled = true;
          fill();
          return data;
        },
        (error: unknown) => {
          entry.settled = true;
          throw error;
        }
      );
      // Awaited later in order; a failure ahead of the consumer must not count as unhandled.
      entry.promise.catch(() => undefined);
      queue.push(entry);
    }
  }

  try {
    fill();
    while (queue.length > 0) {
      const entry = queue[0];
      const data = await entry.promise;
      if (data.length !== entry.length) throw new Error("Unexpected range length");
      queue.shift();
      queuedBytes -= entry.length;
      fill();
      options.onChunk?.(data.length);
      yield data;
    }
  } finally {
    stopped = true;
  }
}
