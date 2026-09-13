const minimumTimestampSeconds = 0.1;

export function frameExtractionTimestamps(requestedSeconds: number): number[] {
  const normalized = Math.max(minimumTimestampSeconds, requestedSeconds);
  const candidates = [
    normalized,
    normalized - 5,
    normalized - 30,
    normalized * 0.75
  ];

  const unique = new Set<string>();
  return candidates
    .map((seconds) => Math.max(minimumTimestampSeconds, seconds))
    .filter((seconds) => {
      const key = seconds.toFixed(3);
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    });
}

export function shouldRetryFrameExtraction(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return [
    "received no packets",
    "output file is empty",
    "nothing was encoded",
    "could not seek",
    "seek failed"
  ].some((fragment) => message.includes(fragment));
}
