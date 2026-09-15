import {
  hammingDistance64,
  parseVisualFingerprint,
  type VisualFingerprintFrame
} from "@videocat/shared";

export const deletionModifiedAtToleranceMs = 1_000;
const maximumFrameDistance = 8;

export type ExpectedDeletionMetadata = {
  sizeBytes: number;
  modifiedAt?: string | null;
};

export type CurrentDeletionMetadata = {
  sizeBytes: number;
  modifiedAtMs: number;
};

export type DeletionIdentityResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateDeletionMetadata(
  expected: ExpectedDeletionMetadata,
  current: CurrentDeletionMetadata
): DeletionIdentityResult {
  if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 0) {
    return { ok: false, reason: "el tamano catalogado no es valido" };
  }
  if (current.sizeBytes !== expected.sizeBytes) {
    return {
      ok: false,
      reason: `el tamano cambio (catalogado ${expected.sizeBytes}, actual ${current.sizeBytes})`
    };
  }

  if (!expected.modifiedAt) {
    return { ok: false, reason: "el registro no tiene fecha de modificacion para validar su identidad" };
  }
  const expectedModifiedAtMs = new Date(expected.modifiedAt).getTime();
  if (!Number.isFinite(expectedModifiedAtMs)) {
    return { ok: false, reason: "la fecha de modificacion catalogada no es valida" };
  }
  if (Math.abs(current.modifiedAtMs - expectedModifiedAtMs) > deletionModifiedAtToleranceMs) {
    return {
      ok: false,
      reason: `la fecha de modificacion cambio (catalogada ${expected.modifiedAt}, actual ${new Date(current.modifiedAtMs).toISOString()})`
    };
  }

  return { ok: true };
}

export function deletionFingerprintFrameIndexes(fingerprint: string | null | undefined): number[] {
  const frames = parseVisualFingerprint(fingerprint);
  if (!frames) return [];
  const indexes = [...frames.keys()].sort((left, right) => left - right);
  const selected = [indexes[0], indexes[Math.floor(indexes.length / 2)], indexes[indexes.length - 1]];
  return [...new Set(selected)];
}

export function validateDeletionFingerprint(
  expectedFingerprint: string,
  observedFrames: VisualFingerprintFrame[]
): DeletionIdentityResult {
  const expectedFrames = parseVisualFingerprint(expectedFingerprint);
  if (!expectedFrames) return { ok: false, reason: "la huella visual catalogada no es valida" };

  let compared = 0;
  let matching = 0;
  for (const observed of observedFrames) {
    const expected = expectedFrames.get(observed.index);
    if (expected == null || !/^[0-9a-f]{16}$/i.test(observed.hash)) continue;
    compared += 1;
    if (hammingDistance64(expected, BigInt(`0x${observed.hash}`)) <= maximumFrameDistance) matching += 1;
  }

  const required = Math.min(2, deletionFingerprintFrameIndexes(expectedFingerprint).length);
  if (compared < required || matching < required) {
    return {
      ok: false,
      reason: `la huella visual no coincide (${matching}/${Math.max(required, compared)} muestras compatibles)`
    };
  }

  return { ok: true };
}
