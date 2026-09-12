export const visualFingerprintVersion = 1;
export const visualFingerprintFrameCount = 15;
export const visualFingerprintPattern = /^v1:(?:\d{2}=[0-9a-f]{16})(?:;\d{2}=[0-9a-f]{16})*$/;

export type VisualFingerprintFrame = {
  index: number;
  hash: string;
};

export function perceptualHashFromGray9x8(pixels: Uint8Array): string {
  if (pixels.length !== 72) {
    throw new Error(`Expected 72 grayscale pixels, received ${pixels.length}`);
  }

  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      hash <<= 1n;
      if (pixels[(y * 9) + x] > pixels[(y * 9) + x + 1]) hash |= 1n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export function encodeVisualFingerprint(frames: VisualFingerprintFrame[]): string | null {
  const normalized = [...new Map(
    frames
      .filter((frame) => Number.isInteger(frame.index) && frame.index >= 1 && frame.index <= visualFingerprintFrameCount)
      .filter((frame) => /^[0-9a-f]{16}$/i.test(frame.hash))
      .map((frame) => [frame.index, { index: frame.index, hash: frame.hash.toLowerCase() }])
  ).values()].sort((a, b) => a.index - b.index);

  if (normalized.length < 8) return null;
  return `v${visualFingerprintVersion}:${normalized
    .map((frame) => `${String(frame.index).padStart(2, "0")}=${frame.hash}`)
    .join(";")}`;
}

export function parseVisualFingerprint(value: string | null | undefined): Map<number, bigint> | null {
  if (!value || !visualFingerprintPattern.test(value)) return null;
  const frames = new Map<number, bigint>();
  for (const item of value.slice(3).split(";")) {
    const [indexText, hash] = item.split("=");
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 1 || index > visualFingerprintFrameCount || frames.has(index)) return null;
    frames.set(index, BigInt(`0x${hash}`));
  }
  return frames.size >= 8 ? frames : null;
}

export function hammingDistance64(left: bigint, right: bigint): number {
  let value = left ^ right;
  let distance = 0;
  while (value !== 0n) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
}

export function visualFingerprintSimilarity(left: string | null | undefined, right: string | null | undefined): number | null {
  const leftFrames = parseVisualFingerprint(left);
  const rightFrames = parseVisualFingerprint(right);
  if (!leftFrames || !rightFrames) return null;

  let compared = 0;
  let differentBits = 0;
  for (const [index, leftHash] of leftFrames) {
    const rightHash = rightFrames.get(index);
    if (rightHash == null) continue;
    compared += 1;
    differentBits += hammingDistance64(leftHash, rightHash);
  }
  if (compared < 8) return null;
  return 1 - (differentBits / (compared * 64));
}

export function visualFingerprintBandKeys(value: string | null | undefined): string[] {
  const frames = parseVisualFingerprint(value);
  if (!frames) return [];
  const keys: string[] = [];
  for (const [index, hash] of frames) {
    const hex = hash.toString(16).padStart(16, "0");
    for (let band = 0; band < 4; band += 1) {
      keys.push(`${String(index).padStart(2, "0")}:${band}:${hex.slice(band * 4, (band + 1) * 4)}`);
    }
  }
  return keys;
}
