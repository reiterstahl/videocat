export function boundedText(value: string, maximumLength: number): string {
  const sanitized = value.replace(/\0/g, "");
  if (sanitized.length <= maximumLength) return sanitized;

  const marker = "\n...[diagnostico truncado]...\n";
  if (maximumLength <= marker.length) return sanitized.slice(0, maximumLength);
  const available = maximumLength - marker.length;
  const headLength = Math.ceil(available * 0.45);
  const tailLength = available - headLength;
  return `${sanitized.slice(0, headLength)}${marker}${sanitized.slice(-tailLength)}`;
}

export function boundedErrorMessage(error: unknown, maximumLength = 4000, fallback = "Error desconocido"): string {
  const value = error instanceof Error ? error.message : String(error ?? "");
  return boundedText(value.trim() || fallback, maximumLength);
}
