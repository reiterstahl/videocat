// FFmpeg/FFprobe messages that mean the file itself is incomplete or damaged, not that a tool failed.
const damagedSignatures: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /moov atom not found/i, reason: "falta el índice del MP4 (moov): la grabación o la copia se cortó antes de terminar." },
  { pattern: /EBML header parsing failed/i, reason: "la cabecera del archivo MKV está dañada." },
  { pattern: /partial file/i, reason: "el archivo está cortado: termina antes de lo que indica su contenido." },
  { pattern: /Invalid data found when processing input/i, reason: "sus datos no se pueden leer como video." }
];

// Catalog messages for a damaged file start with this text, so the server and the web recognize them.
export const damagedMediaPrefix = "Archivo de video incompleto o dañado";

// The reason, when an FFmpeg/FFprobe message says the file is damaged; null for any other failure.
export function damagedMediaReason(message: string | null | undefined): string | null {
  if (!message) return null;
  return damagedSignatures.find((signature) => signature.pattern.test(message))?.reason ?? null;
}

export function damagedMediaMessage(reason: string): string {
  return `${damagedMediaPrefix}: ${reason} Si todavía se está copiando, se vuelve a leer cuando cambie.`;
}

export function isDamagedMediaMessage(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith(damagedMediaPrefix));
}
