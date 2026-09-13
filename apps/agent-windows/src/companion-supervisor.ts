const restartDelaysMs = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

export function companionRestartDelayMs(consecutiveFailures: number): number {
  const index = Math.min(Math.max(0, consecutiveFailures), restartDelaysMs.length - 1);
  return restartDelaysMs[index];
}

export function companionRunWasStable(startedAt: number, stoppedAt: number, stableAfterMs = 300_000): boolean {
  return stoppedAt - startedAt >= stableAfterMs;
}
