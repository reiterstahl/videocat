import { findDuplicateGroups, type DuplicateCandidate } from "./duplicate-detection.js";

export type DuplicateDriveCandidate = DuplicateCandidate & {
  diskId: string;
  diskName: string;
  driveLetter: string | null;
  volumeLabel: string | null;
  totalBytes: bigint | number | null;
  curationStatus: string;
  categoryKeys: string[];
};

export type DuplicateDriveRecommendation = {
  diskId: string;
  diskName: string;
  driveLetter: string | null;
  volumeLabel: string | null;
  totalBytes: number | null;
  connected: boolean;
  groupCount: number;
  fileCount: number;
  readyFileCount: number;
  readyBytes: number;
  pendingFileCount: number;
  pendingBytes: number;
  recoverableBytes: number;
};

function pixelCount(file: DuplicateCandidate): number {
  return Math.max(0, file.width ?? 0) * Math.max(0, file.height ?? 0);
}

function compareQuality(left: DuplicateCandidate, right: DuplicateCandidate): number {
  const resolutionDifference = pixelCount(left) - pixelCount(right);
  if (resolutionDifference !== 0) return resolutionDifference;

  const sizeDifference = Number(left.sizeBytes) - Number(right.sizeBytes);
  if (sizeDifference !== 0) return sizeDifference;

  const durationDifference = (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0);
  if (durationDifference !== 0) return durationDifference;

  return right.id.localeCompare(left.id);
}

function hasCategory(file: DuplicateDriveCandidate, key: string): boolean {
  return file.curationStatus === key || file.categoryKeys.includes(key);
}

export function recommendDuplicateDrives(
  candidates: DuplicateDriveCandidate[],
  connectedDiskIds: ReadonlySet<string>
): {
  groupCount: number;
  totalRecoverableBytes: number;
  totalReadyBytes: number;
  totalPendingBytes: number;
  disks: DuplicateDriveRecommendation[];
} {
  const filesById = new Map(candidates.map((file) => [file.id, file]));
  const groups = findDuplicateGroups(candidates);
  const aggregates = new Map<string, DuplicateDriveRecommendation & { groupKeys: Set<string> }>();

  for (const group of groups) {
    const files = group.fileIds.flatMap((id) => {
      const file = filesById.get(id);
      return file ? [file] : [];
    });
    if (files.length < 2) continue;

    const explicitKeepers = files.filter((file) => hasCategory(file, "keep"));
    const eligibleKeepers = explicitKeepers.length > 0
      ? explicitKeepers
      : files.filter((file) => !hasCategory(file, "delete"));
    const keeper = [...(eligibleKeepers.length > 0 ? eligibleKeepers : files)]
      .sort((left, right) => compareQuality(right, left))[0];

    for (const file of files) {
      if (file.id === keeper.id || hasCategory(file, "keep")) continue;

      const ready = hasCategory(file, "delete");
      const sizeBytes = Number(file.sizeBytes);
      const aggregate = aggregates.get(file.diskId) ?? {
        diskId: file.diskId,
        diskName: file.diskName,
        driveLetter: file.driveLetter,
        volumeLabel: file.volumeLabel,
        totalBytes: file.totalBytes == null ? null : Number(file.totalBytes),
        connected: connectedDiskIds.has(file.diskId),
        groupCount: 0,
        fileCount: 0,
        readyFileCount: 0,
        readyBytes: 0,
        pendingFileCount: 0,
        pendingBytes: 0,
        recoverableBytes: 0,
        groupKeys: new Set<string>()
      };

      aggregate.groupKeys.add(group.key);
      aggregate.fileCount += 1;
      aggregate.recoverableBytes += sizeBytes;
      if (ready) {
        aggregate.readyFileCount += 1;
        aggregate.readyBytes += sizeBytes;
      } else {
        aggregate.pendingFileCount += 1;
        aggregate.pendingBytes += sizeBytes;
      }
      aggregates.set(file.diskId, aggregate);
    }
  }

  const disks = [...aggregates.values()]
    .map(({ groupKeys, ...disk }) => ({ ...disk, groupCount: groupKeys.size }))
    .sort((left, right) =>
      right.readyBytes - left.readyBytes
      || right.recoverableBytes - left.recoverableBytes
      || right.fileCount - left.fileCount
      || left.diskName.localeCompare(right.diskName)
    );

  return {
    groupCount: groups.length,
    totalRecoverableBytes: disks.reduce((sum, disk) => sum + disk.recoverableBytes, 0),
    totalReadyBytes: disks.reduce((sum, disk) => sum + disk.readyBytes, 0),
    totalPendingBytes: disks.reduce((sum, disk) => sum + disk.pendingBytes, 0),
    disks
  };
}
