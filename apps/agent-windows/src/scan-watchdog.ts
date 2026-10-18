// A scan must not stay forever on one file. A file with bad sectors can leave its reads hanging
// while the drive stays connected (Windows keeps retrying), so every file gets a deadline: past
// it, its FFmpeg/FFprobe processes are stopped, the scan moves on and the file is noted as at risk
// so later scans leave it alone, without even reading its size, until the retry time passes.

export type RiskyFiles = Record<string, { at: number; reason: string }>;

export const riskyRetryDays = 30;

// Runs one file's work with a deadline. On time out the work is told to stop (its signal aborts,
// which kills its child processes) and is no longer waited for: a read stuck in the drive may
// never return.
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<{ done: true; value: T } | { done: false }> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), timeoutMs);
  });
  const running = work(controller.signal);
  try {
    const result = await Promise.race([running.then((value) => ({ value })), expired]);
    if (result === "expired") {
      controller.abort();
      running.catch(() => undefined);
      return { done: false };
    }
    return { done: true, value: result.value };
  } finally {
    clearTimeout(timer);
  }
}

// At risk and still within its retry time: later scans skip it before touching it.
export function isRiskyNow(risky: RiskyFiles | undefined, relativePath: string, now = Date.now(), retryDays = riskyRetryDays): boolean {
  const entry = risky?.[relativePath];
  return Boolean(entry && now - entry.at < retryDays * 24 * 60 * 60 * 1000);
}

export function markRisky(risky: RiskyFiles, relativePath: string, reason: string, now = Date.now()): void {
  risky[relativePath] = { at: now, reason };
}

// A file read fine again (after its retry time, or replaced): it leaves the list.
export function clearRisky(risky: RiskyFiles | undefined, relativePath: string): void {
  if (risky) delete risky[relativePath];
}

// Seconds a healthy file may take, from the Companion settings (COMPANION_FILE_TIMEOUT_SECONDS).
export function fileTimeoutSeconds(value: string | undefined): number {
  const seconds = Number(value ?? 180);
  return Number.isFinite(seconds) ? Math.min(3600, Math.max(30, Math.round(seconds))) : 180;
}
