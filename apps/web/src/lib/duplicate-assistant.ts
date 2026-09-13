import type { VideoFile } from "../types";

export type DuplicateRecommendationReason = "resolution" | "size" | "duration" | "stable";

export type DuplicateRecommendation = {
  fileId: string;
  reason: DuplicateRecommendationReason;
};

function pixelCount(file: VideoFile): number {
  return Math.max(0, file.width ?? 0) * Math.max(0, file.height ?? 0);
}

function numericDifference(left: number | null | undefined, right: number | null | undefined): number {
  return (left ?? 0) - (right ?? 0);
}

export function compareDuplicateQuality(left: VideoFile, right: VideoFile): number {
  const resolutionDifference = pixelCount(left) - pixelCount(right);
  if (resolutionDifference !== 0) return resolutionDifference;

  const sizeDifference = left.sizeBytes - right.sizeBytes;
  if (sizeDifference !== 0) return sizeDifference;

  const durationDifference = numericDifference(left.durationSeconds, right.durationSeconds);
  if (durationDifference !== 0) return durationDifference;

  return right.id.localeCompare(left.id);
}

export function recommendDuplicateKeep(left: VideoFile, right: VideoFile): DuplicateRecommendation {
  const preferred = compareDuplicateQuality(left, right) >= 0 ? left : right;
  let reason: DuplicateRecommendationReason = "stable";

  if (pixelCount(left) !== pixelCount(right)) reason = "resolution";
  else if (left.sizeBytes !== right.sizeBytes) reason = "size";
  else if ((left.durationSeconds ?? 0) !== (right.durationSeconds ?? 0)) reason = "duration";

  return { fileId: preferred.id, reason };
}

export function orderDuplicateContenders(files: VideoFile[]): VideoFile[] {
  return [...files].sort((left, right) => {
    const leftAlreadyKept = left.curationStatus === "keep" || left.categoryKeys.includes("keep");
    const rightAlreadyKept = right.curationStatus === "keep" || right.categoryKeys.includes("keep");
    if (leftAlreadyKept !== rightAlreadyKept) return leftAlreadyKept ? -1 : 1;
    return compareDuplicateQuality(right, left);
  });
}

export function isPendingDuplicateContender(file: VideoFile): boolean {
  return file.curationStatus !== "delete" && !file.categoryKeys.includes("delete");
}

export function isBetterDuplicateMetric(
  file: VideoFile,
  other: VideoFile,
  metric: "resolution" | "size" | "duration"
): boolean {
  if (metric === "resolution") return pixelCount(file) > pixelCount(other);
  if (metric === "size") return file.sizeBytes > other.sizeBytes;
  return (file.durationSeconds ?? 0) > (other.durationSeconds ?? 0);
}
