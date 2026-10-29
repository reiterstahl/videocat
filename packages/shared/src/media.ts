import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { boundedErrorMessage } from "./bounded-text.js";
import { damagedMediaMessage, damagedMediaReason } from "./damaged-media.js";
import { encodeVisualFingerprint, perceptualHashFromGray9x8, visualFingerprintVersion, type VisualFingerprintFrame } from "./perceptual-fingerprint.js";

// Reading a video with ffprobe and ffmpeg: metadata, the 15 frames and the visual fingerprint.
// Shared by the Windows Companion (files on a drive) and the server's scanner (S3 objects
// through a signed URL): the source is whatever ffmpeg can open. Node only, kept out of the
// package's main entry so it never reaches the web bundle.

const execFileAsync = promisify(execFile);

export type MediaTools = { ffmpeg: string; ffprobe: string };
// translate: shows a message in another language (the Companion's); its text is a Spanish
// template with {name} placeholders. Without it messages stay in Spanish.
export type MediaLog = {
  info: (message: string) => void;
  warn: (message: string) => void;
  translate?: (template: string, values?: Record<string, string | number>) => string;
};
const consoleLog: MediaLog = { info: (message) => console.log(message), warn: (message) => console.warn(message) };

function fill(log: MediaLog, template: string, values?: Record<string, string | number>): string {
  if (log.translate) return log.translate(template, values);
  return values ? template.replace(/\{(\w+)\}/g, (match: string, key: string) => (key in values ? String(values[key]) : match)) : template;
}

export const thumbnailPercents = Array.from({ length: 15 }, (_value, index) => {
  const frame = String(index + 1).padStart(2, "0");
  return [`frame_${frame}`, (index + 1) / 16] as const;
});

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

// One read of a healthy file (its metadata, one frame) answers in seconds, even from a drive
// that has to spin up. One that does not answer in this time, or fails with an I/O error, sits
// on a failing part of the drive: retrying only stresses it more, so the file is left at once.
export const mediaReadTimeoutMs = 30_000;

export function isUnreadableMediaError(error: unknown): boolean {
  if ((error as Error)?.name === "AbortError") return false;
  if ((error as { killed?: boolean })?.killed || (error as NodeJS.ErrnoException)?.code === "ETIMEDOUT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /input\/output error|i\/o error|i\/o device error|error number -5 occurred/i.test(message);
}

export function compactToolError(error: unknown): string {
  return boundedErrorMessage(error, 360).replace(/\s+/g, " ");
}

function parseFps(value?: string): number | null {
  if (!value || value === "0/0") return null;
  const [top, bottom] = value.split("/").map(Number);
  if (!top || !bottom) return null;
  return top / bottom;
}

export type MediaMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  bitrate: number | null;
  containerFormat: string | null;
  streamCount: number | null;
  raw: unknown;
};

export async function probeMedia(
  source: string,
  tools: MediaTools,
  options: { label: string; signal?: AbortSignal; log?: MediaLog }
): Promise<MediaMetadata> {
  const log = options.log ?? consoleLog;
  const { signal } = options;
  const maxAttempts = 3;
  let stdout = "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new Error("Lectura detenida por tiempo máximo");
    if (attempt > 1) {
      const delayMs = attempt === 2 ? 750 : 2_000;
      log.info(fill(log, "Reintentando metadatos {attempt}/{maxAttempts} para {label} en {delayMs}ms.", { attempt, maxAttempts, label: options.label, delayMs }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const tolerantProbe = attempt === maxAttempts
      ? ["-analyzeduration", "100M", "-probesize", "100M"]
      : [];
    try {
      const result = await execFileAsync(tools.ffprobe, [
        "-v",
        "error",
        ...tolerantProbe,
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        source
      ], { maxBuffer: 1024 * 1024 * 20, timeout: mediaReadTimeoutMs, signal });
      stdout = result.stdout;
      if (attempt > 1) log.info(fill(log, "Metadatos recuperados en intento {attempt}/{maxAttempts} para {label}.", { attempt, maxAttempts, label: options.label }));
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES" || isUnreadableMediaError(error)) break;
    }
  }

  if (lastError) throw lastError;

  const raw = JSON.parse(stdout);
  const videoStream = raw.streams?.find((stream: Record<string, unknown>) => stream.codec_type === "video");
  const audioStream = raw.streams?.find((stream: Record<string, unknown>) => stream.codec_type === "audio");
  const duration = Number(raw.format?.duration ?? videoStream?.duration ?? 0);

  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: Number(videoStream?.width) || null,
    height: Number(videoStream?.height) || null,
    fps: parseFps(String(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate ?? "")),
    videoCodec: typeof videoStream?.codec_name === "string" ? videoStream.codec_name : null,
    audioCodec: typeof audioStream?.codec_name === "string" ? audioStream.codec_name : null,
    audioChannels: Number(audioStream?.channels) || null,
    bitrate: Number(raw.format?.bit_rate) || null,
    containerFormat: typeof raw.format?.format_name === "string" ? raw.format.format_name : null,
    streamCount: Array.isArray(raw.streams) ? raw.streams.length : null,
    raw
  };
}

// One frame as a 9×8 grey image for the perceptual hash and, when asked, as a 640 px JPEG.
export async function extractVisualHash(
  source: string,
  tools: MediaTools,
  rawDestination: string,
  seconds: number,
  thumbnailDestination?: string,
  signal?: AbortSignal,
  log: MediaLog = consoleLog
): Promise<{ hash: string; timestampSeconds: number }> {
  await fs.mkdir(path.dirname(rawDestination), { recursive: true });
  if (thumbnailDestination) await fs.mkdir(path.dirname(thumbnailDestination), { recursive: true });
  const timestamps = frameExtractionTimestamps(seconds);
  let lastError: unknown;

  for (const [attempt, timestampSeconds] of timestamps.entries()) {
    if (signal?.aborted) throw new Error("Lectura detenida por tiempo máximo");
    await fs.rm(rawDestination, { force: true }).catch(() => undefined);
    if (thumbnailDestination) await fs.rm(thumbnailDestination, { force: true }).catch(() => undefined);

    const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(timestampSeconds), "-i", source];
    if (thumbnailDestination) {
      args.push(
        "-filter_complex",
        "[0:v:0]split=2[thumbsrc][hashsrc];[thumbsrc]scale=640:-1[thumb];[hashsrc]scale=9:8,format=gray[hash]",
        "-map", "[thumb]", "-frames:v", "1", "-update", "1", "-q:v", "3", thumbnailDestination,
        "-map", "[hash]", "-frames:v", "1", "-f", "rawvideo", rawDestination
      );
    } else {
      args.push(
        "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=9:8,format=gray", "-f", "rawvideo", rawDestination
      );
    }

    try {
      await execFileAsync(tools.ffmpeg, args, { maxBuffer: 1024 * 1024 * 10, timeout: mediaReadTimeoutMs, signal });
      const pixels = await fs.readFile(rawDestination);
      const hash = perceptualHashFromGray9x8(pixels);
      await fs.rm(rawDestination, { force: true }).catch(() => undefined);
      if (attempt > 0) {
        log.info(fill(log, "Fotograma recuperado en posicion alternativa ({timestampSeconds}s).", { timestampSeconds: timestampSeconds.toFixed(1) }));
      }
      return { hash, timestampSeconds };
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !shouldRetryFrameExtraction(error)) break;
    }
  }

  await fs.rm(rawDestination, { force: true }).catch(() => undefined);
  if (thumbnailDestination) await fs.rm(thumbnailDestination, { force: true }).catch(() => undefined);
  throw lastError;
}

export type MediaThumbnail = { kind: string; timestampSeconds: number; filePath: string };

export type AnalyzedMedia = {
  status: "scanned" | "thumbnail_failed" | "metadata_failed";
  errorMessage: string | null;
  // A read did not answer or failed with an I/O error (see isUnreadableMediaError): the rest of
  // the file was not tried.
  unreadable: boolean;
  metadata: MediaMetadata | null;
  thumbnails: MediaThumbnail[];
  // undefined: not asked; null: asked but not enough frames.
  visualFingerprint: string | null | undefined;
  fingerprintVersion: number | null | undefined;
};

// Metadata, then each of the 15 frames: thumbnails and/or fingerprint, as asked. A damaged or
// unfinished file (an interrupted recording or copy) is not a tool failure: it says so plainly,
// keeps the tool output as detail, and is only read again when the file changes.
export async function analyzeMedia(source: string, options: {
  tools: MediaTools;
  label: string;
  createThumbnails: boolean;
  createFingerprint: boolean;
  thumbnailPath: (kind: string) => string;
  rawPath: (kind: string) => string;
  signal?: AbortSignal;
  log?: MediaLog;
}): Promise<AnalyzedMedia> {
  const log = options.log ?? consoleLog;
  const { createThumbnails, createFingerprint, signal } = options;
  try {
    const metadata = await probeMedia(source, options.tools, { label: options.label, signal, log });
    const thumbnails: MediaThumbnail[] = [];
    const fingerprintFrames: VisualFingerprintFrame[] = [];
    let status: AnalyzedMedia["status"] = "scanned";
    let errorMessage: string | null = null;
    let unreadable = false;

    if ((createThumbnails || createFingerprint) && metadata.durationSeconds) {
      let thumbnailFailures = 0;
      let fingerprintFailures = 0;
      for (const [kind, percent] of thumbnailPercents) {
        if (signal?.aborted) break;
        const timestampSeconds = Math.max(0.1, metadata.durationSeconds * percent);
        const destination = options.thumbnailPath(kind);
        try {
          const extracted = await extractVisualHash(source, options.tools, options.rawPath(kind), timestampSeconds, createThumbnails ? destination : undefined, signal, log);
          fingerprintFrames.push({ index: Number(kind.slice(-2)), hash: extracted.hash });
          if (createThumbnails) thumbnails.push({ kind, timestampSeconds: extracted.timestampSeconds, filePath: destination });
        } catch (error) {
          fingerprintFailures += 1;
          if (createThumbnails) {
            thumbnailFailures += 1;
            status = "thumbnail_failed";
            errorMessage = boundedErrorMessage(error, 4000, "thumbnail_failed");
          }
          if (isUnreadableMediaError(error)) {
            unreadable = true;
            break;
          }
        }
      }
      if (thumbnailFailures > 0) {
        log.warn(fill(log, "Miniaturas fallidas {thumbnailFailures}/{length} para {label}: {error}", { thumbnailFailures, length: thumbnailPercents.length, label: options.label, error: compactToolError(errorMessage) }));
      }
      if (fingerprintFailures > 0 && !createThumbnails) {
        log.warn(fill(log, "Huella visual parcial {length}/{length2} para {label}.", { length: fingerprintFrames.length, length2: thumbnailPercents.length, label: options.label }));
      }
    }

    if (unreadable) log.warn(fill(log, "Lectura sin respuesta en {label}: se deja el archivo sin intentar el resto de sus fotogramas.", { label: options.label }));
    const visualFingerprint = createFingerprint ? encodeVisualFingerprint(fingerprintFrames) : undefined;
    return {
      status,
      errorMessage,
      unreadable,
      metadata,
      thumbnails,
      visualFingerprint,
      fingerprintVersion: visualFingerprint ? visualFingerprintVersion : createFingerprint ? null : undefined
    };
  } catch (error) {
    const detail = boundedErrorMessage(error, 4000, "metadata_failed");
    const damaged = damagedMediaReason(detail);
    if (damaged) log.warn(fill(log, "Archivo dañado {label}: {damaged}", { label: options.label, damaged }));
    else log.warn(fill(log, "Metadatos fallidos para {label}: {error}", { label: options.label, error: compactToolError(error) }));
    return {
      status: "metadata_failed",
      errorMessage: damaged ? `${damagedMediaMessage(damaged)}\nDetalle: ${detail.slice(0, 1500)}` : detail,
      unreadable: isUnreadableMediaError(error),
      metadata: null,
      thumbnails: [],
      visualFingerprint: createFingerprint ? null : undefined,
      fingerprintVersion: createFingerprint ? null : undefined
    };
  }
}
